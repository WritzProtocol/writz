# The Stellar Side

**Four contracts, one system — how Writz lives on Soroban.**

The Stellar side of Writz consists of four Soroban smart contracts, a USDC liquidity pool, an interest rate model, and an oracle layer. This page walks through each component, how they interact, and the design decisions behind them.

---

## The Four Contracts

```
bitcoin-spv          zk-verifier
     │                    │
     └──────────┬──────────┘
                │
          commitment-tree  ←──  private-lend
```

### 1. bitcoin-spv

Verifies Bitcoin transactions on Soroban using Simplified Payment Verification. Completely stateless — no Bitcoin headers are stored on-chain. Takes a proof bundle (headers + Merkle proof + raw transaction) and returns a `VerificationResult` containing the txid, block hash, and confirmed outputs.

This contract is called first in every deposit flow. Its output — specifically the `txid` — is passed to the commitment-tree contract and bound into the ZK proof, ensuring every position corresponds to a real Bitcoin transaction.

**Deployed:** `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ`

---

### 2. zk-verifier

Verifies Groth16 BN254 proofs on Soroban using Protocol X-Ray's BN254 host functions. Stores one verification key per circuit type (`Deposit`, `BorrowRepay`, `Liquidation`).

The core verification:
```rust
pub fn verify_groth16(
    env: Env,
    circuit: CircuitType,
    proof: Groth16Proof,
    public_signals: Vec<Bytes32>,
) -> bool
```

Internally, this:
1. Loads the verification key for the specified circuit
2. Computes `vk_x = Σ (public_signals[i] × vk.ic[i])` using `bn254_g1_msm`
3. Runs a 4-pair `bn254_pairing_check`: `e(A,B) == e(alpha,beta) × e(vk_x,gamma) × e(C,delta)`

Returns `true` if the proof is valid, `false` otherwise. Malformed proofs (invalid curve points) cause the host to reject the transaction entirely — the correct security behavior.

**Deployed:** `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV`  
All three verification keys are set on testnet (Deposit IC=6, BorrowRepay IC=9, Liquidation IC=6).

---

### 3. commitment-tree

The core privacy and lending contract. Manages the Poseidon Merkle commitment tree and all ZK-gated lending operations. This is where positions are created, loans are issued, and repayments are recorded.

**Key functions:**

```rust
// Deposit: verify SPV + ZK, create commitment
pub fn deposit(spv_proof: SpvProof, zk_proof: ZkProof) -> CommitmentId

// Insert commitment into the Merkle tree (admin/relayer in Phase 1)
pub fn insert_commitment(commitment: Bytes32) -> Bytes32  // returns new root

// Borrow: ZK proof + oracle price → USDC transferred to borrower
pub fn borrow(zk_proof: ZkProof, new_commitment: Bytes32) -> i128

// Repay: ZK proof → outstanding debt reduced
pub fn repay(zk_proof: ZkProof, new_commitment: Bytes32) -> i128

// Liquidate: ZK undercollateral proof → keeper collects proven debt amount
pub fn liquidate(zk_proof: ZkProof, new_commitment: Bytes32)

// Supply USDC to the pool
pub fn supply_usdc(amount: i128) -> i128

// Withdraw USDC supply
pub fn withdraw_supply(amount: i128) -> i128
```

**Security properties:**
- The `borrow` amount is extracted from the ZK proof's public signal — the caller cannot supply an arbitrary amount
- The `repay` amount is recovered from field-negation inversion of the proof's delta signal
- The `liquidate` `usdc_debt` is extracted from the proof — the liquidator cannot inflate the debt they claim
- Nullifier freshness is checked before any state change — double-spending is impossible
- Merkle root must match the current on-chain root — stale proofs are rejected

**Deployed:** `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7`

---

### 4. private-lend

A non-ZK lending skeleton that provides the borrowing and repayment interface without the ZK layer. Used for:
- Phase 1 testing (simpler than the full ZK flow)
- A reference implementation showing the core lending mechanics
- Future: may be used as a "fast lane" for users who opt out of ZK privacy

**Key functions:**

```rust
// Deposit: verifies SPV directly, creates transparent position
pub fn deposit(spv_proof: SpvProof) -> PositionId

// Borrow: checks collateral ratio at current oracle price → USDC transferred
pub fn borrow(position_id: PositionId, amount: i128) -> i128

// Repay: reduces outstanding debt
pub fn repay(position_id: PositionId, amount: i128)

// Liquidate: keeper-only (Phase 1), checks oracle undercollateralization
pub fn liquidate(position_id: PositionId, usdc_amount: i128)
```

**Deployed:** `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G`

---

## Interest Rate Model

Writz uses a **kinked utilization curve** — the same model pioneered by Aave and Compound, adapted for Writz's parameters.

```
utilization = total_borrowed_usdc / total_supplied_usdc

if utilization ≤ Uoptimal (75%):
    borrow_rate = base_rate + (utilization / Uoptimal) × slope1
else:
    borrow_rate = base_rate + slope1 + ((utilization − Uoptimal) / (1 − Uoptimal)) × slope2
```

**Parameters:**

| Parameter | Value | Rationale |
|---|---|---|
| `base_rate` | 0% | No charge when pool is empty |
| `Uoptimal` | 75% | Target utilization where rates are attractive to both sides |
| `slope1` | 8% APR | Gradual increase up to target |
| `slope2` | 200% APR | Steep increase above target — strong incentive to repay/supply |
| Protocol fee | 15% | Share of borrow rate captured by protocol; rest goes to USDC suppliers |

**Rate examples:**

| Utilization | Borrow APR | Supply APR |
|---|---|---|
| 0% | 0% | 0% |
| 50% | 5.33% | 4.53% |
| 75% | 8.00% | 6.80% |
| 90% | 48.0% | 40.8% |
| 100% | 208.0% | 176.8% |

Interest accrues continuously. Every position-touching call (borrow, repay, liquidate) applies accrued interest before processing the action.

---

## Oracle Design

Writz uses a multi-oracle approach for BTC/USD price feeds, with a **median aggregation** strategy to resist price manipulation.

**Primary oracle:** RedStone (push model, SEP-40 interface)  
**Secondary oracle:** Pyth Network (pull model, SEP-40 interface)

**Staleness check:** Price data older than 90 seconds is rejected. If both oracles are stale, borrowing and liquidation are paused until fresh prices are available.

**Manipulation resistance:**
- Median of two oracles: a single oracle manipulation requires moving the median
- Liquidation smoothing: large liquidations can be executed in tranches to prevent single-block oracle manipulation attacks

**SEP-40 interface:** The oracle stub in both contracts follows the Stellar SEP-40 standard interface. Switching oracle providers requires only updating the oracle contract address — no changes to lending logic.

---

## Storage and TTL Management

Soroban's storage has a time-to-live (TTL) system. Every storage entry has an expiration point; entries that are not accessed eventually expire and are deleted.

Writz manages TTL carefully to ensure user positions never expire unexpectedly:

| Entry type | TTL window |
|---|---|
| Spent nullifiers | 180-day window (near Soroban mainnet max) |
| Merkle root | 180-day window |
| ZK commitments | 180-day window |
| USDC pool balances | 90-day window |
| Per-lender supply balances | 90-day window |

**Permissionless refresh:** All critical entries have public `refresh_*` functions that extend their TTL. Any keeper — including Writz's own keeper, a third-party keeper, or even the user themselves — can call these functions to prevent expiry. No permission required.

```rust
pub fn refresh_nullifier_ttl(env: Env, nullifier: Bytes32)
pub fn refresh_commitment_ttl(env: Env, commitment: Bytes32)
pub fn refresh_merkle_root_ttl(env: Env)
pub fn refresh_pool_ttl(env: Env)
pub fn refresh_supply_balance_ttl(env: Env, supplier: Address)
```

---

## Events

All contract state changes emit structured events using Soroban's `#[contractevent]` annotation:

| Event | Contract | When emitted |
|---|---|---|
| `DepositVerified` | commitment-tree | SPV + ZK deposit accepted |
| `CommitmentInserted` | commitment-tree | New commitment added to Merkle tree |
| `Borrowed` | commitment-tree | USDC loan issued |
| `Repaid` | commitment-tree | Loan partially or fully repaid |
| `Liquidated` | commitment-tree | Position liquidated |
| `UsdcSupplied` | commitment-tree | USDC added to pool |
| `UsdcWithdrawn` | commitment-tree | USDC removed from pool |

Events are the primary mechanism for the Writz backend to detect loan repayments and trigger the BTC co-signing release on the Bitcoin side.

---

## Contract Interactions: Full Deposit Flow

```
User (browser)
    │
    │  1. generate ZK deposit proof locally (circom WASM)
    │  2. assemble SPV proof bundle (relayer API or Esplora)
    │
    ▼
commitment-tree.deposit(spv_proof, zk_proof)
    │
    ├──► bitcoin-spv.verify_transaction(headers, merkle_proof, tx_index, raw_tx, 6)
    │         returns: VerificationResult { txid, block_hash, outputs }
    │
    ├──► zk-verifier.verify_groth16(Deposit, proof, [commitment, txid])
    │         returns: bool (true = valid)
    │
    ├── store: pending_commitment[txid] = commitment
    └── emit: DepositVerified { txid, commitment }

Admin/relayer calls:
commitment-tree.insert_commitment(commitment)
    ├── compute new Merkle root (Poseidon hash of commitment + siblings)
    ├── store: merkle_root = new_root
    └── emit: CommitmentInserted { commitment, new_root, leaf_index }
```

---

**Next:** [Developer Quick Start →](../developers/quick-start.md)
