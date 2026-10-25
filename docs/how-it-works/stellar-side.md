---
title: "The Stellar Side"
---

**Two contracts, one system - how Writz lives on Soroban.**

The Stellar side of Writz v1 consists of two Soroban smart contracts (`bitcoin-spv` and `writz-lend`), Circle's native USDC, the Reflector BTC/USD oracle, and an off-chain relayer that submits Bitcoin headers and co-signs releases. This page walks through each component, how they interact, and the design decisions behind them. Positions are plaintext: amounts, collateral and addresses are public on chain.

---

## The Contracts

```
      Reflector oracle        USDC (SAC)
             │                    │
             └────────┬───────────┘
                      │
   relayer  ──►  writz-lend  ──►  bitcoin-spv  ◄──  relayer
 (release PSBT)                                  (header submission)
```

### 1. bitcoin-spv

Verifies Bitcoin transactions on Soroban using Simplified Payment Verification. It keeps a compact header chain on Stellar, anchored at a checkpoint, and proves transactions against it (see [SPV Verification](/how-it-works/spv-verification)). `verify_transaction` takes a block hash, a Merkle proof, the transaction index and the raw transaction, and returns a `SpvVerificationResult` (defined once in the shared `spv-types` crate) containing the txid, block hash, block height and confirmation count.

It also holds the shared deposit registry: `consume_deposit` records a Bitcoin txid the first time a registered lending contract uses it, so the same output can never back two positions.

**Deployed:** `CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP`

---

### 2. writz-lend

The lending contract. It registers Bitcoin deposits as positions keyed by txid, runs the USDC pool, accrues interest, handles liquidation and stores the co-signed release PSBT. Positions are plaintext.

**Key functions** (simplified - `deposit` also takes the full SPV arguments, see `contracts/contracts/writz-lend/src/lib.rs`):

```rust
// Deposit: rebuilds the Writz P2WSH from the protocol key, user_pubkey and timelock_height,
// verifies SPV, checks key_sig, consumes the txid and creates a position keyed by txid.
pub fn deposit(depositor: Address, /* SPV proof args */, p2wsh_script_pubkey: Bytes, timelock_height: u32, user_pubkey: BytesN<33>, key_sig: BytesN<65>) -> Result<BytesN<32>, WritzLendError>

// Supply / withdraw USDC to and from the pool (scaled balances that grow with interest).
pub fn supply_usdc(supplier: Address, amount: i128) -> Result<(), WritzLendError>
pub fn withdraw_supply(supplier: Address, amount: i128) -> Result<(), WritzLendError>

// Borrow: checks the 150% collateral ratio at the current oracle price, pool liquidity and the total borrow cap.
pub fn borrow(borrower: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), WritzLendError>

// Repay: reduces outstanding debt. Emits `repay`, or `repay_full` and closes the position when the debt reaches zero.
pub fn repay(repayer: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), WritzLendError>

// Liquidate: the designated keeper, or anyone once the keeper is stale (24h) - checks oracle undercollateralization (< 120%).
pub fn liquidate(keeper: Address, txid: BytesN<32>) -> Result<(), WritzLendError>

// Relayer only: store the co-signed Path A release PSBT for a repaid position; anyone can read it back.
pub fn publish_release_psbt(relayer: Address, txid: BytesN<32>, psbt: Bytes) -> Result<(), WritzLendError>
pub fn get_release_psbt(txid: BytesN<32>) -> Option<Bytes>
```

**Security properties:**
- The deposit output must be exactly the P2WSH of the Writz script for the protocol key in the contract's config, so BTC the depositor could spend alone can never become collateral
- `key_sig` is a BIP-137 signature by `user_pubkey` over a message naming this contract, the depositor and the txid, so nobody can register someone else's deposit
- The timelock must lie 1,008..=105,000 blocks above the confirming block
- Liquidation pays the liquidator a USDC bonus from the protocol reserve and never moves BTC (GHSA-5rxp-7f9g-r66x)
- A pause (`set_paused`) stops new deposits, borrows and supply, never `repay`, `withdraw_supply`, `liquidate` or `publish_release_psbt`

**Events emitted** (topic strings, matching `contracts/contracts/writz-lend/src/events.rs` exactly): `deposit`, `borrow`, `repay`, `repay_full` (emitted instead of `repay` when a repayment fully closes the debt), `liquidate`, `supply`, `withdraw`, `paused_set`, `oracle_set`.

**Deployed:** `CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK`

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
| Protocol fee | 15% | Share of interest kept as the protocol reserve; the rest goes to USDC suppliers |

**Rate examples:**

| Utilization | Borrow APR | Supply APR |
|---|---|---|
| 0% | 0% | 0% |
| 50% | 5.33% | 2.27% |
| 75% | 8.00% | 5.10% |
| 90% | 128.0% | 97.9% |
| 100% | 208.0% | 176.8% |

Supply APR = borrow APR x utilization x (1 - 15%), as in `contracts/contracts/writz-lend/src/rates.rs`.

Interest accrues continuously. Every position-touching call (borrow, repay, liquidate) applies accrued interest before processing the action.

---

## Oracle Design

Writz uses a multi-oracle approach for BTC/USD price feeds, with a **median aggregation** strategy to resist price manipulation.

**Primary oracle:** Pyth Network (pull model, verifier contract - real cross-exchange BTC/USD)
**Secondary oracle:** Reflector's external-prices instance (SEP-40 interface, `lastprice({"Other":"BTC"})`) - confirmed live on testnet with a real, updating BTC/USD price

*(Corrected 2026-09-16, then re-verified by directly calling both contracts on testnet - see `docs/research/oracle-design.md`. RedStone was dropped: it doesn't list Stellar among its supported chains. DIA was parked: its documented testnet contract address returns "contract not found" when queried.)*

**Staleness check:** Price data older than 60 minutes is rejected (corrected - previously stated 90 seconds; see `docs/research/oracle-design.md` for rationale). At full design maturity, borrowing and liquidation pause when both oracles are stale.

**Interim status (2026-09-17):** only Reflector is wired into `writz-lend` today - see `contracts/contracts/writz-lend/src/oracle.rs`. There is no median yet, so "both oracles stale" does not apply; a stale or unavailable Reflector price alone currently blocks the calling operation (`OraclePriceStale`/`OraclePriceUnavailable`) rather than silently mispricing. Do not treat this as the finished manipulation-resistance story until Pyth is also wired - see `docs/security/security-model.md` for the same caveat.

**Manipulation resistance:**
- Median of two oracles: a single oracle manipulation requires moving the median
- Liquidation smoothing (design): large liquidations could be executed in parts to blunt single-block oracle manipulation; not implemented in `writz-lend` today

**SEP-40 interface:** `writz-lend` calls a real Reflector oracle live over the Stellar SEP-40 standard interface (`contracts/contracts/writz-lend/src/oracle.rs`); (The privacy edition's `commitment-tree` still uses a hardcoded stub; it is not part of v1.) For `writz-lend`, switching oracle providers requires only updating the oracle contract address - no changes to lending logic.

---

## Storage and TTL Management

Soroban's storage has a time-to-live (TTL) system. Every persistent entry has an expiration point; an entry past it is archived, not deleted. An archived entry cannot be read or overwritten until it is restored, unchanged, which the RPC's simulation does automatically for any entry a transaction touches (the transaction pays the restore). So an archived position still blocks a second deposit of the same txid, and comes back with its debt when it is next used.

The transaction that creates an entry pays rent for its whole window, at the rate the network charges at that moment. The windows for entries created per use are therefore set at deployment:

| Entry type | Contract | TTL window | Mainnet | Testnet |
|---|---|---|---|---|
| Position (by txid) | writz-lend | `entry_ttl_ledgers` | 180 days | 40 days |
| Per-lender supply balances | writz-lend | `entry_ttl_ledgers` | 180 days | 40 days |
| Published release PSBT (by txid) | writz-lend | `entry_ttl_ledgers` | 180 days | 40 days |
| Header and height index (two per block) | bitcoin-spv | `header_ttl_ledgers` | 90 days | 7 days |
| Consumed deposit txid | bitcoin-spv | `consumed_ttl_ledgers` | 90 days | 7 days |
| Config / Protocol accounting | writz-lend | fixed | 90 days | 90 days |
| Config / Checkpoint / best tip | bitcoin-spv | fixed | 90 days | 90 days |

Testnet runs short windows because its live state is above the network's target size, which prices rent far higher than on mainnet: a 180-day position would cost more resource fee than one transaction can carry. Seven days is the network's minimum persistent TTL, so a 7-day window adds no rent beyond what creating the entry already costs. An entry that is read or rewritten in the last third of its window (at most its last 30 days) is extended back to its full window.

The admin can change these windows without a redeploy (`set_entry_ttl` on writz-lend, `set_ttls` on bitcoin-spv, same bounds as the constructors), so they can follow the rent rate. A change applies to entries written or touched after it; existing entries keep their TTL until a call tops them up or refreshes them.

**Permissionless refresh:** every entry above has a public `refresh_*` function (or is covered by a contract-wide `refresh_ttl`/`refresh_instance_ttl`) that extends its TTL. Any keeper - including Writz's own keeper, a third-party keeper, or even the user themselves - can call these to prevent expiry. No permission required. This is a genuinely load-bearing safety net, not a nice-to-have: none of these entries auto-renews just from being read by an unrelated call, and an idle deployment (low traffic, or a position nobody touches for months) is exactly the case these functions exist for.

```rust
// writz-lend
pub fn refresh_position_ttl(env: Env, txid: BytesN<32>) -> bool
pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool
pub fn refresh_protocol_ttl(env: Env)
pub fn refresh_release_psbt_ttl(env: Env, txid: BytesN<32>) -> bool

// bitcoin-spv
pub fn refresh_ttl(env: Env)  // extends Config, Checkpoint, the best tip and its header
```

`writz-lend`'s `refresh_release_psbt_ttl` is a recent addition - before it, a published release PSBT could only have its TTL bumped as a side effect of fetching or re-publishing it, with no standalone way to keep it alive.

---

## Events

Contract state changes emit structured events using Soroban's `#[contractevent]` annotation. Topic strings below match `events.rs` in each contract exactly - an indexer or the relayer's event watcher must filter on these, not on invented names.

| Topic | Contract | When emitted |
|---|---|---|
| `deposit` | writz-lend | SPV deposit accepted, position created |
| `borrow` | writz-lend | USDC loan issued |
| `repay` | writz-lend | Loan partially repaid |
| `repay_full` | writz-lend | Loan fully repaid, position closed (emitted instead of `repay`) |
| `liquidate` | writz-lend | Position liquidated |
| `supply` | writz-lend | Lender supplied USDC to the pool |
| `withdraw` | writz-lend | Lender withdrew USDC from the pool |
| `paused_set` | writz-lend | Admin paused or unpaused new deposits/borrows/supply |
| `oracle_set` | writz-lend | Admin changed the oracle address |

`supply`/`withdraw` carry `supplier`, `usdc_amount`, and the resulting `total_supplied` - enough to enumerate every lender an off-chain indexer needs, the same way `deposit` events let you enumerate borrowers (see `docs/architecture/contract-migration-runbook.md`).

Events are the primary mechanism for the Writz backend to detect loan repayments (`repay_full` on `writz-lend`) and trigger the BTC co-signing release on the Bitcoin side - see `relayer/src/repay-watcher/`.

---

## Contract Interactions: Full Deposit Flow

```
User (browser)
    │
    │  1. fetch the SPV proof bundle (relayer API or Esplora)
    │  2. sign the key-control message with the Bitcoin wallet (BIP-137)
    │
    ▼
writz-lend.deposit(spv_proof, p2wsh_script_pubkey, timelock_height, user_pubkey, key_sig)
    │
    ├── check: p2wsh_script_pubkey == P2WSH(protocol key, user_pubkey, timelock_height)
    ├──► bitcoin-spv.verify_transaction(block_hash, merkle_proof, tx_index, raw_tx, min_confirmations)
    │         returns: SpvVerificationResult { txid, block_hash, block_height, confirmations }
    ├── check: timelock_height within 1,008..=105,000 blocks above block_height
    ├── check: key_sig is user_pubkey's signature over (contract, depositor, txid)
    ├──► bitcoin-spv.consume_deposit(writz-lend, txid)   (shared registry: one position per output)
    ├── read: amount paid to the P2WSH output in raw_tx; require >= min_deposit_satoshis
    │
    ├── store: position[txid] = { depositor, btc_satoshis, user_pubkey, timelock_height, debt: 0 }
    └── emit: DepositEvent { txid, btc_satoshis, timelock_height }

On full repayment:
writz-lend.repay(...)  ──►  emit: RepayFullEvent { txid, repayer, p2wsh_script_pubkey }
relayer repay watcher  ──►  build + co-sign Path A PSBT  ──►  writz-lend.publish_release_psbt(txid, psbt)
User                   ──►  writz-lend.get_release_psbt(txid), sign with Bitcoin wallet, broadcast
```

---

## Privacy edition contracts (in progress, not part of v1)

`zk-verifier` and `commitment-tree` are deployed on testnet for the separate, opt-in [privacy edition (in progress)](/how-it-works/privacy-edition). They have their own pool, and `writz-lend` never calls them; the only thing they share with v1 is `bitcoin-spv` and its deposit registry. The summary below records their current design.

### zk-verifier

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

**Deployed:** `CB5XAP6MF2GVVFATFTVCKVEXUODWWRQP4B3QFDMRTM55REP7N2YMXEUD`  
All three verification keys are set on testnet (Deposit IC=6, BorrowRepay IC=9, Liquidation IC=6).

---

### commitment-tree

The privacy edition's lending contract. Manages the Poseidon Merkle commitment tree and all ZK-gated lending operations. This is where positions are created, loans are issued, and repayments are recorded.

**Key functions** (simplified signatures - see `privacy/contracts/commitment-tree/src/lib.rs` for the exact ABI, including the full SPV header/Merkle-proof arguments `deposit` also takes):

```rust
// Deposit: verify SPV, the depositor's Writz script and the ZK proof; create commitment. Returns the new commitment.
pub fn deposit(depositor: Address, /* SPV proof args */, user_pubkey: BytesN<33>, timelock_height: u32, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<BytesN<32>, CommitmentTreeError>

// Insert a pending commitment into the Merkle tree, with a proof that the new root is the
// old one plus this leaf in the next empty slot (#211). Admin/relayer. Emits `insert_leaf`.
pub fn insert_commitment(caller: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<(), CommitmentTreeError>

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

**Events emitted** (topic strings, matching `privacy/contracts/commitment-tree/src/events.rs` exactly): `deposit`, `insert_leaf`, `borrow`, `repay`, `liquidate`. There is currently no event for `supply_usdc`/`withdraw_supply` - an indexer tracking pool liquidity needs to read `get_pool_state`/`get_supply_balance` directly rather than listen for an event that doesn't exist.

**Security properties:**
- The `borrow` amount is extracted from the ZK proof's public signal - the caller cannot supply an arbitrary amount
- The `repay` amount is recovered from field-negation inversion of the proof's delta signal
- The `liquidate` `usdc_debt` is extracted from the proof - the liquidator cannot inflate the debt they claim
- Nullifier freshness is checked before any state change - double-spending is impossible
- Merkle root must match the current on-chain root - stale proofs are rejected

**Deployed:** `CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM`

---

**Next:** [Developer Quick Start →](/developers/quick-start)
