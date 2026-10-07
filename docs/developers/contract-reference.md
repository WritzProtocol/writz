---
title: "Contract Reference"
---

The public interface of the four Writz Soroban contracts, as defined on `main`.
Every function below is copied from the contract source, with the first
paragraph of its doc comment; `env: Env` is omitted. The source is the
authority: `contracts/contracts/<name>/src/lib.rs`, and the generated
TypeScript bindings in `packages/` and `frontend/app/src/lib/contracts/`.

Every contract is configured by its `__constructor`, which runs inside the
deploy transaction. There is no separate `initialize` call. To deploy and
wire up all four, use `scripts/deploy/deploy_stack.mjs` (see #177 for the
order and arguments).

**Testnet addresses:**

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| `zk-verifier` | `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| `commitment-tree` | `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP` |
| `private-lend` | `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR` |

These instances predate the security fixes and run the older interfaces, not
the ones documented here. They are replaced in the coordinated redeploy (#177).

---

## bitcoin-spv

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`): no separate initialize transaction exists for anyone to front-run (GHSA-422m-f73x-fh58).

```rust
pub fn __constructor(admin: Address, pow_limit_bits: u32)
```

### `set_checkpoint`

Sets the trust-root checkpoint. Admin-gated and callable exactly once: after this the chain only grows through `submit_headers`, so the admin cannot later rewrite which chain is trusted.

```rust
pub fn set_checkpoint(caller: Address, height: u32, block_hash: BytesN<32>, bits: u32, time: u32, period_start_time: u32) -> Result<(), SPVError>
```

### `set_consumer`

Registers (or removes) a lending contract allowed to consume deposit txids. Admin-only. Both lending contracts share one txid registry so the same Bitcoin output cannot back loans from both pools (GHSA-2975-ggwh-pxw5).

```rust
pub fn set_consumer(caller: Address, consumer: Address, allowed: bool) -> Result<(), SPVError>
```

### `consume_deposit`

Marks a deposit txid as consumed by a lending contract. Fails if the caller is not a registered consumer or the txid was already consumed. Called by each lending contract's `deposit` after its own checks.

```rust
pub fn consume_deposit(consumer: Address, txid: BytesN<32>) -> Result<(), SPVError>
```

### `is_deposit_consumed`

Returns whether a deposit txid has already been consumed.

```rust
pub fn is_deposit_consumed(txid: BytesN<32>) -> bool
```

### `set_submitter`

Restricts `submit_headers` to `submitter`, or reopens it to everyone with `None`. Admin-gated.

```rust
pub fn set_submitter(caller: Address, submitter: Option<Address>) -> Result<(), SPVError>
```

### `set_admin`

Rotates the admin address. Admin-gated.

```rust
pub fn set_admin(caller: Address, new_admin: Address) -> Result<(), SPVError>
```

### `get_checkpoint`

Returns the checkpoint, or `None` if never set.

```rust
pub fn get_checkpoint() -> Option<Checkpoint>
```

### `get_best_tip`

Returns the tip of the most-work chain, or `None` before the checkpoint is set.

```rust
pub fn get_best_tip() -> Option<BestTip>
```

### `get_header`

Returns the stored header for `block_hash`, if any.

```rust
pub fn get_header(block_hash: BytesN<32>) -> Option<HeaderEntry>
```

### `get_canonical_hash`

Returns the most-work chain's block hash at `height`, if known.

```rust
pub fn get_canonical_hash(height: u32) -> Option<BytesN<32>>
```

### `refresh_ttl`

Extends the TTL of the Config, Checkpoint and best-tip entries. Permissionless - anyone can call this to keep an inactive deployment from expiring.

```rust
pub fn refresh_ttl()
```

### `submit_headers`

Adds a run of contiguous block headers to the light client.

```rust
pub fn submit_headers(headers: Vec<BytesN<80>>) -> Result<u32, SPVError>
```

### `verify_transaction`

Verify that a Bitcoin transaction is included in a confirmed block of the most-work chain this contract tracks.

```rust
pub fn verify_transaction(block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes, min_confirmations: u32) -> Result<SpvVerificationResult, SPVError>
```

---

## zk-verifier

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`). The admin is the only account that can call `set_verification_key`.

```rust
pub fn __constructor(admin: Address)
```

### `set_verification_key`

Store or replace the verification key for a circuit.

```rust
pub fn set_verification_key(caller: Address, circuit: CircuitId, vk: VerificationKey) -> Result<(), ZkVerifierError>
```

### `get_verification_key`

Returns the stored verification key for a circuit, or None.

```rust
pub fn get_verification_key(circuit: CircuitId) -> Option<VerificationKey>
```

### `refresh_ttl`

Extends the TTL of the admin entry and every set verification key. Permissionless - call on a schedule so an infrequently-used deployment doesn't silently expire and start failing proof verification with `VerificationKeyNotSet`.

```rust
pub fn refresh_ttl()
```

### `verify_deposit`

Verify a Groth16 proof for the deposit circuit.

```rust
pub fn verify_deposit(proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<bool, ZkVerifierError>
```

### `verify_borrow_repay`

Verify a Groth16 proof for the borrow/repay circuit.

```rust
pub fn verify_borrow_repay(proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<bool, ZkVerifierError>
```

### `verify_zero_debt`

Verify a Groth16 proof for the zero-debt release circuit.

```rust
pub fn verify_zero_debt(proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<bool, ZkVerifierError>
```

### `verify_liquidation`

Verify a Groth16 proof for the liquidation circuit.

```rust
pub fn verify_liquidation(proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<bool, ZkVerifierError>
```

### `verify_insert`

Verify a Groth16 proof for the Merkle insertion circuit.

```rust
pub fn verify_insert(proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<bool, ZkVerifierError>
```

### Events

Topic fields are in **bold**.

| Event | Topic | Fields |
|---|---|---|
| `VkRotatedEvent` | `vk_rotated` | **new_vk_hash**, circuit, old_vk_hash |

---

## commitment-tree

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`) - see GHSA-422m-f73x-fh58.

```rust
pub fn __constructor(admin: Address, spv_contract: Address, zk_verifier: Address, usdc_token: Address, oracle: Address, min_confirmations: u32, protocol_pubkey: BytesN<33>)
```

### `deposit`

Register a BTC deposit with a ZK commitment.

```rust
pub fn deposit(depositor: Address, block_hash: BytesN<32>, merkle_proof_btc: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes, user_pubkey: BytesN<33>, timelock_height: u32, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<BytesN<32>, CommitmentTreeError>
```

### `insert_commitment`

Insert a pending commitment into the Merkle tree and advance the root.

```rust
pub fn insert_commitment(caller: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<(), CommitmentTreeError>
```

### `borrow`

Borrow USDC against a BTC position using a ZK proof.

```rust
pub fn borrow(borrower: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<(), CommitmentTreeError>
```

### `mark_released`

Records that a fully repaid position's BTC has been released, by spending the zero-debt leaf's nullifier (GHSA-w4rp-v54x-2cv3, GHSA-hcjf-8vjc-2hfv). After this, `borrow` on that leaf fails its nullifier check.

```rust
pub fn mark_released(zk_proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<(), CommitmentTreeError>
```

### `repay`

Repay USDC debt on a ZK position.

```rust
pub fn repay(repayer: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>, enc_note: Bytes) -> Result<(), CommitmentTreeError>
```

### `liquidate`

Liquidate an undercollateralized position using a ZK proof.

```rust
pub fn liquidate(keeper: Address, zk_proof: Proof, public_signals: Vec<BytesN<32>>) -> Result<(), CommitmentTreeError>
```

### `supply_usdc`

Lender supplies USDC to the pool to earn yield from borrower interest.

```rust
pub fn supply_usdc(supplier: Address, amount: i128) -> Result<(), CommitmentTreeError>
```

### `withdraw_supply`

Lender withdraws USDC from the pool.

```rust
pub fn withdraw_supply(supplier: Address, amount: i128) -> Result<(), CommitmentTreeError>
```

### `set_oracle`

Updates the oracle contract address used for BTC/USD pricing. Admin only.

```rust
pub fn set_oracle(caller: Address, new_oracle: Address) -> Result<(), CommitmentTreeError>
```

### `set_spv_contract`

Updates the bitcoin-spv contract address used for deposit verification. Admin only. Changing this mid-flight affects only deposits submitted after the change - an in-flight deposit's SPV proof was already verified against the previous contract by the time this would run.

```rust
pub fn set_spv_contract(caller: Address, new_spv_contract: Address) -> Result<(), CommitmentTreeError>
```

### `set_zk_verifier`

Updates the zk-verifier contract address used for ZK proof verification. Admin only. Changing this mid-flight affects only proofs submitted after the change.

```rust
pub fn set_zk_verifier(caller: Address, new_zk_verifier: Address) -> Result<(), CommitmentTreeError>
```

### `set_paused`

Pauses or unpauses new deposits/borrows/USDC supply. Admin only.

```rust
pub fn set_paused(caller: Address, paused: bool) -> Result<(), CommitmentTreeError>
```

### `refresh_nullifier_ttl`

Extend the TTL of a spent-nullifier entry to another 180-day window.

```rust
pub fn refresh_nullifier_ttl(nullifier: BytesN<32>) -> bool
```

### `refresh_commitment_ttl`

Extend the TTL of the Bitcoin txid → commitment dedup record.

```rust
pub fn refresh_commitment_ttl(txid: BytesN<32>) -> bool
```

### `refresh_merkle_root_ttl`

Extend the TTL of the on-chain Merkle root to another 180-day window.

```rust
pub fn refresh_merkle_root_ttl()
```

### `refresh_pool_ttl`

Extend the TTL of the USDC pool accounting entry.

```rust
pub fn refresh_pool_ttl()
```

### `refresh_supply_balance_ttl`

Extend the TTL of a lender's supply balance entry.

```rust
pub fn refresh_supply_balance_ttl(lender: Address) -> bool
```

### `refresh_instance_ttl`

Extend the instance storage TTL to another 90-day window.

```rust
pub fn refresh_instance_ttl()
```

### `get_merkle_root`

Returns the current Poseidon Merkle root of the position commitment tree.

```rust
pub fn get_merkle_root() -> BytesN<32>
```

### `is_nullifier_spent`

Returns true if the nullifier has already been spent.

```rust
pub fn is_nullifier_spent(nullifier: BytesN<32>) -> bool
```

### `get_commitment`

Returns the commitment for a Bitcoin txid, or None if not deposited.

```rust
pub fn get_commitment(txid: BytesN<32>) -> Option<BytesN<32>>
```

### `get_next_leaf_index`

Returns the index of the next empty Merkle leaf - the `leaf_index` the next insertion proof must target.

```rust
pub fn get_next_leaf_index() -> u32
```

### `is_commitment_pending`

Returns true if a commitment is pending Merkle tree insertion.

```rust
pub fn is_commitment_pending(commitment: BytesN<32>) -> bool
```

### `get_pool_state`

Returns `(total_supplied, total_borrowed)` in USDC stroops.

```rust
pub fn get_pool_state() -> (i128, i128)
```

### `get_supply_balance`

Returns the USDC supply balance (in stroops) for a lender.

```rust
pub fn get_supply_balance(lender: Address) -> i128
```

### Events

Topic fields are in **bold**.

| Event | Topic | Fields |
|---|---|---|
| `DepositEvent` | `deposit` | **commitment**, depositor, txid, nullifier, user_pubkey, timelock_height, enc_note |
| `InsertLeafEvent` | `insert_leaf` | **new_root**, commitment, leaf_index |
| `BorrowEvent` | `borrow` | **new_root**, borrower, usdc_amount, old_nullifier, enc_note |
| `RepayEvent` | `repay` | **new_root**, repayer, usdc_amount, old_nullifier, new_commitment, enc_note |
| `LiquidateEvent` | `liquidate` | **nullifier**, keeper, usdc_debt |
| `SupplyEvent` | `supply` | **supplier**, usdc_amount, total_supplied |
| `WithdrawEvent` | `withdraw` | **supplier**, usdc_amount, total_supplied |
| `PausedSetEvent` | `paused_set` | **admin**, paused |

---

## private-lend

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`): no separate initialize transaction exists for anyone to front-run (GHSA-422m-f73x-fh58).

```rust
pub fn __constructor(admin: Address, spv_contract: Address, usdc_token: Address, oracle: Address, keeper: Address, relayer: Address, protocol_pubkey: BytesN<33>)
```

### `deposit`

Register a BTC deposit by submitting an SPV proof.

```rust
pub fn deposit(depositor: Address, block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes, p2wsh_script_pubkey: Bytes, timelock_height: u32, user_pubkey: BytesN<33>) -> Result<BytesN<32>, PrivateLendError>
```

### `supply_usdc`

Lender supplies USDC to the pool, making it available for borrowing. Lenders earn `supply_rate_bp()` APR on their supplied amount.

```rust
pub fn supply_usdc(supplier: Address, amount: i128) -> Result<(), PrivateLendError>
```

### `withdraw_supply`

Lender withdraws previously supplied USDC from the pool.

```rust
pub fn withdraw_supply(supplier: Address, amount: i128) -> Result<(), PrivateLendError>
```

### `borrow`

Borrow USDC against an existing BTC deposit.

```rust
pub fn borrow(borrower: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), PrivateLendError>
```

### `repay`

Repay some or all of the USDC debt on a position.

```rust
pub fn repay(repayer: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), PrivateLendError>
```

### `liquidate`

Liquidate an undercollateralized position.

```rust
pub fn liquidate(keeper: Address, txid: BytesN<32>) -> Result<(), PrivateLendError>
```

### `set_max_total_borrowed`

Update the keeper address.  Admin only.

```rust
pub fn set_max_total_borrowed(caller: Address, max: i128) -> Result<(), PrivateLendError>
```

### `set_keeper`

```rust
pub fn set_keeper(caller: Address, new_keeper: Address) -> Result<(), PrivateLendError>
```

### `keeper_heartbeat`

Explicit liveness signal from the designated keeper.

```rust
pub fn keeper_heartbeat(keeper: Address) -> Result<(), PrivateLendError>
```

### `set_keeper_stale_window`

Updates how many seconds of keeper inactivity before liquidation opens to any caller.  Admin only.

```rust
pub fn set_keeper_stale_window(caller: Address, secs: u64) -> Result<(), PrivateLendError>
```

### `set_relayer`

Updates the relayer address authorized to call `publish_release_psbt`. Admin only.

```rust
pub fn set_relayer(caller: Address, new_relayer: Address) -> Result<(), PrivateLendError>
```

### `set_oracle`

Updates the oracle contract address used for BTC/USD pricing. Admin only.

```rust
pub fn set_oracle(caller: Address, new_oracle: Address) -> Result<(), PrivateLendError>
```

### `set_spv_contract`

Updates the bitcoin-spv contract address used for deposit verification. Admin only. Changing this mid-flight affects only deposits submitted after the change - an in-flight deposit's SPV proof was already verified against the previous contract by the time this would run.

```rust
pub fn set_spv_contract(caller: Address, new_spv_contract: Address) -> Result<(), PrivateLendError>
```

### `set_paused`

Pauses or unpauses new deposits/borrows/USDC supply. Admin only.

```rust
pub fn set_paused(caller: Address, paused: bool) -> Result<(), PrivateLendError>
```

### `publish_release_psbt`

Publishes a co-signed Path A release PSBT for a repaid position.

```rust
pub fn publish_release_psbt(relayer: Address, txid: BytesN<32>, psbt: Bytes) -> Result<(), PrivateLendError>
```

### `get_release_psbt`

Returns the relayer-published release PSBT for a position, or `None` if the relayer hasn't published one yet (or the position was never fully repaid).

```rust
pub fn get_release_psbt(txid: BytesN<32>) -> Option<Bytes>
```

### `get_position`

Returns the position for the given Bitcoin txid, or `None`.

```rust
pub fn get_position(txid: BytesN<32>) -> Option<Position>
```

### `get_health_ratio_bp`

Returns the health ratio (in basis points) for a position.

```rust
pub fn get_health_ratio_bp(txid: BytesN<32>) -> Result<i128, PrivateLendError>
```

### `get_borrow_rate_bp`

Current annual borrow rate in basis points (e.g. 800 = 8%).

```rust
pub fn get_borrow_rate_bp() -> i128
```

### `get_supply_rate_bp`

Current annual supply rate in basis points.

```rust
pub fn get_supply_rate_bp() -> i128
```

### `get_protocol_state`

Returns a snapshot of the global protocol state.

```rust
pub fn get_protocol_state() -> ProtocolState
```

### `get_supply_balance`

Returns the USDC supply balance (in stroops) for a lender.

```rust
pub fn get_supply_balance(lender: Address) -> i128
```

### `refresh_position_ttl`

Extend the TTL of a position entry to another 180-day window.

```rust
pub fn refresh_position_ttl(txid: BytesN<32>) -> bool
```

### `refresh_supply_balance_ttl`

Extend the TTL of a lender's supply balance entry to another 180-day window.

```rust
pub fn refresh_supply_balance_ttl(lender: Address) -> bool
```

### `refresh_protocol_ttl`

Extend the TTL of the global protocol accounting entry.

```rust
pub fn refresh_protocol_ttl()
```

### `refresh_release_psbt_ttl`

Extend the TTL of a published release PSBT to another window.

```rust
pub fn refresh_release_psbt_ttl(txid: BytesN<32>) -> bool
```

### Events

Topic fields are in **bold**.

| Event | Topic | Fields |
|---|---|---|
| `DepositEvent` | `deposit` | **txid**, btc_satoshis, timelock_height |
| `BorrowEvent` | `borrow` | **txid**, borrower, usdc_amount |
| `RepayFullEvent` | `repay_full` | **txid**, repayer, p2wsh_script_pubkey |
| `RepayEvent` | `repay` | **txid**, usdc_amount |
| `LiquidateEvent` | `liquidate` | **txid**, keeper, bonus_paid |
| `SupplyEvent` | `supply` | **supplier**, usdc_amount, total_supplied |
| `WithdrawEvent` | `withdraw` | **supplier**, usdc_amount, total_supplied |
| `PausedSetEvent` | `paused_set` | **admin**, paused |
| `OracleSetEvent` | `oracle_set` | **admin**, new_oracle |
