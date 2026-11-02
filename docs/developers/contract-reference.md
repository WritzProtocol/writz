---
title: "Contract Reference"
---

The public interface of the two Soroban contracts of Writz, `bitcoin-spv` and `writz-lend`, as defined on `main`.
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
| `bitcoin-spv` | `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO` |
| `writz-lend` | `CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS` |

`bitcoin-spv` is the instance from the 2026-10-25 redeploy and `writz-lend` the one
from the 2026-11-02 redeploy (#377), which carries the projected views below. See
`contracts/deployments/testnet.md`.

Testnet `bitcoin-spv` and `writz-lend` were redeployed on 2026-10-25 because testnet rent rose sharply: testnet's live state is above its target size, and the previous contracts gave every entry they created the long mainnet storage windows, so a deposit was charged about 428 XLM in fees. The new contracts take those windows as deployment parameters and run testnet-length ones (a deposit was charged about 89 XLM, measured 2026-10-25). Positions on the previous contracts were closed and their BTC released; their IDs are recorded as superseded in `contracts/deployments/testnet.md`. `writz-lend` was redeployed again on 2026-11-01 so its `supply` and `withdraw` events carry the scaled amount and the supply index (#257); `bitcoin-spv` was not. The windows are the `header_ttl_ledgers` and `consumed_ttl_ledgers` arguments of
`bitcoin-spv`'s `__constructor` and the `entry_ttl_ledgers` argument of
`writz-lend`'s (both below); what each entry keeps and when it is extended is in
[Storage and TTL management](/how-it-works/stellar-side#storage-and-ttl-management).

---

## bitcoin-spv

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`): no separate initialize transaction exists for anyone to front-run (GHSA-422m-f73x-fh58).

```rust
pub fn __constructor(admin: Address, pow_limit_bits: u32, header_ttl_ledgers: u32, consumed_ttl_ledgers: u32)
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

### `set_ttls`

Sets how long stored headers (with their height index) and consumed deposit markers are kept live, in ledgers. Admin-gated, same bounds as the constructor (17,280 to 3,110,400, else `InvalidEntryTtl`). Applies to entries written or touched after the change only; emits `ttls_set`.

```rust
pub fn set_ttls(caller: Address, header_ttl_ledgers: u32, consumed_ttl_ledgers: u32) -> Result<(), SPVError>
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

## writz-lend

### `__constructor`

Runs exactly once, atomically, as part of deployment (`__constructor`): no separate initialize transaction exists for anyone to front-run (GHSA-422m-f73x-fh58).

```rust
pub fn __constructor(admin: Address, spv_contract: Address, usdc_token: Address, oracle: Address, keeper: Address, relayer: Address, protocol_pubkey: BytesN<33>, min_confirmations: u32, min_deposit_satoshis: u64, entry_ttl_ledgers: u32)
```

### `deposit`

Register a BTC deposit by submitting an SPV proof. `user_pubkey` must differ from the protocol key, else `UserKeyIsProtocolKey`.

```rust
pub fn deposit(depositor: Address, block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes, p2wsh_script_pubkey: Bytes, timelock_height: u32, user_pubkey: BytesN<33>, key_sig: BytesN<65>) -> Result<BytesN<32>, WritzLendError>
```

### `supply_usdc`

Lender supplies USDC to the pool, making it available for borrowing. Lenders earn `supply_rate_bp()` APR on their supplied amount.

```rust
pub fn supply_usdc(supplier: Address, amount: i128) -> Result<(), WritzLendError>
```

### `withdraw_supply`

Lender withdraws previously supplied USDC from the pool.

```rust
pub fn withdraw_supply(supplier: Address, amount: i128) -> Result<(), WritzLendError>
```

### `borrow`

Borrow USDC against an existing BTC deposit. Every borrow, including a top-up, requires the position's timelock height H to be at least `borrow_timelock_margin_blocks` (4,320 by default) above the `bitcoin-spv` tip, read from a tip header no older than `max_tip_age_secs` (6 hours by default); else `TimelockTooSoon`, or `StaleBitcoinTip` when the tip is missing or too old.

```rust
pub fn borrow(borrower: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), WritzLendError>
```

### `repay`

Repay some or all of the USDC debt on a position.

```rust
pub fn repay(repayer: Address, txid: BytesN<32>, usdc_amount: i128) -> Result<(), WritzLendError>
```

### `liquidate`

Liquidate an undercollateralized position. Accepted only while H is at least `LIQUIDATION_CUTOFF_BLOCKS` (288) above the `bitcoin-spv` tip, read from a fresh tip as for `borrow`; else `LiquidationWindowClosed`, or `StaleBitcoinTip`.

```rust
pub fn liquidate(keeper: Address, txid: BytesN<32>) -> Result<(), WritzLendError>
```

### `set_max_total_borrowed`

Update the keeper address.  Admin only.

```rust
pub fn set_max_total_borrowed(caller: Address, max: i128) -> Result<(), WritzLendError>
```

### `set_keeper`

```rust
pub fn set_keeper(caller: Address, new_keeper: Address) -> Result<(), WritzLendError>
```

### `keeper_heartbeat`

Explicit liveness signal from the designated keeper.

```rust
pub fn keeper_heartbeat(keeper: Address) -> Result<(), WritzLendError>
```

### `set_keeper_stale_window`

Updates how many seconds of keeper inactivity before liquidation opens to any caller.  Admin only.

```rust
pub fn set_keeper_stale_window(caller: Address, secs: u64) -> Result<(), WritzLendError>
```

### `set_borrow_timelock_margin`

Sets how many Bitcoin blocks a borrow must leave between the `bitcoin-spv` tip and the position's timelock height. Admin only; 4,320 to 105,000, else `InvalidTimelockParams`: the margin can be raised, never lowered below the default.

```rust
pub fn set_borrow_timelock_margin(caller: Address, blocks: u32) -> Result<(), WritzLendError>
```

### `set_max_tip_age`

Sets how old the `bitcoin-spv` tip header may be, in seconds, for `borrow` and `liquidate` to rely on it. Admin only; 1 to 48 hours, else `InvalidTimelockParams`.

```rust
pub fn set_max_tip_age(caller: Address, secs: u64) -> Result<(), WritzLendError>
```

### `set_relayer`

Updates the relayer address authorized to call `publish_release_psbt`. Admin only.

```rust
pub fn set_relayer(caller: Address, new_relayer: Address) -> Result<(), WritzLendError>
```

### `set_oracle`

Updates the oracle contract address used for BTC/USD pricing. Admin only.

```rust
pub fn set_oracle(caller: Address, new_oracle: Address) -> Result<(), WritzLendError>
```

### `set_entry_ttl`

Sets how long per-user entries (positions, supply balances, release PSBTs) are kept live, in ledgers. Admin only, same bounds as the constructor's `entry_ttl_ledgers` (17,280 to 3,110,400, else `InvalidEntryTtl`). Applies to entries written or touched after the change only; emits `entry_ttl_set`.

```rust
pub fn set_entry_ttl(caller: Address, entry_ttl_ledgers: u32) -> Result<(), WritzLendError>
```

### `set_spv_contract`

Updates the bitcoin-spv contract address used for deposit verification. Admin only. Changing this mid-flight affects only deposits submitted after the change - an in-flight deposit's SPV proof was already verified against the previous contract by the time this would run.

```rust
pub fn set_spv_contract(caller: Address, new_spv_contract: Address) -> Result<(), WritzLendError>
```

### `set_paused`

Pauses or unpauses new deposits/borrows/USDC supply. Admin only.

```rust
pub fn set_paused(caller: Address, paused: bool) -> Result<(), WritzLendError>
```

### `publish_release_psbt`

Publishes a co-signed Path A release PSBT for a repaid position.

```rust
pub fn publish_release_psbt(relayer: Address, txid: BytesN<32>, psbt: Bytes) -> Result<(), WritzLendError>
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
pub fn get_health_ratio_bp(txid: BytesN<32>) -> Result<i128, WritzLendError>
```

### `get_borrow_timelock_margin`

Blocks a borrow must leave between the `bitcoin-spv` tip and the position's timelock height.

```rust
pub fn get_borrow_timelock_margin() -> Result<u32, WritzLendError>
```

### `get_max_tip_age`

Oldest the `bitcoin-spv` tip header may be, in seconds, for `borrow` and `liquidate` to rely on it.

```rust
pub fn get_max_tip_age() -> Result<u64, WritzLendError>
```

Every view below except `get_protocol_state` is projected: it applies the interest accrued since the last write to the current ledger, without writing it, so it returns what the next write would compute in the same ledger. Amounts are USDC stroops (7 decimals); indexes are scaled by `10^18`.

### `get_borrow_rate_bp`

Annual borrow rate in basis points (e.g. 800 = 8%), on the projected pool totals.

```rust
pub fn get_borrow_rate_bp() -> i128
```

### `get_supply_rate_bp`

Annual supply rate in basis points, on the projected pool totals.

```rust
pub fn get_supply_rate_bp() -> i128
```

### `get_protocol_state`

The protocol state exactly as stored at the last write. Its indexes and totals exclude interest accrued since `index_ledger`; use the projected views for current values.

```rust
pub fn get_protocol_state() -> ProtocolState
```

### `get_supply_balance`

A lender's current value in USDC stroops, interest included: `floor(scaled * supply_index / 10^18)` at the projected supply index. It grows between writes while anything is borrowed.

```rust
pub fn get_supply_balance(lender: Address) -> i128
```

### `get_supply_position`

A lender's scaled units as stored, and their current value as `get_supply_balance` returns it.

```rust
pub fn get_supply_position(lender: Address) -> SupplyPosition // { scaled: i128, value: i128 }
```

### `get_supply_index` / `get_borrow_index`

The supply and borrow indexes projected to the current ledger, scaled by `10^18`.

```rust
pub fn get_supply_index() -> i128
pub fn get_borrow_index() -> i128
```

### `get_pool_totals`

Projected pool totals in USDC stroops. `available` is `total_supply_assets - total_borrowed`, never below zero: what a lender could withdraw or a borrower draw now.

```rust
pub fn get_pool_totals() -> PoolTotals // { total_supply_assets, total_borrowed, reserve_usdc, available }
```

### `refresh_position_ttl`

Extend the TTL of a position entry to the full `entry_ttl_ledgers` window (180 days on mainnet).

```rust
pub fn refresh_position_ttl(txid: BytesN<32>) -> bool
```

### `refresh_supply_balance_ttl`

Extend the TTL of a lender's supply balance entry to the full `entry_ttl_ledgers` window.

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
| `SupplyEvent` | `supply` | **supplier**, usdc_amount, scaled_amount, supply_index, total_supply_assets |
| `WithdrawEvent` | `withdraw` | **supplier**, usdc_amount, scaled_amount, supply_index, total_supply_assets |
| `PausedSetEvent` | `paused_set` | **admin**, paused |
| `OracleSetEvent` | `oracle_set` | **admin**, new_oracle |
| `EntryTtlSetEvent` | `entry_ttl_set` | **admin**, entry_ttl_ledgers |

`scaled_amount` is the number of scaled units minted (`supply`, rounded down) or burned (`withdraw`, rounded up, or the whole balance on a full withdrawal), and `supply_index` is the index it was scaled at, after accrual. A lender's `scaled_amount` summed over its `supply` events, minus its `withdraw` events, equals its stored scaled balance; that balance times the current supply index, divided by `10^18`, is what `get_supply_balance` returns. `total_supply_assets` is the pool's total lender assets after the call.

### Errors

`WritzLendError`, returned as a contract error code.

| Code | Error | Meaning |
|---|---|---|
| 1 | `AlreadyInitialized` | Contract has already been initialized. |
| 2 | `NotInitialized` | Contract has not been initialized yet. |
| 3 | `Unauthorized` | Caller is not the admin. |
| 4 | `SpvVerificationFailed` | The SPV verification call to the bitcoin-spv contract failed. |
| 5 | `OutputNotFound` | No P2WSH output matching the provided scriptPubKey was found in the transaction. |
| 6 | `DepositTooSmall` | The BTC deposit is below the minimum required amount. |
| 7 | `PositionAlreadyExists` | A position already exists for this Bitcoin txid. |
| 8 | `PositionNotFound` | No position found for the given Bitcoin txid. |
| 9 | `PositionNotActive` | The position is not in Active status (already closed or liquidated). |
| 10 | `ExceedsCollateralRatio` | The borrow amount would exceed the maximum loan-to-value ratio. |
| 11 | `InsufficientLiquidity` | Not enough USDC liquidity in the pool. |
| 12 | `RepayExceedsDebt` | Repayment amount exceeds the outstanding debt. |
| 13 | `InsufficientSupply` | The withdrawal is above the lender's balance, interest included. |
| 14 | `PositionHealthy` | The position is healthy and cannot be liquidated yet. |
| 15 | `Overflow` | An integer overflow or underflow was detected. |
| 16 | `InvalidScriptPubKey` | The provided scriptPubKey is not a valid 34-byte P2WSH scriptPubKey. |
| 17 | `Paused` | The contract is paused - new deposits, borrows, and USDC supply are refused. Existing positions can still repay, withdraw, liquidate, and release BTC; a pause only blocks new risk-taking. |
| 18 | `OraclePriceUnavailable` | The oracle returned no price for BTC/USD, or its raw price converted to a zero or negative USDC-stroops value. |
| 19 | `OraclePriceStale` | The oracle's last price update is older than `oracle::MAX_PRICE_STALENESS_SECS`. |
| 20 | `InvalidUserPubkey` | `user_pubkey` is not a compressed secp256k1 public key encoding. |
| 21 | `ScriptPubKeyMismatch` | The supplied scriptPubKey is not the P2WSH of the Writz redeem script derived from the protocol key, `user_pubkey` and `timelock_height`, so the output is not locked under the protocol's control. |
| 22 | `InvalidTimelock` | `timelock_height` is not within the allowed window above the deposit block: too soon (an instant exit for a fresh position) or too far. |
| 23 | `InvalidProtocolPubkey` | The configured protocol public key is not a compressed secp256k1 public key encoding. |
| 24 | `ExposureCapExceeded` | The borrow would take the pool past its total exposure cap (see `Config::max_total_borrowed`). |
| 25 | `InvalidKeyProof` | `key_sig` is not a Bitcoin signed message by `user_pubkey` over this contract, the depositor and the deposit txid (GHSA-862g-739q-x6h8). |
| 26 | `ZeroShareAmount` | The amount is too small to mint or burn a single scaled unit at the current supply index, or is not positive. |
| 27 | `InvalidDepositParams` | A constructor `min_confirmations` is 0 or above `MAX_MIN_CONFIRMATIONS`, or `min_deposit_satoshis` is below `MIN_DEPOSIT_FLOOR_SATS`. |
| 28 | `InvalidEntryTtl` | A constructor or `set_entry_ttl` `entry_ttl_ledgers` is outside `MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS`. |
| 29 | `UserKeyIsProtocolKey` | `user_pubkey` equals the protocol's co-signing key. Every key in the Writz script must be distinct, or the holder of that one key could complete the cooperative path alone. |
| 30 | `TimelockTooSoon` | The borrow would leave fewer than `borrow_timelock_margin_blocks` (4,320 by default) between the `bitcoin-spv` tip and the position's timelock height. |
| 31 | `StaleBitcoinTip` | `bitcoin-spv` has no tip yet, or its tip header is older than `max_tip_age_secs`, so the current Bitcoin height is not known well enough to measure a timelock against. |
| 32 | `LiquidationWindowClosed` | Fewer than `LIQUIDATION_CUTOFF_BLOCKS` (288) blocks remain between the `bitcoin-spv` tip and the position's timelock height, so the borrower's unilateral exit is about to open and a liquidation is no longer accepted. |
| 33 | `InvalidTimelockParams` | A `set_borrow_timelock_margin` or `set_max_tip_age` value is outside its allowed range. |
