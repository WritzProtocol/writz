import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const PrivateLendError = {
  /**
   * Contract has already been initialized.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Contract has not been initialized yet.
   */
  2: {message:"NotInitialized"},
  /**
   * Caller is not the admin.
   */
  3: {message:"Unauthorized"},
  /**
   * The SPV verification call to the bitcoin-spv contract failed.
   */
  4: {message:"SpvVerificationFailed"},
  /**
   * No P2WSH output matching the provided scriptPubKey was found in the transaction.
   */
  5: {message:"OutputNotFound"},
  /**
   * The BTC deposit is below the minimum required amount.
   */
  6: {message:"DepositTooSmall"},
  /**
   * A position already exists for this Bitcoin txid.
   */
  7: {message:"PositionAlreadyExists"},
  /**
   * No position found for the given Bitcoin txid.
   */
  8: {message:"PositionNotFound"},
  /**
   * The position is not in Active status (already closed or liquidated).
   */
  9: {message:"PositionNotActive"},
  /**
   * The borrow amount would exceed the maximum loan-to-value ratio.
   */
  10: {message:"ExceedsCollateralRatio"},
  /**
   * Not enough USDC liquidity in the pool.
   */
  11: {message:"InsufficientLiquidity"},
  /**
   * Repayment amount exceeds the outstanding debt.
   */
  12: {message:"RepayExceedsDebt"},
  /**
   * Withdrawal would reduce pool below the borrowed amount.
   */
  13: {message:"InsufficientSupply"},
  /**
   * The position is healthy and cannot be liquidated yet.
   */
  14: {message:"PositionHealthy"},
  /**
   * An integer overflow or underflow was detected.
   */
  15: {message:"Overflow"},
  /**
   * The provided scriptPubKey is not a valid 34-byte P2WSH scriptPubKey.
   */
  16: {message:"InvalidScriptPubKey"},
  /**
   * The contract is paused - new deposits, borrows, and USDC supply are
   * refused. Existing positions can still repay, withdraw, liquidate, and
   * release BTC; a pause only blocks new risk-taking.
   */
  17: {message:"Paused"},
  /**
   * The oracle returned no price for BTC/USD, or its raw price converted
   * to a zero or negative USDC-stroops value.
   */
  18: {message:"OraclePriceUnavailable"},
  /**
   * The oracle's last price update is older than
   * `oracle::MAX_PRICE_STALENESS_SECS`.
   */
  19: {message:"OraclePriceStale"},
  /**
   * `user_pubkey` is not a compressed secp256k1 public key encoding.
   */
  20: {message:"InvalidUserPubkey"},
  /**
   * The supplied scriptPubKey is not the P2WSH of the Writz redeem script
   * derived from the protocol key, `user_pubkey` and `timelock_height`,
   * so the output is not locked under the protocol's control.
   */
  21: {message:"ScriptPubKeyMismatch"},
  /**
   * `timelock_height` is not within the allowed window above the deposit
   * block: too soon (an instant exit for a fresh position) or too far.
   */
  22: {message:"InvalidTimelock"},
  /**
   * The configured protocol public key is not a compressed secp256k1
   * public key encoding.
   */
  23: {message:"InvalidProtocolPubkey"},
  /**
   * The borrow would take the pool past its total exposure cap (see `Config::max_total_borrowed`).
   */
  24: {message:"ExposureCapExceeded"}
}


/**
 * Protocol configuration, set at initialization. Most fields are fixed for
 * the contract's lifetime; `keeper`, `relayer`, `keeper_stale_after_secs`,
 * and `paused` are admin-mutable via their own setters - see `lib.rs`.
 * 
 * Stored under `DataKey::Config` in persistent storage.
 */
export interface Config {
  /**
 * Admin address - can update the keeper address.
 */
admin: string;
  /**
 * Trusted keeper address for Phase 1 liquidations.
 */
keeper: string;
  /**
 * Seconds of keeper inactivity after which liquidation opens to any
 * caller, not just `keeper` (default: 86_400 = 24h). This is a
 * liveness/censorship fallback, not a privacy mechanism (this contract
 * has no ZK privacy).
 */
keeper_stale_after_secs: u64;
  /**
 * Bonus the liquidator earns expressed as additional BTC % (1_000 = 10%).
 */
liquidation_bonus_bp: u32;
  /**
 * Health ratio below which a position can be liquidated (12_000 = 120%).
 */
liquidation_threshold_bp: u32;
  /**
 * Ceiling on total USDC the pool may have borrowed out, in stroops. A
 * cap bounds how much bad debt a price crash can leave behind when
 * liquidation cannot release BTC (GHSA-5rxp-7f9g-r66x, #193).
 */
max_total_borrowed: i128;
  /**
 * Minimum collateral ratio in basis points (15_000 = 150%).
 */
min_collateral_ratio_bp: u32;
  /**
 * Minimum SPV confirmation depth before a deposit is accepted (default: 6).
 */
min_confirmations: u32;
  /**
 * Minimum BTC deposit in satoshis (default: 100_000 = 0.001 BTC).
 */
min_deposit_satoshis: u64;
  /**
 * Address of Reflector's external-prices SEP-40 BTC/USD oracle (see
 * docs/research/oracle-design.md). Pyth cross-check not yet wired -
 * single-source until it is.
 */
oracle: string;
  /**
 * When true, `deposit`/`borrow`/`supply_usdc` (new risk-taking actions)
 * are refused. `repay`/`withdraw_supply`/`liquidate`/`publish_release_psbt`
 * stay open so users can still exit - a pause is an emergency brake on
 * new exposure, not a freeze on existing positions. Admin-gated via
 * `set_paused`. See `docs/architecture/contract-migration-runbook.md`,
 * Track 2, for why this exists.
 */
paused: boolean;
  /**
 * The protocol's 33-byte compressed Bitcoin co-signing public key - the
 * key embedded in every Writz redeem script (path A). `deposit` derives
 * the expected scriptPubKey from it, so it is fixed for the contract's
 * lifetime; rotating it means deploying a new contract.
 */
protocol_pubkey: Buffer;
  /**
 * Address authorized to publish a co-signed release PSBT via
 * `publish_release_psbt` (the auto-cosign relayer watcher).
 */
relayer: string;
  /**
 * Address of the deployed `bitcoin-spv` Soroban contract.
 */
spv_contract: string;
  /**
 * Address of the USDC Stellar Asset Contract on this network.
 */
usdc_token: string;
}


/**
 * A single BTC-collateralized lending position.
 * 
 * Stored in per-entry persistent storage keyed by Bitcoin txid.
 * Never stored in a growing collection on the instance - see CertiK warning
 * about unbounded instance storage growth.
 */
export interface Position {
  /**
 * Satoshis locked in the P2WSH output - verified on-chain from raw_tx.
 */
btc_satoshis: u64;
  /**
 * Bitcoin transaction ID (32 bytes, internal/little-endian byte order).
 */
btc_txid: Buffer;
  /**
 * The depositor's Stellar address (must repay to close the position).
 */
depositor: string;
  /**
 * Stellar ledger sequence number at the last interest accrual.
 */
last_update_ledger: u32;
  /**
 * The 34-byte P2WSH scriptPubKey (OP_0 + 32-byte script hash) of this deposit.
 * Used by the backend to identify which UTXO to co-sign for release.
 */
p2wsh_script_pubkey: Buffer;
  status: PositionStatus;
  /**
 * Absolute Bitcoin block height for the CLTV emergency escape hatch.
 */
timelock_height: u32;
  /**
 * Outstanding USDC debt in stroops (1 USDC = 10_000_000 stroops).
 * Grows with each interest accrual.
 */
usdc_debt: i128;
  /**
 * The depositor's 33-byte compressed Bitcoin public key.
 * Already public information - it's revealed the moment either
 * spending path is used - so storing it plaintext is not a new privacy
 * leak. Lets the auto-cosign relayer watcher reconstruct the redeem
 * script and the user's default return address (a P2WPKH address
 * derived from this key) from on-chain state alone, without a separate
 * off-chain "return address" store.
 */
user_pubkey: Buffer;
}


/**
 * Global protocol accounting.
 * 
 * A single instance stored under `DataKey::Protocol`.
 */
export interface ProtocolState {
  /**
 * Ledger timestamp of the most recent successful liquidation by the
 * designated `config.keeper`. Used to detect a stale/absent
 * keeper and open liquidation to any caller with a valid
 * undercollateralization check after `config.keeper_stale_after_secs`.
 * Explicit `keeper_heartbeat` calls also update this.
 */
last_keeper_heartbeat: u64;
  /**
 * Total outstanding USDC debt across all active positions (in stroops).
 * Updated on every borrow, repay, accrual, and liquidation.
 */
total_borrowed: i128;
  /**
 * Total USDC supplied by lenders (in stroops). Does not decrease when
 * interest accrues - interest earned increases the effective value of
 * each lender's share.
 */
total_supplied: i128;
}

/**
 * Position lifecycle states.
 */
export type PositionStatus = {tag: "Active", values: void} | {tag: "Closed", values: void} | {tag: "Liquidated", values: void};










/**
 * SEP-40 asset identifier. Field/variant shape must match Reflector's own
 * `Asset` enum exactly for XDR decoding to work - the Rust type name here
 * does not need to match, only the on-the-wire shape.
 */
export type Asset = {tag: "Stellar", values: readonly [string]} | {tag: "Other", values: readonly [string]};


/**
 * SEP-40 price record. Shape must match Reflector's own `PriceData` struct
 * exactly (same reasoning as `Asset` above).
 */
export interface PriceData {
  price: i128;
  timestamp: u64;
}

/**
 * Storage keys - each variant maps to an isolated persistent storage entry.
 * 
 * Using per-entry keying (not a single growing map) prevents unbounded
 * instance storage growth, which is the #1 Soroban vulnerability class
 * identified by the Stellar Audit Bank (CertiK, OtterSec, Zellic).
 */
export type DataKey = {tag: "Config", values: void} | {tag: "Protocol", values: void} | {tag: "Position", values: readonly [Buffer]} | {tag: "SupplyBalance", values: readonly [string]} | {tag: "ReleasePsbt", values: readonly [Buffer]};


export interface SpvVerificationResult {
  /**
 * The hash (SHA256d) of the block that contains the transaction.
 */
block_hash: Buffer;
  /**
 * Bitcoin height of the block that contains the transaction.
 */
block_height: u32;
  /**
 * The block's depth below the best chain tip (the tip itself is 1).
 */
confirmations: u32;
  /**
 * The transaction identifier: SHA256d of the non-witness serialization.
 */
txid: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a repay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Repay some or all of the USDC debt on a position.
   * 
   * If the repayment covers the full outstanding debt (after accruing
   * interest), the position is marked as `Closed` and a `repay_full`
   * event is emitted.  The Writz backend listens for this event and
   * co-signs the Bitcoin release transaction (spending path A).
   */
  repay: ({repayer, txid, usdc_amount}: {repayer: string, txid: Buffer, usdc_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a borrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Borrow USDC against an existing BTC deposit.
   * 
   * The resulting debt must keep the position's collateral ratio at or above
   * `min_collateral_ratio_bp` (150%).  Interest starts accruing immediately.
   * 
   * Only the depositor who created the position can borrow against it.
   */
  borrow: ({borrower, txid, usdc_amount}: {borrower: string, txid: Buffer, usdc_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a BTC deposit by submitting an SPV proof.
   * 
   * The contract:
   * 1. Rebuilds the Writz redeem script from the configured protocol key,
   * `user_pubkey` and `timelock_height`, and requires
   * `p2wsh_script_pubkey` to be exactly its P2WSH - so the collateral is
   * provably locked under the protocol's co-signing key.
   * 2. Calls the `bitcoin-spv` contract to verify the transaction inclusion,
   * and requires the timelock to lie 1,008..=105,000 blocks above the
   * block that confirmed the deposit.
   * 3. Parses the raw transaction on-chain to find the P2WSH output matching
   * `p2wsh_script_pubkey` and read the deposited satoshi amount.
   * 4. Creates a `Position` entry in persistent storage.
   * 
   * After this call succeeds the user can borrow USDC against the position.
   * 
   * # Parameters
   * - `depositor`          - Stellar address of the depositor (must authorize).
   * - `block_hash`         - Hash of the Bitcoin block holding the deposit; it must
   * already be stored and on the best chain in `bitcoin-spv`.
   * - `merkle_proof`       - Sibling hashes for the Merkle 
   */
  deposit: ({depositor, block_hash, merkle_proof, tx_index, raw_tx, p2wsh_script_pubkey, timelock_height, user_pubkey}: {depositor: string, block_hash: Buffer, merkle_proof: Array<Buffer>, tx_index: u32, raw_tx: Buffer, p2wsh_script_pubkey: Buffer, timelock_height: u32, user_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a liquidate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Liquidate an undercollateralized position.
   * 
   * Phase 1: only the authorized `keeper` may call this - *unless* the
   * keeper has gone stale (no successful liquidation or explicit
   * `keeper_heartbeat` in `config.keeper_stale_after_secs`, default 24h),
   * in which case any caller with a genuinely undercollateralized
   * position may liquidate it. This is a liveness/censorship
   * fallback, not a privacy mechanism - `private-lend` positions are
   * already plaintext. Safety is unaffected by who calls: the
   * undercollateralization check below is independent of caller identity.
   * 
   * The caller must have pre-approved a USDC transfer of at least
   * `pos.usdc_debt` (after accrual) to this contract.
   * 
   * On success:
   * - The caller's USDC covers the outstanding debt.
   * - The position is marked `Liquidated`.
   * - A `liquidate` event is emitted with the position txid and the
   * caller's address. It does not release any Bitcoin: the collateral
   * stays under the user's script (GHSA-5rxp-7f9g-r66x).
   * - If the caller is the designated keeper, `last_keeper_heartbeat` is
   * refr
   */
  liquidate: ({keeper, txid}: {keeper: string, txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_keeper transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_keeper: ({caller, new_keeper}: {caller: string, new_keeper: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the oracle contract address used for BTC/USD pricing. Admin only.
   * 
   * As of 2026-09-17, `oracle::get_btc_price_stroops` calls this address
   * live via Reflector's SEP-40 interface (`lastprice`/`decimals`) - it is
   * no longer a stub, and changing this address changes real pricing
   * immediately, including for any `borrow`/`liquidate`/
   * `get_health_ratio_bp` call already in flight in the same ledger.
   * Point this at a contract that does not genuinely speak Reflector's
   * `lastprice`/`decimals` shape and price-dependent calls trap with a
   * host error (or return `OraclePriceUnavailable` if the contract
   * exists but reports no price) - both fail closed, neither silently
   * mispricing - see `oracle.rs`.
   */
  set_oracle: ({caller, new_oracle}: {caller: string, new_oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses or unpauses new deposits/borrows/USDC supply. Admin only.
   * 
   * A pause never affects existing positions: `repay`, `withdraw_supply`,
   * `liquidate`, and `publish_release_psbt` all ignore `Config::paused` by
   * design, so users can always exit. This is an emergency brake on new
   * exposure, not a freeze - see `docs/architecture/contract-migration-runbook.md`.
   */
  set_paused: ({caller, paused}: {caller: string, paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the relayer address authorized to call `publish_release_psbt`.
   * Admin only.
   */
  set_relayer: ({caller, new_relayer}: {caller: string, new_relayer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a supply_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lender supplies USDC to the pool, making it available for borrowing.
   * Lenders earn `supply_rate_bp()` APR on their supplied amount.
   */
  supply_usdc: ({supplier, amount}: {supplier: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the position for the given Bitcoin txid, or `None`.
   */
  get_position: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Position>>>

  /**
   * Construct and simulate a withdraw_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lender withdraws previously supplied USDC from the pool.
   */
  withdraw_supply: ({supplier, amount}: {supplier: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_release_psbt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the relayer-published release PSBT for a position, or `None`
   * if the relayer hasn't published one yet (or the position was never
   * fully repaid).
   */
  get_release_psbt: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a keeper_heartbeat transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Explicit liveness signal from the designated keeper.
   * 
   * Lets the keeper reset the stale-window clock even when there is
   * nothing to liquidate right now (`liquidate` itself also refreshes
   * this on every successful call - this entrypoint covers idle periods).
   */
  keeper_heartbeat: ({keeper}: {keeper: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_spv_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the bitcoin-spv contract address used for deposit verification.
   * Admin only. Changing this mid-flight affects only deposits submitted
   * after the change - an in-flight deposit's SPV proof was already
   * verified against the previous contract by the time this would run.
   */
  set_spv_contract: ({caller, new_spv_contract}: {caller: string, new_spv_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_borrow_rate_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current annual borrow rate in basis points (e.g. 800 = 8%).
   */
  get_borrow_rate_bp: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_protocol_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns a snapshot of the global protocol state.
   */
  get_protocol_state: (options?: MethodOptions) => Promise<AssembledTransaction<ProtocolState>>

  /**
   * Construct and simulate a get_supply_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the USDC supply balance (in stroops) for a lender.
   */
  get_supply_balance: ({lender}: {lender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_supply_rate_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current annual supply rate in basis points.
   */
  get_supply_rate_bp: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_health_ratio_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the health ratio (in basis points) for a position.
   * 
   * 15_000 = 150% (healthy), 12_000 = 120% (liquidation threshold),
   * `i128::MAX` = position has no debt.
   */
  get_health_ratio_bp: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a publish_release_psbt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Publishes a co-signed Path A release PSBT for a repaid position.
   * 
   * Called by the relayer watcher immediately after it detects a
   * `RepayFullEvent`, builds the release transaction, and co-signs it.
   * Storing the PSBT
   * on-chain (rather than e.g. IPFS) means the user can retrieve and
   * broadcast it even if the entire Writz off-chain stack is down.
   * Relayer only.
   */
  publish_release_psbt: ({relayer, txid, psbt}: {relayer: string, txid: Buffer, psbt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refresh_position_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of a position entry to another 180-day window.
   * 
   * If a position expires, the depositor loses access to their record and
   * the duplicate-deposit guard also expires (re-deposit attack risk).
   * Keepers or borrowers should call this before any position approaches
   * the end of its 180-day window.
   * Returns false if no position exists for the given txid.
   */
  refresh_position_ttl: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_protocol_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of the global protocol accounting entry.
   */
  refresh_protocol_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_max_total_borrowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the keeper address.  Admin only.
   */
  set_max_total_borrowed: ({caller, max}: {caller: string, max: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_keeper_stale_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates how many seconds of keeper inactivity before liquidation
   * opens to any caller.  Admin only.
   */
  set_keeper_stale_window: ({caller, secs}: {caller: string, secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refresh_release_psbt_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of a published release PSBT to another window.
   * 
   * A repaid position's release PSBT is otherwise only bumped as a side
   * effect of fetching or re-publishing it. A user who has repaid but
   * hasn't yet broadcast their release transaction should call this (or
   * have their wallet call it periodically) rather than rely on activity
   * that may not happen for a while. Returns false if no PSBT is on
   * record for this txid.
   */
  refresh_release_psbt_ttl: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_supply_balance_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of a lender's supply balance entry to another 180-day window.
   * 
   * Lenders who supplied USDC and do not interact for an extended period risk
   * having their balance entry expire, preventing withdrawal.
   * Returns false if the lender has no recorded balance.
   */
  refresh_supply_balance_ttl: ({lender}: {lender: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, spv_contract, usdc_token, oracle, keeper, relayer, protocol_pubkey}: {admin: string, spv_contract: string, usdc_token: string, oracle: string, keeper: string, relayer: string, protocol_pubkey: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, spv_contract, usdc_token, oracle, keeper, relayer, protocol_pubkey}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAATFSZXBheSBzb21lIG9yIGFsbCBvZiB0aGUgVVNEQyBkZWJ0IG9uIGEgcG9zaXRpb24uCgpJZiB0aGUgcmVwYXltZW50IGNvdmVycyB0aGUgZnVsbCBvdXRzdGFuZGluZyBkZWJ0IChhZnRlciBhY2NydWluZwppbnRlcmVzdCksIHRoZSBwb3NpdGlvbiBpcyBtYXJrZWQgYXMgYENsb3NlZGAgYW5kIGEgYHJlcGF5X2Z1bGxgCmV2ZW50IGlzIGVtaXR0ZWQuICBUaGUgV3JpdHogYmFja2VuZCBsaXN0ZW5zIGZvciB0aGlzIGV2ZW50IGFuZApjby1zaWducyB0aGUgQml0Y29pbiByZWxlYXNlIHRyYW5zYWN0aW9uIChzcGVuZGluZyBwYXRoIEEpLgAAAAAAAAVyZXBheQAAAAAAAAMAAAAAAAAAB3JlcGF5ZXIAAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAQNCb3Jyb3cgVVNEQyBhZ2FpbnN0IGFuIGV4aXN0aW5nIEJUQyBkZXBvc2l0LgoKVGhlIHJlc3VsdGluZyBkZWJ0IG11c3Qga2VlcCB0aGUgcG9zaXRpb24ncyBjb2xsYXRlcmFsIHJhdGlvIGF0IG9yIGFib3ZlCmBtaW5fY29sbGF0ZXJhbF9yYXRpb19icGAgKDE1MCUpLiAgSW50ZXJlc3Qgc3RhcnRzIGFjY3J1aW5nIGltbWVkaWF0ZWx5LgoKT25seSB0aGUgZGVwb3NpdG9yIHdobyBjcmVhdGVkIHRoZSBwb3NpdGlvbiBjYW4gYm9ycm93IGFnYWluc3QgaXQuAAAAAAZib3Jyb3cAAAAAAAMAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAABABSZWdpc3RlciBhIEJUQyBkZXBvc2l0IGJ5IHN1Ym1pdHRpbmcgYW4gU1BWIHByb29mLgoKVGhlIGNvbnRyYWN0OgoxLiBSZWJ1aWxkcyB0aGUgV3JpdHogcmVkZWVtIHNjcmlwdCBmcm9tIHRoZSBjb25maWd1cmVkIHByb3RvY29sIGtleSwKYHVzZXJfcHVia2V5YCBhbmQgYHRpbWVsb2NrX2hlaWdodGAsIGFuZCByZXF1aXJlcwpgcDJ3c2hfc2NyaXB0X3B1YmtleWAgdG8gYmUgZXhhY3RseSBpdHMgUDJXU0ggLSBzbyB0aGUgY29sbGF0ZXJhbCBpcwpwcm92YWJseSBsb2NrZWQgdW5kZXIgdGhlIHByb3RvY29sJ3MgY28tc2lnbmluZyBrZXkuCjIuIENhbGxzIHRoZSBgYml0Y29pbi1zcHZgIGNvbnRyYWN0IHRvIHZlcmlmeSB0aGUgdHJhbnNhY3Rpb24gaW5jbHVzaW9uLAphbmQgcmVxdWlyZXMgdGhlIHRpbWVsb2NrIHRvIGxpZSAxLDAwOC4uPTEwNSwwMDAgYmxvY2tzIGFib3ZlIHRoZQpibG9jayB0aGF0IGNvbmZpcm1lZCB0aGUgZGVwb3NpdC4KMy4gUGFyc2VzIHRoZSByYXcgdHJhbnNhY3Rpb24gb24tY2hhaW4gdG8gZmluZCB0aGUgUDJXU0ggb3V0cHV0IG1hdGNoaW5nCmBwMndzaF9zY3JpcHRfcHVia2V5YCBhbmQgcmVhZCB0aGUgZGVwb3NpdGVkIHNhdG9zaGkgYW1vdW50Lgo0LiBDcmVhdGVzIGEgYFBvc2l0aW9uYCBlbnRyeSBpbiBwZXJzaXN0ZW50IHN0b3JhZ2UuCgpBZnRlciB0aGlzIGNhbGwgc3VjY2VlZHMgdGhlIHVzZXIgY2FuIGJvcnJvdyBVU0RDIGFnYWluc3QgdGhlIHBvc2l0aW9uLgoKIyBQYXJhbWV0ZXJzCi0gYGRlcG9zaXRvcmAgICAgICAgICAgLSBTdGVsbGFyIGFkZHJlc3Mgb2YgdGhlIGRlcG9zaXRvciAobXVzdCBhdXRob3JpemUpLgotIGBibG9ja19oYXNoYCAgICAgICAgIC0gSGFzaCBvZiB0aGUgQml0Y29pbiBibG9jayBob2xkaW5nIHRoZSBkZXBvc2l0OyBpdCBtdXN0CmFscmVhZHkgYmUgc3RvcmVkIGFuZCBvbiB0aGUgYmVzdCBjaGFpbiBpbiBgYml0Y29pbi1zcHZgLgotIGBtZXJrbGVfcHJvb2ZgICAgICAgIC0gU2libGluZyBoYXNoZXMgZm9yIHRoZSBNZXJrbGUgAAAAB2RlcG9zaXQAAAAACAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAKYmxvY2tfaGFzaAAAAAAD7gAAACAAAAAAAAAADG1lcmtsZV9wcm9vZgAAA+oAAAPuAAAAIAAAAAAAAAAIdHhfaW5kZXgAAAAEAAAAAAAAAAZyYXdfdHgAAAAAAA4AAAAAAAAAE3Ayd3NoX3NjcmlwdF9wdWJrZXkAAAAADgAAAAAAAAAPdGltZWxvY2tfaGVpZ2h0AAAAAAQAAAAAAAAAC3VzZXJfcHVia2V5AAAAA+4AAAAhAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAABABMaXF1aWRhdGUgYW4gdW5kZXJjb2xsYXRlcmFsaXplZCBwb3NpdGlvbi4KClBoYXNlIDE6IG9ubHkgdGhlIGF1dGhvcml6ZWQgYGtlZXBlcmAgbWF5IGNhbGwgdGhpcyAtICp1bmxlc3MqIHRoZQprZWVwZXIgaGFzIGdvbmUgc3RhbGUgKG5vIHN1Y2Nlc3NmdWwgbGlxdWlkYXRpb24gb3IgZXhwbGljaXQKYGtlZXBlcl9oZWFydGJlYXRgIGluIGBjb25maWcua2VlcGVyX3N0YWxlX2FmdGVyX3NlY3NgLCBkZWZhdWx0IDI0aCksCmluIHdoaWNoIGNhc2UgYW55IGNhbGxlciB3aXRoIGEgZ2VudWluZWx5IHVuZGVyY29sbGF0ZXJhbGl6ZWQKcG9zaXRpb24gbWF5IGxpcXVpZGF0ZSBpdC4gVGhpcyBpcyBhIGxpdmVuZXNzL2NlbnNvcnNoaXAKZmFsbGJhY2ssIG5vdCBhIHByaXZhY3kgbWVjaGFuaXNtIC0gYHByaXZhdGUtbGVuZGAgcG9zaXRpb25zIGFyZQphbHJlYWR5IHBsYWludGV4dC4gU2FmZXR5IGlzIHVuYWZmZWN0ZWQgYnkgd2hvIGNhbGxzOiB0aGUKdW5kZXJjb2xsYXRlcmFsaXphdGlvbiBjaGVjayBiZWxvdyBpcyBpbmRlcGVuZGVudCBvZiBjYWxsZXIgaWRlbnRpdHkuCgpUaGUgY2FsbGVyIG11c3QgaGF2ZSBwcmUtYXBwcm92ZWQgYSBVU0RDIHRyYW5zZmVyIG9mIGF0IGxlYXN0CmBwb3MudXNkY19kZWJ0YCAoYWZ0ZXIgYWNjcnVhbCkgdG8gdGhpcyBjb250cmFjdC4KCk9uIHN1Y2Nlc3M6Ci0gVGhlIGNhbGxlcidzIFVTREMgY292ZXJzIHRoZSBvdXRzdGFuZGluZyBkZWJ0LgotIFRoZSBwb3NpdGlvbiBpcyBtYXJrZWQgYExpcXVpZGF0ZWRgLgotIEEgYGxpcXVpZGF0ZWAgZXZlbnQgaXMgZW1pdHRlZCB3aXRoIHRoZSBwb3NpdGlvbiB0eGlkIGFuZCB0aGUKY2FsbGVyJ3MgYWRkcmVzcy4gSXQgZG9lcyBub3QgcmVsZWFzZSBhbnkgQml0Y29pbjogdGhlIGNvbGxhdGVyYWwKc3RheXMgdW5kZXIgdGhlIHVzZXIncyBzY3JpcHQgKEdIU0EtNXJ4cC03ZjlnLXI2NngpLgotIElmIHRoZSBjYWxsZXIgaXMgdGhlIGRlc2lnbmF0ZWQga2VlcGVyLCBgbGFzdF9rZWVwZXJfaGVhcnRiZWF0YCBpcwpyZWZyAAAACWxpcXVpZGF0ZQAAAAAAAAIAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAAAAAAAKc2V0X2tlZXBlcgAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAApuZXdfa2VlcGVyAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAArJVcGRhdGVzIHRoZSBvcmFjbGUgY29udHJhY3QgYWRkcmVzcyB1c2VkIGZvciBCVEMvVVNEIHByaWNpbmcuIEFkbWluIG9ubHkuCgpBcyBvZiAyMDI2LTA5LTE3LCBgb3JhY2xlOjpnZXRfYnRjX3ByaWNlX3N0cm9vcHNgIGNhbGxzIHRoaXMgYWRkcmVzcwpsaXZlIHZpYSBSZWZsZWN0b3IncyBTRVAtNDAgaW50ZXJmYWNlIChgbGFzdHByaWNlYC9gZGVjaW1hbHNgKSAtIGl0IGlzCm5vIGxvbmdlciBhIHN0dWIsIGFuZCBjaGFuZ2luZyB0aGlzIGFkZHJlc3MgY2hhbmdlcyByZWFsIHByaWNpbmcKaW1tZWRpYXRlbHksIGluY2x1ZGluZyBmb3IgYW55IGBib3Jyb3dgL2BsaXF1aWRhdGVgLwpgZ2V0X2hlYWx0aF9yYXRpb19icGAgY2FsbCBhbHJlYWR5IGluIGZsaWdodCBpbiB0aGUgc2FtZSBsZWRnZXIuClBvaW50IHRoaXMgYXQgYSBjb250cmFjdCB0aGF0IGRvZXMgbm90IGdlbnVpbmVseSBzcGVhayBSZWZsZWN0b3IncwpgbGFzdHByaWNlYC9gZGVjaW1hbHNgIHNoYXBlIGFuZCBwcmljZS1kZXBlbmRlbnQgY2FsbHMgdHJhcCB3aXRoIGEKaG9zdCBlcnJvciAob3IgcmV0dXJuIGBPcmFjbGVQcmljZVVuYXZhaWxhYmxlYCBpZiB0aGUgY29udHJhY3QKZXhpc3RzIGJ1dCByZXBvcnRzIG5vIHByaWNlKSAtIGJvdGggZmFpbCBjbG9zZWQsIG5laXRoZXIgc2lsZW50bHkKbWlzcHJpY2luZyAtIHNlZSBgb3JhY2xlLnJzYC4AAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACm5ld19vcmFjbGUAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAWJQYXVzZXMgb3IgdW5wYXVzZXMgbmV3IGRlcG9zaXRzL2JvcnJvd3MvVVNEQyBzdXBwbHkuIEFkbWluIG9ubHkuCgpBIHBhdXNlIG5ldmVyIGFmZmVjdHMgZXhpc3RpbmcgcG9zaXRpb25zOiBgcmVwYXlgLCBgd2l0aGRyYXdfc3VwcGx5YCwKYGxpcXVpZGF0ZWAsIGFuZCBgcHVibGlzaF9yZWxlYXNlX3BzYnRgIGFsbCBpZ25vcmUgYENvbmZpZzo6cGF1c2VkYCBieQpkZXNpZ24sIHNvIHVzZXJzIGNhbiBhbHdheXMgZXhpdC4gVGhpcyBpcyBhbiBlbWVyZ2VuY3kgYnJha2Ugb24gbmV3CmV4cG9zdXJlLCBub3QgYSBmcmVlemUgLSBzZWUgYGRvY3MvYXJjaGl0ZWN0dXJlL2NvbnRyYWN0LW1pZ3JhdGlvbi1ydW5ib29rLm1kYC4AAAAAAApzZXRfcGF1c2VkAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAEAAAPpAAAAAgAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAAAFJVcGRhdGVzIHRoZSByZWxheWVyIGFkZHJlc3MgYXV0aG9yaXplZCB0byBjYWxsIGBwdWJsaXNoX3JlbGVhc2VfcHNidGAuCkFkbWluIG9ubHkuAAAAAAALc2V0X3JlbGF5ZXIAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAtuZXdfcmVsYXllcgAAAAATAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAIJMZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbCwgbWFraW5nIGl0IGF2YWlsYWJsZSBmb3IgYm9ycm93aW5nLgpMZW5kZXJzIGVhcm4gYHN1cHBseV9yYXRlX2JwKClgIEFQUiBvbiB0aGVpciBzdXBwbGllZCBhbW91bnQuAAAAAAALc3VwcGx5X3VzZGMAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAADtSZXR1cm5zIHRoZSBwb3NpdGlvbiBmb3IgdGhlIGdpdmVuIEJpdGNvaW4gdHhpZCwgb3IgYE5vbmVgLgAAAAAMZ2V0X3Bvc2l0aW9uAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+gAAAfQAAAACFBvc2l0aW9u",
        "AAAAAAAAAxJSdW5zIGV4YWN0bHkgb25jZSwgYXRvbWljYWxseSwgYXMgcGFydCBvZiBkZXBsb3ltZW50IChgX19jb25zdHJ1Y3RvcmApOgpubyBzZXBhcmF0ZSBpbml0aWFsaXplIHRyYW5zYWN0aW9uIGV4aXN0cyBmb3IgYW55b25lIHRvIGZyb250LXJ1bgooR0hTQS00MjJtLWY3M3gtZmg1OCkuCgojIFBhcmFtZXRlcnMKLSBgYWRtaW5gICAgICAgICAgIC0gQWRkcmVzcyB0aGF0IGNhbiB1cGRhdGUgdGhlIGtlZXBlci4KLSBgc3B2X2NvbnRyYWN0YCAgIC0gRGVwbG95ZWQgYGJpdGNvaW4tc3B2YCBTb3JvYmFuIGNvbnRyYWN0IGFkZHJlc3MuCi0gYHVzZGNfdG9rZW5gICAgICAtIFVTREMgU3RlbGxhciBBc3NldCBDb250cmFjdCBhZGRyZXNzLgotIGBvcmFjbGVgICAgICAgICAgLSBSZWZsZWN0b3IncyBleHRlcm5hbC1wcmljZXMgU0VQLTQwIG9yYWNsZSBhZGRyZXNzCihzZWUgZG9jcy9yZXNlYXJjaC9vcmFjbGUtZGVzaWduLm1kKS4gUHl0aApjcm9zcy1jaGVjayBub3QgeWV0IHdpcmVkIC0gc2luZ2xlLXNvdXJjZSB1bnRpbAppdCBpcy4KLSBga2VlcGVyYCAgICAgICAgIC0gVHJ1c3RlZCBsaXF1aWRhdGlvbiBrZWVwZXIgKFBoYXNlIDEpLgotIGByZWxheWVyYCAgICAgICAgLSBBdXRvLWNvc2lnbiByZWxheWVyIHdhdGNoZXIgYWRkcmVzcy4KLSBgcHJvdG9jb2xfcHVia2V5YC0gVGhlIHByb3RvY29sJ3MgMzMtYnl0ZSBjb21wcmVzc2VkIEJpdGNvaW4KY28tc2lnbmluZyBrZXk7IGV2ZXJ5IGRlcG9zaXQgbXVzdCBiZSBsb2NrZWQKdW5kZXIgYSBzY3JpcHQgdGhhdCBjb250YWlucyBpdC4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAxzcHZfY29udHJhY3QAAAATAAAAAAAAAAp1c2RjX3Rva2VuAAAAAAATAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAHcmVsYXllcgAAAAATAAAAAAAAAA9wcm90b2NvbF9wdWJrZXkAAAAD7gAAACEAAAAA",
        "AAAAAAAAADhMZW5kZXIgd2l0aGRyYXdzIHByZXZpb3VzbHkgc3VwcGxpZWQgVVNEQyBmcm9tIHRoZSBwb29sLgAAAA93aXRoZHJhd19zdXBwbHkAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAJZSZXR1cm5zIHRoZSByZWxheWVyLXB1Ymxpc2hlZCByZWxlYXNlIFBTQlQgZm9yIGEgcG9zaXRpb24sIG9yIGBOb25lYAppZiB0aGUgcmVsYXllciBoYXNuJ3QgcHVibGlzaGVkIG9uZSB5ZXQgKG9yIHRoZSBwb3NpdGlvbiB3YXMgbmV2ZXIKZnVsbHkgcmVwYWlkKS4AAAAAABBnZXRfcmVsZWFzZV9wc2J0AAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+gAAAAO",
        "AAAAAAAAAP1FeHBsaWNpdCBsaXZlbmVzcyBzaWduYWwgZnJvbSB0aGUgZGVzaWduYXRlZCBrZWVwZXIuCgpMZXRzIHRoZSBrZWVwZXIgcmVzZXQgdGhlIHN0YWxlLXdpbmRvdyBjbG9jayBldmVuIHdoZW4gdGhlcmUgaXMKbm90aGluZyB0byBsaXF1aWRhdGUgcmlnaHQgbm93IChgbGlxdWlkYXRlYCBpdHNlbGYgYWxzbyByZWZyZXNoZXMKdGhpcyBvbiBldmVyeSBzdWNjZXNzZnVsIGNhbGwgLSB0aGlzIGVudHJ5cG9pbnQgY292ZXJzIGlkbGUgcGVyaW9kcykuAAAAAAAAEGtlZXBlcl9oZWFydGJlYXQAAAABAAAAAAAAAAZrZWVwZXIAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAQ9VcGRhdGVzIHRoZSBiaXRjb2luLXNwdiBjb250cmFjdCBhZGRyZXNzIHVzZWQgZm9yIGRlcG9zaXQgdmVyaWZpY2F0aW9uLgpBZG1pbiBvbmx5LiBDaGFuZ2luZyB0aGlzIG1pZC1mbGlnaHQgYWZmZWN0cyBvbmx5IGRlcG9zaXRzIHN1Ym1pdHRlZAphZnRlciB0aGUgY2hhbmdlIC0gYW4gaW4tZmxpZ2h0IGRlcG9zaXQncyBTUFYgcHJvb2Ygd2FzIGFscmVhZHkKdmVyaWZpZWQgYWdhaW5zdCB0aGUgcHJldmlvdXMgY29udHJhY3QgYnkgdGhlIHRpbWUgdGhpcyB3b3VsZCBydW4uAAAAABBzZXRfc3B2X2NvbnRyYWN0AAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAABBuZXdfc3B2X2NvbnRyYWN0AAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAAADtDdXJyZW50IGFubnVhbCBib3Jyb3cgcmF0ZSBpbiBiYXNpcyBwb2ludHMgKGUuZy4gODAwID0gOCUpLgAAAAASZ2V0X2JvcnJvd19yYXRlX2JwAAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAADBSZXR1cm5zIGEgc25hcHNob3Qgb2YgdGhlIGdsb2JhbCBwcm90b2NvbCBzdGF0ZS4AAAASZ2V0X3Byb3RvY29sX3N0YXRlAAAAAAAAAAAAAQAAB9AAAAANUHJvdG9jb2xTdGF0ZQAAAA==",
        "AAAAAAAAADpSZXR1cm5zIHRoZSBVU0RDIHN1cHBseSBiYWxhbmNlIChpbiBzdHJvb3BzKSBmb3IgYSBsZW5kZXIuAAAAAAASZ2V0X3N1cHBseV9iYWxhbmNlAAAAAAABAAAAAAAAAAZsZW5kZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAACtDdXJyZW50IGFubnVhbCBzdXBwbHkgcmF0ZSBpbiBiYXNpcyBwb2ludHMuAAAAABJnZXRfc3VwcGx5X3JhdGVfYnAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAJ9SZXR1cm5zIHRoZSBoZWFsdGggcmF0aW8gKGluIGJhc2lzIHBvaW50cykgZm9yIGEgcG9zaXRpb24uCgoxNV8wMDAgPSAxNTAlIChoZWFsdGh5KSwgMTJfMDAwID0gMTIwJSAobGlxdWlkYXRpb24gdGhyZXNob2xkKSwKYGkxMjg6Ok1BWGAgPSBwb3NpdGlvbiBoYXMgbm8gZGVidC4AAAAAE2dldF9oZWFsdGhfcmF0aW9fYnAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+kAAAALAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAWBQdWJsaXNoZXMgYSBjby1zaWduZWQgUGF0aCBBIHJlbGVhc2UgUFNCVCBmb3IgYSByZXBhaWQgcG9zaXRpb24uCgpDYWxsZWQgYnkgdGhlIHJlbGF5ZXIgd2F0Y2hlciBpbW1lZGlhdGVseSBhZnRlciBpdCBkZXRlY3RzIGEKYFJlcGF5RnVsbEV2ZW50YCwgYnVpbGRzIHRoZSByZWxlYXNlIHRyYW5zYWN0aW9uLCBhbmQgY28tc2lnbnMgaXQuClN0b3JpbmcgdGhlIFBTQlQKb24tY2hhaW4gKHJhdGhlciB0aGFuIGUuZy4gSVBGUykgbWVhbnMgdGhlIHVzZXIgY2FuIHJldHJpZXZlIGFuZApicm9hZGNhc3QgaXQgZXZlbiBpZiB0aGUgZW50aXJlIFdyaXR6IG9mZi1jaGFpbiBzdGFjayBpcyBkb3duLgpSZWxheWVyIG9ubHkuAAAAFHB1Ymxpc2hfcmVsZWFzZV9wc2J0AAAAAwAAAAAAAAAHcmVsYXllcgAAAAATAAAAAAAAAAR0eGlkAAAD7gAAACAAAAAAAAAABHBzYnQAAAAOAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAWNFeHRlbmQgdGhlIFRUTCBvZiBhIHBvc2l0aW9uIGVudHJ5IHRvIGFub3RoZXIgMTgwLWRheSB3aW5kb3cuCgpJZiBhIHBvc2l0aW9uIGV4cGlyZXMsIHRoZSBkZXBvc2l0b3IgbG9zZXMgYWNjZXNzIHRvIHRoZWlyIHJlY29yZCBhbmQKdGhlIGR1cGxpY2F0ZS1kZXBvc2l0IGd1YXJkIGFsc28gZXhwaXJlcyAocmUtZGVwb3NpdCBhdHRhY2sgcmlzaykuCktlZXBlcnMgb3IgYm9ycm93ZXJzIHNob3VsZCBjYWxsIHRoaXMgYmVmb3JlIGFueSBwb3NpdGlvbiBhcHByb2FjaGVzCnRoZSBlbmQgb2YgaXRzIDE4MC1kYXkgd2luZG93LgpSZXR1cm5zIGZhbHNlIGlmIG5vIHBvc2l0aW9uIGV4aXN0cyBmb3IgdGhlIGdpdmVuIHR4aWQuAAAAABRyZWZyZXNoX3Bvc2l0aW9uX3R0bAAAAAEAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAADdFeHRlbmQgdGhlIFRUTCBvZiB0aGUgZ2xvYmFsIHByb3RvY29sIGFjY291bnRpbmcgZW50cnkuAAAAABRyZWZyZXNoX3Byb3RvY29sX3R0bAAAAAAAAAAA",
        "AAAAAAAAACdVcGRhdGUgdGhlIGtlZXBlciBhZGRyZXNzLiAgQWRtaW4gb25seS4AAAAAFnNldF9tYXhfdG90YWxfYm9ycm93ZWQAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAADbWF4AAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAGJVcGRhdGVzIGhvdyBtYW55IHNlY29uZHMgb2Yga2VlcGVyIGluYWN0aXZpdHkgYmVmb3JlIGxpcXVpZGF0aW9uCm9wZW5zIHRvIGFueSBjYWxsZXIuICBBZG1pbiBvbmx5LgAAAAAAF3NldF9rZWVwZXJfc3RhbGVfd2luZG93AAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAEc2VjcwAAAAYAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAaNFeHRlbmQgdGhlIFRUTCBvZiBhIHB1Ymxpc2hlZCByZWxlYXNlIFBTQlQgdG8gYW5vdGhlciB3aW5kb3cuCgpBIHJlcGFpZCBwb3NpdGlvbidzIHJlbGVhc2UgUFNCVCBpcyBvdGhlcndpc2Ugb25seSBidW1wZWQgYXMgYSBzaWRlCmVmZmVjdCBvZiBmZXRjaGluZyBvciByZS1wdWJsaXNoaW5nIGl0LiBBIHVzZXIgd2hvIGhhcyByZXBhaWQgYnV0Cmhhc24ndCB5ZXQgYnJvYWRjYXN0IHRoZWlyIHJlbGVhc2UgdHJhbnNhY3Rpb24gc2hvdWxkIGNhbGwgdGhpcyAob3IKaGF2ZSB0aGVpciB3YWxsZXQgY2FsbCBpdCBwZXJpb2RpY2FsbHkpIHJhdGhlciB0aGFuIHJlbHkgb24gYWN0aXZpdHkKdGhhdCBtYXkgbm90IGhhcHBlbiBmb3IgYSB3aGlsZS4gUmV0dXJucyBmYWxzZSBpZiBubyBQU0JUIGlzIG9uCnJlY29yZCBmb3IgdGhpcyB0eGlkLgAAAAAYcmVmcmVzaF9yZWxlYXNlX3BzYnRfdHRsAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAQZFeHRlbmQgdGhlIFRUTCBvZiBhIGxlbmRlcidzIHN1cHBseSBiYWxhbmNlIGVudHJ5IHRvIGFub3RoZXIgMTgwLWRheSB3aW5kb3cuCgpMZW5kZXJzIHdobyBzdXBwbGllZCBVU0RDIGFuZCBkbyBub3QgaW50ZXJhY3QgZm9yIGFuIGV4dGVuZGVkIHBlcmlvZCByaXNrCmhhdmluZyB0aGVpciBiYWxhbmNlIGVudHJ5IGV4cGlyZSwgcHJldmVudGluZyB3aXRoZHJhd2FsLgpSZXR1cm5zIGZhbHNlIGlmIHRoZSBsZW5kZXIgaGFzIG5vIHJlY29yZGVkIGJhbGFuY2UuAAAAAAAacmVmcmVzaF9zdXBwbHlfYmFsYW5jZV90dGwAAAAAAAEAAAAAAAAABmxlbmRlcgAAAAAAEwAAAAEAAAAB",
        "AAAABAAAAAAAAAAAAAAAEFByaXZhdGVMZW5kRXJyb3IAAAAYAAAAJkNvbnRyYWN0IGhhcyBhbHJlYWR5IGJlZW4gaW5pdGlhbGl6ZWQuAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAJkNvbnRyYWN0IGhhcyBub3QgYmVlbiBpbml0aWFsaXplZCB5ZXQuAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAYQ2FsbGVyIGlzIG5vdCB0aGUgYWRtaW4uAAAADFVuYXV0aG9yaXplZAAAAAMAAAA9VGhlIFNQViB2ZXJpZmljYXRpb24gY2FsbCB0byB0aGUgYml0Y29pbi1zcHYgY29udHJhY3QgZmFpbGVkLgAAAAAAABVTcHZWZXJpZmljYXRpb25GYWlsZWQAAAAAAAAEAAAAUE5vIFAyV1NIIG91dHB1dCBtYXRjaGluZyB0aGUgcHJvdmlkZWQgc2NyaXB0UHViS2V5IHdhcyBmb3VuZCBpbiB0aGUgdHJhbnNhY3Rpb24uAAAADk91dHB1dE5vdEZvdW5kAAAAAAAFAAAANVRoZSBCVEMgZGVwb3NpdCBpcyBiZWxvdyB0aGUgbWluaW11bSByZXF1aXJlZCBhbW91bnQuAAAAAAAAD0RlcG9zaXRUb29TbWFsbAAAAAAGAAAAMEEgcG9zaXRpb24gYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgQml0Y29pbiB0eGlkLgAAABVQb3NpdGlvbkFscmVhZHlFeGlzdHMAAAAAAAAHAAAALU5vIHBvc2l0aW9uIGZvdW5kIGZvciB0aGUgZ2l2ZW4gQml0Y29pbiB0eGlkLgAAAAAAABBQb3NpdGlvbk5vdEZvdW5kAAAACAAAAERUaGUgcG9zaXRpb24gaXMgbm90IGluIEFjdGl2ZSBzdGF0dXMgKGFscmVhZHkgY2xvc2VkIG9yIGxpcXVpZGF0ZWQpLgAAABFQb3NpdGlvbk5vdEFjdGl2ZQAAAAAAAAkAAAA/VGhlIGJvcnJvdyBhbW91bnQgd291bGQgZXhjZWVkIHRoZSBtYXhpbXVtIGxvYW4tdG8tdmFsdWUgcmF0aW8uAAAAABZFeGNlZWRzQ29sbGF0ZXJhbFJhdGlvAAAAAAAKAAAAJk5vdCBlbm91Z2ggVVNEQyBsaXF1aWRpdHkgaW4gdGhlIHBvb2wuAAAAAAAVSW5zdWZmaWNpZW50TGlxdWlkaXR5AAAAAAAACwAAAC5SZXBheW1lbnQgYW1vdW50IGV4Y2VlZHMgdGhlIG91dHN0YW5kaW5nIGRlYnQuAAAAAAAQUmVwYXlFeGNlZWRzRGVidAAAAAwAAAA3V2l0aGRyYXdhbCB3b3VsZCByZWR1Y2UgcG9vbCBiZWxvdyB0aGUgYm9ycm93ZWQgYW1vdW50LgAAAAASSW5zdWZmaWNpZW50U3VwcGx5AAAAAAANAAAANVRoZSBwb3NpdGlvbiBpcyBoZWFsdGh5IGFuZCBjYW5ub3QgYmUgbGlxdWlkYXRlZCB5ZXQuAAAAAAAAD1Bvc2l0aW9uSGVhbHRoeQAAAAAOAAAALkFuIGludGVnZXIgb3ZlcmZsb3cgb3IgdW5kZXJmbG93IHdhcyBkZXRlY3RlZC4AAAAAAAhPdmVyZmxvdwAAAA8AAABEVGhlIHByb3ZpZGVkIHNjcmlwdFB1YktleSBpcyBub3QgYSB2YWxpZCAzNC1ieXRlIFAyV1NIIHNjcmlwdFB1YktleS4AAAATSW52YWxpZFNjcmlwdFB1YktleQAAAAAQAAAAu1RoZSBjb250cmFjdCBpcyBwYXVzZWQgLSBuZXcgZGVwb3NpdHMsIGJvcnJvd3MsIGFuZCBVU0RDIHN1cHBseSBhcmUKcmVmdXNlZC4gRXhpc3RpbmcgcG9zaXRpb25zIGNhbiBzdGlsbCByZXBheSwgd2l0aGRyYXcsIGxpcXVpZGF0ZSwgYW5kCnJlbGVhc2UgQlRDOyBhIHBhdXNlIG9ubHkgYmxvY2tzIG5ldyByaXNrLXRha2luZy4AAAAABlBhdXNlZAAAAAAAEQAAAG5UaGUgb3JhY2xlIHJldHVybmVkIG5vIHByaWNlIGZvciBCVEMvVVNELCBvciBpdHMgcmF3IHByaWNlIGNvbnZlcnRlZAp0byBhIHplcm8gb3IgbmVnYXRpdmUgVVNEQy1zdHJvb3BzIHZhbHVlLgAAAAAAFk9yYWNsZVByaWNlVW5hdmFpbGFibGUAAAAAABIAAABQVGhlIG9yYWNsZSdzIGxhc3QgcHJpY2UgdXBkYXRlIGlzIG9sZGVyIHRoYW4KYG9yYWNsZTo6TUFYX1BSSUNFX1NUQUxFTkVTU19TRUNTYC4AAAAQT3JhY2xlUHJpY2VTdGFsZQAAABMAAABAYHVzZXJfcHVia2V5YCBpcyBub3QgYSBjb21wcmVzc2VkIHNlY3AyNTZrMSBwdWJsaWMga2V5IGVuY29kaW5nLgAAABFJbnZhbGlkVXNlclB1YmtleQAAAAAAABQAAADDVGhlIHN1cHBsaWVkIHNjcmlwdFB1YktleSBpcyBub3QgdGhlIFAyV1NIIG9mIHRoZSBXcml0eiByZWRlZW0gc2NyaXB0CmRlcml2ZWQgZnJvbSB0aGUgcHJvdG9jb2wga2V5LCBgdXNlcl9wdWJrZXlgIGFuZCBgdGltZWxvY2tfaGVpZ2h0YCwKc28gdGhlIG91dHB1dCBpcyBub3QgbG9ja2VkIHVuZGVyIHRoZSBwcm90b2NvbCdzIGNvbnRyb2wuAAAAABRTY3JpcHRQdWJLZXlNaXNtYXRjaAAAABUAAACHYHRpbWVsb2NrX2hlaWdodGAgaXMgbm90IHdpdGhpbiB0aGUgYWxsb3dlZCB3aW5kb3cgYWJvdmUgdGhlIGRlcG9zaXQKYmxvY2s6IHRvbyBzb29uIChhbiBpbnN0YW50IGV4aXQgZm9yIGEgZnJlc2ggcG9zaXRpb24pIG9yIHRvbyBmYXIuAAAAAA9JbnZhbGlkVGltZWxvY2sAAAAAFgAAAFVUaGUgY29uZmlndXJlZCBwcm90b2NvbCBwdWJsaWMga2V5IGlzIG5vdCBhIGNvbXByZXNzZWQgc2VjcDI1NmsxCnB1YmxpYyBrZXkgZW5jb2RpbmcuAAAAAAAAFUludmFsaWRQcm90b2NvbFB1YmtleQAAAAAAABcAAABeVGhlIGJvcnJvdyB3b3VsZCB0YWtlIHRoZSBwb29sIHBhc3QgaXRzIHRvdGFsIGV4cG9zdXJlIGNhcCAoc2VlIGBDb25maWc6Om1heF90b3RhbF9ib3Jyb3dlZGApLgAAAAAAE0V4cG9zdXJlQ2FwRXhjZWVkZWQAAAAAGA==",
        "AAAAAQAAAQ1Qcm90b2NvbCBjb25maWd1cmF0aW9uLCBzZXQgYXQgaW5pdGlhbGl6YXRpb24uIE1vc3QgZmllbGRzIGFyZSBmaXhlZCBmb3IKdGhlIGNvbnRyYWN0J3MgbGlmZXRpbWU7IGBrZWVwZXJgLCBgcmVsYXllcmAsIGBrZWVwZXJfc3RhbGVfYWZ0ZXJfc2Vjc2AsCmFuZCBgcGF1c2VkYCBhcmUgYWRtaW4tbXV0YWJsZSB2aWEgdGhlaXIgb3duIHNldHRlcnMgLSBzZWUgYGxpYi5yc2AuCgpTdG9yZWQgdW5kZXIgYERhdGFLZXk6OkNvbmZpZ2AgaW4gcGVyc2lzdGVudCBzdG9yYWdlLgAAAAAAAAAAAAAGQ29uZmlnAAAAAAAPAAAALkFkbWluIGFkZHJlc3MgLSBjYW4gdXBkYXRlIHRoZSBrZWVwZXIgYWRkcmVzcy4AAAAAAAVhZG1pbgAAAAAAABMAAAAwVHJ1c3RlZCBrZWVwZXIgYWRkcmVzcyBmb3IgUGhhc2UgMSBsaXF1aWRhdGlvbnMuAAAABmtlZXBlcgAAAAAAEwAAANdTZWNvbmRzIG9mIGtlZXBlciBpbmFjdGl2aXR5IGFmdGVyIHdoaWNoIGxpcXVpZGF0aW9uIG9wZW5zIHRvIGFueQpjYWxsZXIsIG5vdCBqdXN0IGBrZWVwZXJgIChkZWZhdWx0OiA4Nl80MDAgPSAyNGgpLiBUaGlzIGlzIGEKbGl2ZW5lc3MvY2Vuc29yc2hpcCBmYWxsYmFjaywgbm90IGEgcHJpdmFjeSBtZWNoYW5pc20gKHRoaXMgY29udHJhY3QKaGFzIG5vIFpLIHByaXZhY3kpLgAAAAAXa2VlcGVyX3N0YWxlX2FmdGVyX3NlY3MAAAAABgAAAEdCb251cyB0aGUgbGlxdWlkYXRvciBlYXJucyBleHByZXNzZWQgYXMgYWRkaXRpb25hbCBCVEMgJSAoMV8wMDAgPSAxMCUpLgAAAAAUbGlxdWlkYXRpb25fYm9udXNfYnAAAAAEAAAARkhlYWx0aCByYXRpbyBiZWxvdyB3aGljaCBhIHBvc2l0aW9uIGNhbiBiZSBsaXF1aWRhdGVkICgxMl8wMDAgPSAxMjAlKS4AAAAAABhsaXF1aWRhdGlvbl90aHJlc2hvbGRfYnAAAAAEAAAAwENlaWxpbmcgb24gdG90YWwgVVNEQyB0aGUgcG9vbCBtYXkgaGF2ZSBib3Jyb3dlZCBvdXQsIGluIHN0cm9vcHMuIEEKY2FwIGJvdW5kcyBob3cgbXVjaCBiYWQgZGVidCBhIHByaWNlIGNyYXNoIGNhbiBsZWF2ZSBiZWhpbmQgd2hlbgpsaXF1aWRhdGlvbiBjYW5ub3QgcmVsZWFzZSBCVEMgKEdIU0EtNXJ4cC03ZjlnLXI2NngsICMxOTMpLgAAABJtYXhfdG90YWxfYm9ycm93ZWQAAAAAAAsAAAA5TWluaW11bSBjb2xsYXRlcmFsIHJhdGlvIGluIGJhc2lzIHBvaW50cyAoMTVfMDAwID0gMTUwJSkuAAAAAAAAF21pbl9jb2xsYXRlcmFsX3JhdGlvX2JwAAAAAAQAAABJTWluaW11bSBTUFYgY29uZmlybWF0aW9uIGRlcHRoIGJlZm9yZSBhIGRlcG9zaXQgaXMgYWNjZXB0ZWQgKGRlZmF1bHQ6IDYpLgAAAAAAABFtaW5fY29uZmlybWF0aW9ucwAAAAAAAAQAAAA/TWluaW11bSBCVEMgZGVwb3NpdCBpbiBzYXRvc2hpcyAoZGVmYXVsdDogMTAwXzAwMCA9IDAuMDAxIEJUQykuAAAAABRtaW5fZGVwb3NpdF9zYXRvc2hpcwAAAAYAAACeQWRkcmVzcyBvZiBSZWZsZWN0b3IncyBleHRlcm5hbC1wcmljZXMgU0VQLTQwIEJUQy9VU0Qgb3JhY2xlIChzZWUKZG9jcy9yZXNlYXJjaC9vcmFjbGUtZGVzaWduLm1kKS4gUHl0aCBjcm9zcy1jaGVjayBub3QgeWV0IHdpcmVkIC0Kc2luZ2xlLXNvdXJjZSB1bnRpbCBpdCBpcy4AAAAAAAZvcmFjbGUAAAAAABMAAAF5V2hlbiB0cnVlLCBgZGVwb3NpdGAvYGJvcnJvd2AvYHN1cHBseV91c2RjYCAobmV3IHJpc2stdGFraW5nIGFjdGlvbnMpCmFyZSByZWZ1c2VkLiBgcmVwYXlgL2B3aXRoZHJhd19zdXBwbHlgL2BsaXF1aWRhdGVgL2BwdWJsaXNoX3JlbGVhc2VfcHNidGAKc3RheSBvcGVuIHNvIHVzZXJzIGNhbiBzdGlsbCBleGl0IC0gYSBwYXVzZSBpcyBhbiBlbWVyZ2VuY3kgYnJha2Ugb24KbmV3IGV4cG9zdXJlLCBub3QgYSBmcmVlemUgb24gZXhpc3RpbmcgcG9zaXRpb25zLiBBZG1pbi1nYXRlZCB2aWEKYHNldF9wYXVzZWRgLiBTZWUgYGRvY3MvYXJjaGl0ZWN0dXJlL2NvbnRyYWN0LW1pZ3JhdGlvbi1ydW5ib29rLm1kYCwKVHJhY2sgMiwgZm9yIHdoeSB0aGlzIGV4aXN0cy4AAAAAAAAGcGF1c2VkAAAAAAABAAABBlRoZSBwcm90b2NvbCdzIDMzLWJ5dGUgY29tcHJlc3NlZCBCaXRjb2luIGNvLXNpZ25pbmcgcHVibGljIGtleSAtIHRoZQprZXkgZW1iZWRkZWQgaW4gZXZlcnkgV3JpdHogcmVkZWVtIHNjcmlwdCAocGF0aCBBKS4gYGRlcG9zaXRgIGRlcml2ZXMKdGhlIGV4cGVjdGVkIHNjcmlwdFB1YktleSBmcm9tIGl0LCBzbyBpdCBpcyBmaXhlZCBmb3IgdGhlIGNvbnRyYWN0J3MKbGlmZXRpbWU7IHJvdGF0aW5nIGl0IG1lYW5zIGRlcGxveWluZyBhIG5ldyBjb250cmFjdC4AAAAAAA9wcm90b2NvbF9wdWJrZXkAAAAD7gAAACEAAAB0QWRkcmVzcyBhdXRob3JpemVkIHRvIHB1Ymxpc2ggYSBjby1zaWduZWQgcmVsZWFzZSBQU0JUIHZpYQpgcHVibGlzaF9yZWxlYXNlX3BzYnRgICh0aGUgYXV0by1jb3NpZ24gcmVsYXllciB3YXRjaGVyKS4AAAAHcmVsYXllcgAAAAATAAAAN0FkZHJlc3Mgb2YgdGhlIGRlcGxveWVkIGBiaXRjb2luLXNwdmAgU29yb2JhbiBjb250cmFjdC4AAAAADHNwdl9jb250cmFjdAAAABMAAAA7QWRkcmVzcyBvZiB0aGUgVVNEQyBTdGVsbGFyIEFzc2V0IENvbnRyYWN0IG9uIHRoaXMgbmV0d29yay4AAAAACnVzZGNfdG9rZW4AAAAAABM=",
        "AAAAAQAAAN9BIHNpbmdsZSBCVEMtY29sbGF0ZXJhbGl6ZWQgbGVuZGluZyBwb3NpdGlvbi4KClN0b3JlZCBpbiBwZXItZW50cnkgcGVyc2lzdGVudCBzdG9yYWdlIGtleWVkIGJ5IEJpdGNvaW4gdHhpZC4KTmV2ZXIgc3RvcmVkIGluIGEgZ3Jvd2luZyBjb2xsZWN0aW9uIG9uIHRoZSBpbnN0YW5jZSAtIHNlZSBDZXJ0aUsgd2FybmluZwphYm91dCB1bmJvdW5kZWQgaW5zdGFuY2Ugc3RvcmFnZSBncm93dGguAAAAAAAAAAAIUG9zaXRpb24AAAAJAAAARFNhdG9zaGlzIGxvY2tlZCBpbiB0aGUgUDJXU0ggb3V0cHV0IC0gdmVyaWZpZWQgb24tY2hhaW4gZnJvbSByYXdfdHguAAAADGJ0Y19zYXRvc2hpcwAAAAYAAABFQml0Y29pbiB0cmFuc2FjdGlvbiBJRCAoMzIgYnl0ZXMsIGludGVybmFsL2xpdHRsZS1lbmRpYW4gYnl0ZSBvcmRlcikuAAAAAAAACGJ0Y190eGlkAAAD7gAAACAAAABDVGhlIGRlcG9zaXRvcidzIFN0ZWxsYXIgYWRkcmVzcyAobXVzdCByZXBheSB0byBjbG9zZSB0aGUgcG9zaXRpb24pLgAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAADxTdGVsbGFyIGxlZGdlciBzZXF1ZW5jZSBudW1iZXIgYXQgdGhlIGxhc3QgaW50ZXJlc3QgYWNjcnVhbC4AAAASbGFzdF91cGRhdGVfbGVkZ2VyAAAAAAAEAAAAj1RoZSAzNC1ieXRlIFAyV1NIIHNjcmlwdFB1YktleSAoT1BfMCArIDMyLWJ5dGUgc2NyaXB0IGhhc2gpIG9mIHRoaXMgZGVwb3NpdC4KVXNlZCBieSB0aGUgYmFja2VuZCB0byBpZGVudGlmeSB3aGljaCBVVFhPIHRvIGNvLXNpZ24gZm9yIHJlbGVhc2UuAAAAABNwMndzaF9zY3JpcHRfcHVia2V5AAAAAA4AAAAAAAAABnN0YXR1cwAAAAAH0AAAAA5Qb3NpdGlvblN0YXR1cwAAAAAAQkFic29sdXRlIEJpdGNvaW4gYmxvY2sgaGVpZ2h0IGZvciB0aGUgQ0xUViBlbWVyZ2VuY3kgZXNjYXBlIGhhdGNoLgAAAAAAD3RpbWVsb2NrX2hlaWdodAAAAAAEAAAAYU91dHN0YW5kaW5nIFVTREMgZGVidCBpbiBzdHJvb3BzICgxIFVTREMgPSAxMF8wMDBfMDAwIHN0cm9vcHMpLgpHcm93cyB3aXRoIGVhY2ggaW50ZXJlc3QgYWNjcnVhbC4AAAAAAAAJdXNkY19kZWJ0AAAAAAAACwAAAaBUaGUgZGVwb3NpdG9yJ3MgMzMtYnl0ZSBjb21wcmVzc2VkIEJpdGNvaW4gcHVibGljIGtleS4KQWxyZWFkeSBwdWJsaWMgaW5mb3JtYXRpb24gLSBpdCdzIHJldmVhbGVkIHRoZSBtb21lbnQgZWl0aGVyCnNwZW5kaW5nIHBhdGggaXMgdXNlZCAtIHNvIHN0b3JpbmcgaXQgcGxhaW50ZXh0IGlzIG5vdCBhIG5ldyBwcml2YWN5CmxlYWsuIExldHMgdGhlIGF1dG8tY29zaWduIHJlbGF5ZXIgd2F0Y2hlciByZWNvbnN0cnVjdCB0aGUgcmVkZWVtCnNjcmlwdCBhbmQgdGhlIHVzZXIncyBkZWZhdWx0IHJldHVybiBhZGRyZXNzIChhIFAyV1BLSCBhZGRyZXNzCmRlcml2ZWQgZnJvbSB0aGlzIGtleSkgZnJvbSBvbi1jaGFpbiBzdGF0ZSBhbG9uZSwgd2l0aG91dCBhIHNlcGFyYXRlCm9mZi1jaGFpbiAicmV0dXJuIGFkZHJlc3MiIHN0b3JlLgAAAAt1c2VyX3B1YmtleQAAAAPuAAAAIQ==",
        "AAAAAQAAAFBHbG9iYWwgcHJvdG9jb2wgYWNjb3VudGluZy4KCkEgc2luZ2xlIGluc3RhbmNlIHN0b3JlZCB1bmRlciBgRGF0YUtleTo6UHJvdG9jb2xgLgAAAAAAAAANUHJvdG9jb2xTdGF0ZQAAAAAAAAMAAAErTGVkZ2VyIHRpbWVzdGFtcCBvZiB0aGUgbW9zdCByZWNlbnQgc3VjY2Vzc2Z1bCBsaXF1aWRhdGlvbiBieSB0aGUKZGVzaWduYXRlZCBgY29uZmlnLmtlZXBlcmAuIFVzZWQgdG8gZGV0ZWN0IGEgc3RhbGUvYWJzZW50CmtlZXBlciBhbmQgb3BlbiBsaXF1aWRhdGlvbiB0byBhbnkgY2FsbGVyIHdpdGggYSB2YWxpZAp1bmRlcmNvbGxhdGVyYWxpemF0aW9uIGNoZWNrIGFmdGVyIGBjb25maWcua2VlcGVyX3N0YWxlX2FmdGVyX3NlY3NgLgpFeHBsaWNpdCBga2VlcGVyX2hlYXJ0YmVhdGAgY2FsbHMgYWxzbyB1cGRhdGUgdGhpcy4AAAAAFWxhc3Rfa2VlcGVyX2hlYXJ0YmVhdAAAAAAAAAYAAAB/VG90YWwgb3V0c3RhbmRpbmcgVVNEQyBkZWJ0IGFjcm9zcyBhbGwgYWN0aXZlIHBvc2l0aW9ucyAoaW4gc3Ryb29wcykuClVwZGF0ZWQgb24gZXZlcnkgYm9ycm93LCByZXBheSwgYWNjcnVhbCwgYW5kIGxpcXVpZGF0aW9uLgAAAAAOdG90YWxfYm9ycm93ZWQAAAAAAAsAAACcVG90YWwgVVNEQyBzdXBwbGllZCBieSBsZW5kZXJzIChpbiBzdHJvb3BzKS4gRG9lcyBub3QgZGVjcmVhc2Ugd2hlbgppbnRlcmVzdCBhY2NydWVzIC0gaW50ZXJlc3QgZWFybmVkIGluY3JlYXNlcyB0aGUgZWZmZWN0aXZlIHZhbHVlIG9mCmVhY2ggbGVuZGVyJ3Mgc2hhcmUuAAAADnRvdGFsX3N1cHBsaWVkAAAAAAAL",
        "AAAAAgAAABpQb3NpdGlvbiBsaWZlY3ljbGUgc3RhdGVzLgAAAAAAAAAAAA5Qb3NpdGlvblN0YXR1cwAAAAAAAwAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAEpMb2FuIGZ1bGx5IHJlcGFpZDsgcHJvdG9jb2wgY28tc2lnbmF0dXJlIGZvciBCVEMgcmVsZWFzZSBoYXMgYmVlbiBlbWl0dGVkLgAAAAAABkNsb3NlZAAAAAAAAAAAAD5Qb3NpdGlvbiB3YXMgdW5kZXJjb2xsYXRlcmFsaXplZCBhbmQgbGlxdWlkYXRlZCBieSB0aGUga2VlcGVyLgAAAAAACkxpcXVpZGF0ZWQAAA==",
        "AAAABQAAAEVFbWl0dGVkIHdoZW4gYSBwYXJ0aWFsIHJlcGF5bWVudCByZWR1Y2VzIGJ1dCBkb2VzIG5vdCBjbGVhciB0aGUgZGVidC4AAAAAAAAAAAAAClJlcGF5RXZlbnQAAAAAAAEAAAAFcmVwYXkAAAAAAAACAAAAAAAAAAR0eGlkAAAD7gAAACAAAAABAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAI=",
        "AAAABQAAADpFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciBkcmF3cyBVU0RDIGFnYWluc3QgYSBCVEMgcG9zaXRpb24uAAAAAAAAAAAAC0JvcnJvd0V2ZW50AAAAAAEAAAAGYm9ycm93AAAAAAADAAAAAAAAAAR0eGlkAAAD7gAAACAAAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAPxFbWl0dGVkIHdoZW4gYSBsZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbC4KCkNsb3NlcyBhIGdhcCBub3RlZCBpbiBgZG9jcy9hcmNoaXRlY3R1cmUvY29udHJhY3QtbWlncmF0aW9uLXJ1bmJvb2subWRgOgp3aXRob3V0IHRoaXMgZXZlbnQsIGxlbmRlcnMgY291bGQgbm90IGJlIGVudW1lcmF0ZWQgb2ZmLWNoYWluIGF0IGFsbAooYGdldF9zdXBwbHlfYmFsYW5jZWAgcmVxdWlyZXMgYWxyZWFkeSBrbm93aW5nIHRoZSBhZGRyZXNzKS4AAAAAAAAAC1N1cHBseUV2ZW50AAAAAAEAAAAGc3VwcGx5AAAAAAADAAAAAAAAAAhzdXBwbGllcgAAABMAAAABAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAAAAAAOdG90YWxfc3VwcGxpZWQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAADdFbWl0dGVkIHdoZW4gYSBCVEMgZGVwb3NpdCBpcyByZWdpc3RlcmVkIHZpYSBTUFYgcHJvb2YuAAAAAAAAAAAMRGVwb3NpdEV2ZW50AAAAAQAAAAdkZXBvc2l0AAAAAAMAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAAAAAADGJ0Y19zYXRvc2hpcwAAAAYAAAAAAAAAAAAAAA90aW1lbG9ja19oZWlnaHQAAAAABAAAAAAAAAAC",
        "AAAABQAAADNFbWl0dGVkIHdoZW4gYSBsZW5kZXIgd2l0aGRyYXdzIFVTREMgZnJvbSB0aGUgcG9vbC4AAAAAAAAAAA1XaXRoZHJhd0V2ZW50AAAAAAAAAQAAAAh3aXRoZHJhdwAAAAMAAAAAAAAACHN1cHBsaWVyAAAAEwAAAAEAAAAAAAAAC3VzZGNfYW1vdW50AAAAAAsAAAAAAAAAAAAAAA50b3RhbF9zdXBwbGllZAAAAAAACwAAAAAAAAAC",
        "AAAABQAAARJFbWl0dGVkIHdoZW4gYSBrZWVwZXIgbGlxdWlkYXRlcyBhbiB1bmRlcmNvbGxhdGVyYWxpemVkIHBvc2l0aW9uLgoKUmVjb3JkcyB0aGF0IHRoZSBkZWJ0IHdhcyByZXBhaWQuIEl0IG1ha2VzIG5vIHByb21pc2UgYWJvdXQgQml0Y29pbjogdGhlCmNvbGxhdGVyYWwgc3RheXMgdW5kZXIgdGhlIHVzZXIncyBzY3JpcHQgYW5kIHRoZSBwcm90b2NvbCBkb2VzIG5vdCBtb3ZlIGl0CihHSFNBLTVyeHAtN2Y5Zy1yNjZ4KS4gS2VlcGVyIGNvbXBlbnNhdGlvbiBpcyBub3QgeWV0IHBhaWQuAAAAAAAAAAAADkxpcXVpZGF0ZUV2ZW50AAAAAAABAAAACWxpcXVpZGF0ZQAAAAAAAAIAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAQJFbWl0dGVkIHdoZW4gdGhlIGFkbWluIGNoYW5nZXMgdGhlIG9yYWNsZSBjb250cmFjdCBhZGRyZXNzLgpTaW5jZSBgZ2V0X2J0Y19wcmljZV9zdHJvb3BzYCBjYWxscyB0aGlzIGFkZHJlc3MgbGl2ZSBmb3IgZXZlcnkKcHJpY2UtZGVwZW5kZW50IG9wZXJhdGlvbiwgYSBjaGFuZ2UgaGVyZSBpcyBhIGNoYW5nZSBpbiByZWFsIGNvbGxhdGVyYWwKcHJpY2luZyBhbmQgc2hvdWxkIGJlIG9ic2VydmFibGUgb2ZmLWNoYWluIC0gc2VlIGBzZXRfb3JhY2xlYC4AAAAAAAAAAAAOT3JhY2xlU2V0RXZlbnQAAAAAAAEAAAAKb3JhY2xlX3NldAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAAAAAAAAKbmV3X29yYWNsZQAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAI9FbWl0dGVkIHdoZW4gdGhlIGFkbWluIHBhdXNlcyBvciB1bnBhdXNlcyBuZXcgZGVwb3NpdHMvYm9ycm93cy9zdXBwbHkuCkV4aXN0aW5nIHBvc2l0aW9ucyBhcmUgbmV2ZXIgYWZmZWN0ZWQgYnkgYSBwYXVzZSAtIHNlZSBgQ29uZmlnOjpwYXVzZWRgLgAAAAAAAAAADlBhdXNlZFNldEV2ZW50AAAAAAABAAAACnBhdXNlZF9zZXQAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAALlFbWl0dGVkIHdoZW4gYSByZXBheW1lbnQgZnVsbHkgY2xlYXJzIHRoZSBvdXRzdGFuZGluZyBkZWJ0LgoKVGhlIFdyaXR6IGJhY2tlbmQgbW9uaXRvcnMgdGhpcyBldmVudCB0byBjby1zaWduIHRoZSBCaXRjb2luIHJlbGVhc2UKdHJhbnNhY3Rpb24gKHNwZW5kaW5nIHBhdGggQTogcHJvdG9jb2wga2V5ICsgdXNlciBrZXkpLgAAAAAAAAAAAAAOUmVwYXlGdWxsRXZlbnQAAAAAAAEAAAAKcmVwYXlfZnVsbAAAAAAAAwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAAAAAAAAHcmVwYXllcgAAAAATAAAAAAAAAAAAAAATcDJ3c2hfc2NyaXB0X3B1YmtleQAAAAAOAAAAAAAAAAI=",
        "AAAAAgAAAMNTRVAtNDAgYXNzZXQgaWRlbnRpZmllci4gRmllbGQvdmFyaWFudCBzaGFwZSBtdXN0IG1hdGNoIFJlZmxlY3RvcidzIG93bgpgQXNzZXRgIGVudW0gZXhhY3RseSBmb3IgWERSIGRlY29kaW5nIHRvIHdvcmsgLSB0aGUgUnVzdCB0eXBlIG5hbWUgaGVyZQpkb2VzIG5vdCBuZWVkIHRvIG1hdGNoLCBvbmx5IHRoZSBvbi10aGUtd2lyZSBzaGFwZS4AAAAAAAAAAAVBc3NldAAAAAAAAAIAAAABAAAAAAAAAAdTdGVsbGFyAAAAAAEAAAATAAAAAQAAAAAAAAAFT3RoZXIAAAAAAAABAAAAEQ==",
        "AAAAAQAAAHNTRVAtNDAgcHJpY2UgcmVjb3JkLiBTaGFwZSBtdXN0IG1hdGNoIFJlZmxlY3RvcidzIG93biBgUHJpY2VEYXRhYCBzdHJ1Y3QKZXhhY3RseSAoc2FtZSByZWFzb25pbmcgYXMgYEFzc2V0YCBhYm92ZSkuAAAAAAAAAAAJUHJpY2VEYXRhAAAAAAAAAgAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAl0aW1lc3RhbXAAAAAAAAAG",
        "AAAAAgAAARVTdG9yYWdlIGtleXMgLSBlYWNoIHZhcmlhbnQgbWFwcyB0byBhbiBpc29sYXRlZCBwZXJzaXN0ZW50IHN0b3JhZ2UgZW50cnkuCgpVc2luZyBwZXItZW50cnkga2V5aW5nIChub3QgYSBzaW5nbGUgZ3Jvd2luZyBtYXApIHByZXZlbnRzIHVuYm91bmRlZAppbnN0YW5jZSBzdG9yYWdlIGdyb3d0aCwgd2hpY2ggaXMgdGhlICMxIFNvcm9iYW4gdnVsbmVyYWJpbGl0eSBjbGFzcwppZGVudGlmaWVkIGJ5IHRoZSBTdGVsbGFyIEF1ZGl0IEJhbmsgKENlcnRpSywgT3R0ZXJTZWMsIFplbGxpYykuAAAAAAAAAAAAAAdEYXRhS2V5AAAAAAUAAAAAAAAAP1NpbmdsZXRvbjogcHJvdG9jb2wgY29uZmlndXJhdGlvbiAoc2V0IG9uY2UgYXQgaW5pdGlhbGl6YXRpb24pLgAAAAAGQ29uZmlnAAAAAAAAAAAAPlNpbmdsZXRvbjogZ2xvYmFsIGFjY291bnRpbmcgc3RhdGUgKGJvcnJvd2VkL3N1cHBsaWVkIHRvdGFscykuAAAAAAAIUHJvdG9jb2wAAAABAAAAMFBlci1kZXBvc2l0IHBvc2l0aW9uLCBrZXllZCBieSB0aGUgQml0Y29pbiB0eGlkLgAAAAhQb3NpdGlvbgAAAAEAAAPuAAAAIAAAAAEAAAAqUGVyLWxlbmRlciBVU0RDIHN1cHBseSBiYWxhbmNlIGluIHN0cm9vcHMuAAAAAAANU3VwcGx5QmFsYW5jZQAAAAAAAAEAAAATAAAAAQAAANBUaGUgcmVsYXllci1wdWJsaXNoZWQsIGNvLXNpZ25lZCBQYXRoIEEgcmVsZWFzZSBQU0JUIGZvciBhIGZ1bGx5CnJlcGFpZCBwb3NpdGlvbiwga2V5ZWQgYnkgQml0Y29pbiB0eGlkLiBMZXRzIGEgdXNlcgpyZXRyaWV2ZSBhbmQgYnJvYWRjYXN0IHRoZWlyIHJlbGVhc2UgdHJhbnNhY3Rpb24gZXZlbiBpZiB0aGUgV3JpdHoKZnJvbnRlbmQgaXMgdW5hdmFpbGFibGUuAAAAC1JlbGVhc2VQc2J0AAAAAAEAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAAFVNwdlZlcmlmaWNhdGlvblJlc3VsdAAAAAAAAAQAAAA+VGhlIGhhc2ggKFNIQTI1NmQpIG9mIHRoZSBibG9jayB0aGF0IGNvbnRhaW5zIHRoZSB0cmFuc2FjdGlvbi4AAAAAAApibG9ja19oYXNoAAAAAAPuAAAAIAAAADpCaXRjb2luIGhlaWdodCBvZiB0aGUgYmxvY2sgdGhhdCBjb250YWlucyB0aGUgdHJhbnNhY3Rpb24uAAAAAAAMYmxvY2tfaGVpZ2h0AAAABAAAAEFUaGUgYmxvY2sncyBkZXB0aCBiZWxvdyB0aGUgYmVzdCBjaGFpbiB0aXAgKHRoZSB0aXAgaXRzZWxmIGlzIDEpLgAAAAAAAA1jb25maXJtYXRpb25zAAAAAAAABAAAAEVUaGUgdHJhbnNhY3Rpb24gaWRlbnRpZmllcjogU0hBMjU2ZCBvZiB0aGUgbm9uLXdpdG5lc3Mgc2VyaWFsaXphdGlvbi4AAAAAAAAEdHhpZAAAA+4AAAAg" ]),
      options
    )
  }
  public readonly fromJSON = {
    repay: this.txFromJSON<Result<void>>,
        borrow: this.txFromJSON<Result<void>>,
        deposit: this.txFromJSON<Result<Buffer>>,
        liquidate: this.txFromJSON<Result<void>>,
        set_keeper: this.txFromJSON<Result<void>>,
        set_oracle: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        set_relayer: this.txFromJSON<Result<void>>,
        supply_usdc: this.txFromJSON<Result<void>>,
        get_position: this.txFromJSON<Option<Position>>,
        withdraw_supply: this.txFromJSON<Result<void>>,
        get_release_psbt: this.txFromJSON<Option<Buffer>>,
        keeper_heartbeat: this.txFromJSON<Result<void>>,
        set_spv_contract: this.txFromJSON<Result<void>>,
        get_borrow_rate_bp: this.txFromJSON<i128>,
        get_protocol_state: this.txFromJSON<ProtocolState>,
        get_supply_balance: this.txFromJSON<i128>,
        get_supply_rate_bp: this.txFromJSON<i128>,
        get_health_ratio_bp: this.txFromJSON<Result<i128>>,
        publish_release_psbt: this.txFromJSON<Result<void>>,
        refresh_position_ttl: this.txFromJSON<boolean>,
        refresh_protocol_ttl: this.txFromJSON<null>,
        set_max_total_borrowed: this.txFromJSON<Result<void>>,
        set_keeper_stale_window: this.txFromJSON<Result<void>>,
        refresh_release_psbt_ttl: this.txFromJSON<boolean>,
        refresh_supply_balance_ttl: this.txFromJSON<boolean>
  }
}