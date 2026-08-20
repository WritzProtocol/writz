# The Stellar Side

**Four contracts, one system - how Writz lives on Soroban.**

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

Verifies Bitcoin transactions on Soroban using Simplified Payment Verification. Completely stateless - no Bitcoin headers are stored on-chain. Takes a proof bundle (headers + Merkle proof + raw transaction) and returns a `SpvVerificationResult` (defined once in the shared `spv-types` crate, not duplicated per contract) containing the txid, block hash, and confirmation count.

This contract is called first in every deposit flow. Its output - specifically the `txid` - is passed to the commitment-tree contract and bound into the ZK proof, ensuring every position corresponds to a real Bitcoin transaction.

**Deployed:** `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA`

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

Returns `true` if the proof is valid, `false` otherwise. Malformed proofs (invalid curve points) cause the host to reject the transaction entirely - the correct security behavior.

**Deployed:** `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY`  
All three verification keys are set on testnet (Deposit IC=6, BorrowRepay IC=9, Liquidation IC=6).

---

### 3. commitment-tree

The core privacy and lending contract. Manages the Poseidon Merkle commitment tree and all ZK-gated lending operations. This is where positions are created, loans are issued, and repayments are recorded.

**Key functions** (simplified signatures - see `contracts/contracts/commitment-tree/src/lib.rs` for the exact ABI, including the full SPV header/Merkle-proof arguments `deposit` also takes):

```rust
// Deposit: verify SPV + ZK, create commitment. Returns the new commitment.
pub fn deposit(depositor: Address, /* SPV proof args */, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<BytesN<32>, CommitmentTreeError>

// Insert a pending commitment into the Merkle tree (admin/relayer in Phase 1). Emits `insert_leaf`.
pub fn insert_commitment(caller: Address, commitment: BytesN<32>, new_root: BytesN<32>) -> Result<(), CommitmentTreeError>

// Borrow: ZK proof + oracle price → USDC transferred to borrower.
pub fn borrow(borrower: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<(), CommitmentTreeError>

// Repay: ZK proof → outstanding debt reduced.
pub fn repay(repayer: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<(), CommitmentTreeError>

// Liquidate: ZK undercollateral proof → keeper collects proven debt amount.
pub fn liquidate(keeper: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<(), CommitmentTreeError>

// Supply USDC to the pool.
pub fn supply_usdc(supplier: Address, amount: i128) -> Result<(), CommitmentTreeError>

// Withdraw USDC supply.
pub fn withdraw_supply(supplier: Address, amount: i128) -> Result<(), CommitmentTreeError>
```

**Events emitted** (topic strings, matching `contracts/contracts/commitment-tree/src/events.rs` exactly): `deposit`, `insert_leaf`, `borrow`, `repay`, `liquidate`. There is currently no event for `supply_usdc`/`withdraw_supply` - an indexer tracking pool liquidity needs to read `get_pool_state`/`get_supply_balance` directly rather than listen for an event that doesn't exist.

**Security properties:**
- The `borrow` amount is extracted from the ZK proof's public signal - the caller cannot supply an arbitrary amount
- The `repay` amount is recovered from field-negation inversion of the proof's delta signal
- The `liquidate` `usdc_debt` is extracted from the proof - the liquidator cannot inflate the debt they claim
- Nullifier freshness is checked before any state change - double-spending is impossible
- Merkle root must match the current on-chain root - stale proofs are rejected

**Deployed:** `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP`

---

### 4. private-lend

A non-ZK lending skeleton that provides the borrowing and repayment interface without the ZK layer. Used for:
- Phase 1 testing (simpler than the full ZK flow)
- A reference implementation showing the core lending mechanics
- Future: may be used as a "fast lane" for users who opt out of ZK privacy

**Key functions** (simplified - `deposit` also takes the full SPV header/Merkle-proof args plus the P2WSH script details, see `contracts/contracts/private-lend/src/lib.rs`):

```rust
// Deposit: verifies SPV directly, creates a transparent position keyed by txid.
pub fn deposit(depositor: Address, /* SPV proof args */, p2wsh_script_pubkey: Bytes, timelock_height: u32, user_pubkey: BytesN<33>) -> Result<BytesN<32>, PrivateLendError>

// Borrow: checks collateral ratio at current oracle price → USDC transferred.
pub fn borrow(borrower: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), PrivateLendError>

// Repay: reduces outstanding debt. Emits `repay`, and `repay_full` additionally when the debt reaches zero.
pub fn repay(repayer: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), PrivateLendError>

// Liquidate: the designated keeper, or anyone once the keeper is stale - checks oracle undercollateralization.
pub fn liquidate(keeper: Address, txid: BytesN<32>) -> Result<(), PrivateLendError>
```

**Events emitted** (topic strings, matching `contracts/contracts/private-lend/src/events.rs` exactly): `deposit`, `borrow`, `repay`, `repay_full` (emitted in addition to `repay` when a repayment fully closes the debt), `liquidate`.

**Deployed:** `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR`

---

## Interest Rate Model

Writz uses a **kinked utilization curve** - the same model pioneered by Aave and Compound, adapted for Writz's parameters.

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
| `slope2` | 200% APR | Steep increase above target - strong incentive to repay/supply |
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

**Primary oracle:** RedStone (pull model, SEP-40 interface)  
**Secondary oracle:** Pyth Network (pull model, SEP-40 interface)

**Staleness check:** Price data older than 60 minutes is rejected (corrected - previously stated 90 seconds; see `docs/research/oracle-design.md` for rationale). If both oracles are stale, borrowing and liquidation are paused until fresh prices are available.

**Manipulation resistance:**
- Median of two oracles: a single oracle manipulation requires moving the median
- Liquidation smoothing: large liquidations can be executed in tranches to prevent single-block oracle manipulation attacks

**SEP-40 interface:** The oracle stub in both contracts follows the Stellar SEP-40 standard interface. Switching oracle providers requires only updating the oracle contract address - no changes to lending logic.

---

## Storage and TTL Management

Soroban's storage has a time-to-live (TTL) system. Every storage entry has an expiration point; entries that are not accessed eventually expire and are deleted.

Writz manages TTL per-entry (not one contract-wide setting) to ensure user positions never expire unexpectedly:

| Entry type | Contract | TTL window |
|---|---|---|
| Spent nullifiers | commitment-tree | 180-day window (near Soroban mainnet max) |
| Merkle root | commitment-tree | 180-day window |
| ZK commitments (by txid) | commitment-tree | 180-day window |
| USDC pool balance | commitment-tree | 90-day window |
| Per-lender supply balances | commitment-tree | 90-day window |
| Position (by txid) | private-lend | 180-day window |
| Per-lender supply balances | private-lend | 180-day window |
| Config / Protocol accounting | private-lend | 90-day window |
| Published release PSBT (by txid) | private-lend | 90-day window |
| Config / Checkpoint | bitcoin-spv | 90-day window |
| Admin | zk-verifier | 90-day window (instance storage) |
| Verification key (per circuit) | zk-verifier | 90-day window |

**Permissionless refresh:** every entry above has a public `refresh_*` function (or is covered by a contract-wide `refresh_ttl`/`refresh_instance_ttl`) that extends its TTL. Any keeper - including Writz's own keeper, a third-party keeper, or even the user themselves - can call these to prevent expiry. No permission required. This is a genuinely load-bearing safety net, not a nice-to-have: none of these entries auto-renews just from being read by an unrelated call, and an idle deployment (low traffic, or a position nobody touches for months) is exactly the case these functions exist for.

```rust
// commitment-tree
pub fn refresh_nullifier_ttl(env: Env, nullifier: BytesN<32>) -> bool
pub fn refresh_commitment_ttl(env: Env, txid: BytesN<32>) -> bool
pub fn refresh_merkle_root_ttl(env: Env)
pub fn refresh_pool_ttl(env: Env)
pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool
pub fn refresh_instance_ttl(env: Env)

// private-lend
pub fn refresh_position_ttl(env: Env, txid: BytesN<32>) -> bool
pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool
pub fn refresh_protocol_ttl(env: Env)
pub fn refresh_release_psbt_ttl(env: Env, txid: BytesN<32>) -> bool

// bitcoin-spv
pub fn refresh_ttl(env: Env)  // extends Config and Checkpoint together

// zk-verifier
pub fn refresh_ttl(env: Env)  // extends Admin and every set circuit's VerificationKey together
```

`zk-verifier`'s `refresh_ttl` and `private-lend`'s `refresh_release_psbt_ttl` are recent additions - before them, `zk-verifier` had no TTL management at all (a real gap: if a verification key's TTL lapsed, `verify_deposit`/`verify_borrow_repay`/`verify_liquidation` would start failing with `VerificationKeyNotSet` with no prior on-chain warning), and a published release PSBT could only have its TTL bumped as a side effect of fetching or re-publishing it, with no standalone way to keep it alive.

---

## Events

Contract state changes emit structured events using Soroban's `#[contractevent]` annotation. Topic strings below match `events.rs` in each contract exactly - an indexer or the relayer's event watcher must filter on these, not on invented names.

| Topic | Contract | When emitted |
|---|---|---|
| `deposit` | commitment-tree | SPV + ZK deposit accepted |
| `insert_leaf` | commitment-tree | New commitment added to Merkle tree |
| `borrow` | commitment-tree | USDC loan issued |
| `repay` | commitment-tree | Loan partially or fully repaid |
| `liquidate` | commitment-tree | Position liquidated |
| `supply` | commitment-tree | Lender supplied USDC to the pool |
| `withdraw` | commitment-tree | Lender withdrew USDC from the pool |
| `paused_set` | commitment-tree | Admin paused or unpaused new deposits/borrows/supply |
| `deposit` | private-lend | SPV deposit accepted (transparent position) |
| `borrow` | private-lend | USDC loan issued |
| `repay` | private-lend | Loan partially repaid |
| `repay_full` | private-lend | Loan fully repaid (emitted in addition to `repay`) |
| `liquidate` | private-lend | Position liquidated |
| `supply` | private-lend | Lender supplied USDC to the pool |
| `withdraw` | private-lend | Lender withdrew USDC from the pool |
| `paused_set` | private-lend | Admin paused or unpaused new deposits/borrows/supply |
| `vk_rotated` | zk-verifier | A circuit's verification key was set or replaced - carries `old_vk_hash`/`new_vk_hash` fingerprints as the audit trail for rotation, since storage only ever holds the current key |

`supply`/`withdraw` carry `supplier`, `usdc_amount`, and the resulting `total_supplied` - enough to enumerate every lender an off-chain indexer needs, the same way `deposit` events let you enumerate borrowers (see `docs/architecture/contract-migration-runbook.md`).

Events are the primary mechanism for the Writz backend to detect loan repayments (`repay_full` on `private-lend`) and trigger the BTC co-signing release on the Bitcoin side - see `relayer/src/repay-watcher/`.

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
    │         returns: SpvVerificationResult { txid, block_hash, confirmations }
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
