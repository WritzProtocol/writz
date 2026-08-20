/**
 * Auto-generated Soroban TypeScript bindings for the `private-lend`
 * contract, produced via:
 *
 *   stellar contract build
 *   stellar contract bindings typescript \
 *     --wasm contracts/target/wasm32v1-none/release/private_lend.wasm \
 *     --output-dir packages/private-lend
 *
 * Copied directly into the relayer's source tree - generating this as a
 * separate local `file:` package (matching `commitment-tree`'s pattern)
 * triggered a reproducible bun dependency-resolution bug: with two local
 * `file:` packages both declaring `@stellar/stellar-sdk` as a dependency,
 * bun fails to correctly link the second package's transitive deps
 * (`Cannot find module '@noble/hashes/sha2.js'` / `'base32.js'`), even
 * after a full cache clear. Living directly in `relayer/src` sidesteps
 * this entirely, since it uses the relayer's own already-working
 * `@stellar/stellar-sdk` installation instead of a separate copy.
 *
 * Regenerate this file (rerun the command above and copy the new
 * `packages/private-lend/src/index.ts` over this file) whenever
 * `private-lend`'s contract interface changes.
 */
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
  16: {message:"InvalidScriptPubKey"}
}


/**
 * Immutable protocol configuration set at initialization.
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
 * Address of the SEP-40 BTC/USD price oracle (RedStone primary).
 */
oracle: string;
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
 * Return type of the cross-contract SPV verification call.
 * 
 * Must match the `VerificationResult` contracttype in the `bitcoin-spv` contract
 * field-for-field so that Soroban's Val encoding deserializes correctly.
 */
export interface SpvResult {
  block_hash: Buffer;
  confirmations: u32;
  txid: Buffer;
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
 * Storage keys - each variant maps to an isolated persistent storage entry.
 * 
 * Using per-entry keying (not a single growing map) prevents unbounded
 * instance storage growth, which is the #1 Soroban vulnerability class
 * identified by the Stellar Audit Bank (CertiK, OtterSec, Zellic).
 */
export type DataKey = {tag: "Config", values: void} | {tag: "Protocol", values: void} | {tag: "Position", values: readonly [Buffer]} | {tag: "SupplyBalance", values: readonly [string]} | {tag: "ReleasePsbt", values: readonly [Buffer]};

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
   * 1. Calls the `bitcoin-spv` contract to verify the transaction inclusion.
   * 2. Parses the raw transaction on-chain to find the P2WSH output matching
   * `p2wsh_script_pubkey` and read the deposited satoshi amount.
   * 3. Creates a `Position` entry in persistent storage.
   * 
   * After this call succeeds the user can borrow USDC against the position.
   * 
   * # Parameters
   * - `depositor`          - Stellar address of the depositor (must authorize).
   * - `headers`            - Bitcoin block headers (80 bytes each).
   * - `merkle_proof`       - Sibling hashes for the Merkle inclusion proof.
   * - `tx_index`           - 0-based index of the transaction in its block.
   * - `raw_tx`             - Non-witness serialization of the Bitcoin transaction.
   * - `p2wsh_script_pubkey`- 34-byte P2WSH scriptPubKey (OP_0 + 32-byte hash)
   * of the deposit output.
   * - `timelock_height`    - Bitcoin block height of the CLTV escape hatch.
   * - `user_pubkey`        - Depositor's 33-byte compressed Bitcoin
   */
  deposit: ({depositor, headers, merkle_proof, tx_index, raw_tx, p2wsh_script_pubkey, timelock_height, user_pubkey}: {depositor: string, headers: Array<Buffer>, merkle_proof: Array<Buffer>, tx_index: u32, raw_tx: Buffer, p2wsh_script_pubkey: Buffer, timelock_height: u32, user_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

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
   * - A `liquidate` event is emitted containing the caller's address and
   * the P2WSH scriptPubKey.  The Writz backend co-signs the Bitcoin
   * release to the caller at a 10% discount (liquidation bonus in BTC).
   * - If the caller is the designated keepe
   */
  liquidate: ({keeper, txid}: {keeper: string, txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time contract initialization.  Can only be called once.
   * 
   * # Parameters
   * - `admin`          - Address that can update the keeper.
   * - `spv_contract`   - Deployed `bitcoin-spv` Soroban contract address.
   * - `usdc_token`     - USDC Stellar Asset Contract address.
   * - `oracle`         - SEP-40 BTC/USD oracle address (RedStone).
   * - `keeper`         - Trusted liquidation keeper (Phase 1).
   * - `relayer`        - Auto-cosign relayer watcher address.
   */
  initialize: ({admin, spv_contract, usdc_token, oracle, keeper, relayer}: {admin: string, spv_contract: string, usdc_token: string, oracle: string, keeper: string, relayer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_keeper transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the keeper address.  Admin only.
   */
  set_keeper: ({caller, new_keeper}: {caller: string, new_keeper: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Construct and simulate a set_keeper_stale_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates how many seconds of keeper inactivity before liquidation
   * opens to any caller.  Admin only.
   */
  set_keeper_stale_window: ({caller, secs}: {caller: string, secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAATFSZXBheSBzb21lIG9yIGFsbCBvZiB0aGUgVVNEQyBkZWJ0IG9uIGEgcG9zaXRpb24uCgpJZiB0aGUgcmVwYXltZW50IGNvdmVycyB0aGUgZnVsbCBvdXRzdGFuZGluZyBkZWJ0IChhZnRlciBhY2NydWluZwppbnRlcmVzdCksIHRoZSBwb3NpdGlvbiBpcyBtYXJrZWQgYXMgYENsb3NlZGAgYW5kIGEgYHJlcGF5X2Z1bGxgCmV2ZW50IGlzIGVtaXR0ZWQuICBUaGUgV3JpdHogYmFja2VuZCBsaXN0ZW5zIGZvciB0aGlzIGV2ZW50IGFuZApjby1zaWducyB0aGUgQml0Y29pbiByZWxlYXNlIHRyYW5zYWN0aW9uIChzcGVuZGluZyBwYXRoIEEpLgAAAAAAAAVyZXBheQAAAAAAAAMAAAAAAAAAB3JlcGF5ZXIAAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAQNCb3Jyb3cgVVNEQyBhZ2FpbnN0IGFuIGV4aXN0aW5nIEJUQyBkZXBvc2l0LgoKVGhlIHJlc3VsdGluZyBkZWJ0IG11c3Qga2VlcCB0aGUgcG9zaXRpb24ncyBjb2xsYXRlcmFsIHJhdGlvIGF0IG9yIGFib3ZlCmBtaW5fY29sbGF0ZXJhbF9yYXRpb19icGAgKDE1MCUpLiAgSW50ZXJlc3Qgc3RhcnRzIGFjY3J1aW5nIGltbWVkaWF0ZWx5LgoKT25seSB0aGUgZGVwb3NpdG9yIHdobyBjcmVhdGVkIHRoZSBwb3NpdGlvbiBjYW4gYm9ycm93IGFnYWluc3QgaXQuAAAAAAZib3Jyb3cAAAAAAAMAAAAAAAAACGJvcnJvd2VyAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAABABSZWdpc3RlciBhIEJUQyBkZXBvc2l0IGJ5IHN1Ym1pdHRpbmcgYW4gU1BWIHByb29mLgoKVGhlIGNvbnRyYWN0OgoxLiBDYWxscyB0aGUgYGJpdGNvaW4tc3B2YCBjb250cmFjdCB0byB2ZXJpZnkgdGhlIHRyYW5zYWN0aW9uIGluY2x1c2lvbi4KMi4gUGFyc2VzIHRoZSByYXcgdHJhbnNhY3Rpb24gb24tY2hhaW4gdG8gZmluZCB0aGUgUDJXU0ggb3V0cHV0IG1hdGNoaW5nCmBwMndzaF9zY3JpcHRfcHVia2V5YCBhbmQgcmVhZCB0aGUgZGVwb3NpdGVkIHNhdG9zaGkgYW1vdW50LgozLiBDcmVhdGVzIGEgYFBvc2l0aW9uYCBlbnRyeSBpbiBwZXJzaXN0ZW50IHN0b3JhZ2UuCgpBZnRlciB0aGlzIGNhbGwgc3VjY2VlZHMgdGhlIHVzZXIgY2FuIGJvcnJvdyBVU0RDIGFnYWluc3QgdGhlIHBvc2l0aW9uLgoKIyBQYXJhbWV0ZXJzCi0gYGRlcG9zaXRvcmAgICAgICAgICAg4oCUIFN0ZWxsYXIgYWRkcmVzcyBvZiB0aGUgZGVwb3NpdG9yIChtdXN0IGF1dGhvcml6ZSkuCi0gYGhlYWRlcnNgICAgICAgICAgICAg4oCUIEJpdGNvaW4gYmxvY2sgaGVhZGVycyAoODAgYnl0ZXMgZWFjaCkuCi0gYG1lcmtsZV9wcm9vZmAgICAgICAg4oCUIFNpYmxpbmcgaGFzaGVzIGZvciB0aGUgTWVya2xlIGluY2x1c2lvbiBwcm9vZi4KLSBgdHhfaW5kZXhgICAgICAgICAgICDigJQgMC1iYXNlZCBpbmRleCBvZiB0aGUgdHJhbnNhY3Rpb24gaW4gaXRzIGJsb2NrLgotIGByYXdfdHhgICAgICAgICAgICAgIOKAlCBOb24td2l0bmVzcyBzZXJpYWxpemF0aW9uIG9mIHRoZSBCaXRjb2luIHRyYW5zYWN0aW9uLgotIGBwMndzaF9zY3JpcHRfcHVia2V5YOKAlCAzNC1ieXRlIFAyV1NIIHNjcmlwdFB1YktleSAoT1BfMCArIDMyLWJ5dGUgaGFzaCkKb2YgdGhlIGRlcG9zaXQgb3V0cHV0LgotIGB0aW1lbG9ja19oZWlnaHRgICAgIOKAlCBCaXRjb2luIGJsb2NrIGhlaWdodCBvZiB0aGUgQ0xUViBlc2NhcGUgaGF0Y2guCi0gYHVzZXJfcHVia2V5YCAgICAgICAg4oCUIERlcG9zaXRvcidzIDMzLWJ5dGUgY29tcHJlc3NlZCBCaXRjb2luAAAAB2RlcG9zaXQAAAAACAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAHaGVhZGVycwAAAAPqAAAD7gAAAFAAAAAAAAAADG1lcmtsZV9wcm9vZgAAA+oAAAPuAAAAIAAAAAAAAAAIdHhfaW5kZXgAAAAEAAAAAAAAAAZyYXdfdHgAAAAAAA4AAAAAAAAAE3Ayd3NoX3NjcmlwdF9wdWJrZXkAAAAADgAAAAAAAAAPdGltZWxvY2tfaGVpZ2h0AAAAAAQAAAAAAAAAC3VzZXJfcHVia2V5AAAAA+4AAAAhAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAABABMaXF1aWRhdGUgYW4gdW5kZXJjb2xsYXRlcmFsaXplZCBwb3NpdGlvbi4KClBoYXNlIDE6IG9ubHkgdGhlIGF1dGhvcml6ZWQgYGtlZXBlcmAgbWF5IGNhbGwgdGhpcyDigJQgKnVubGVzcyogdGhlCmtlZXBlciBoYXMgZ29uZSBzdGFsZSAobm8gc3VjY2Vzc2Z1bCBsaXF1aWRhdGlvbiBvciBleHBsaWNpdApga2VlcGVyX2hlYXJ0YmVhdGAgaW4gYGNvbmZpZy5rZWVwZXJfc3RhbGVfYWZ0ZXJfc2Vjc2AsIGRlZmF1bHQgMjRoKSwKaW4gd2hpY2ggY2FzZSBhbnkgY2FsbGVyIHdpdGggYSBnZW51aW5lbHkgdW5kZXJjb2xsYXRlcmFsaXplZApwb3NpdGlvbiBtYXkgbGlxdWlkYXRlIGl0IChJU1NVRS0wMTApLiBUaGlzIGlzIGEgbGl2ZW5lc3MvY2Vuc29yc2hpcApmYWxsYmFjaywgbm90IGEgcHJpdmFjeSBtZWNoYW5pc20g4oCUIGBwcml2YXRlLWxlbmRgIHBvc2l0aW9ucyBhcmUKYWxyZWFkeSBwbGFpbnRleHQuIFNhZmV0eSBpcyB1bmFmZmVjdGVkIGJ5IHdobyBjYWxsczogdGhlCnVuZGVyY29sbGF0ZXJhbGl6YXRpb24gY2hlY2sgYmVsb3cgaXMgaW5kZXBlbmRlbnQgb2YgY2FsbGVyIGlkZW50aXR5LgoKVGhlIGNhbGxlciBtdXN0IGhhdmUgcHJlLWFwcHJvdmVkIGEgVVNEQyB0cmFuc2ZlciBvZiBhdCBsZWFzdApgcG9zLnVzZGNfZGVidGAgKGFmdGVyIGFjY3J1YWwpIHRvIHRoaXMgY29udHJhY3QuCgpPbiBzdWNjZXNzOgotIFRoZSBjYWxsZXIncyBVU0RDIGNvdmVycyB0aGUgb3V0c3RhbmRpbmcgZGVidC4KLSBUaGUgcG9zaXRpb24gaXMgbWFya2VkIGBMaXF1aWRhdGVkYC4KLSBBIGBsaXF1aWRhdGVgIGV2ZW50IGlzIGVtaXR0ZWQgY29udGFpbmluZyB0aGUgY2FsbGVyJ3MgYWRkcmVzcyBhbmQKdGhlIFAyV1NIIHNjcmlwdFB1YktleS4gIFRoZSBXcml0eiBiYWNrZW5kIGNvLXNpZ25zIHRoZSBCaXRjb2luCnJlbGVhc2UgdG8gdGhlIGNhbGxlciBhdCBhIDEwJSBkaXNjb3VudCAobGlxdWlkYXRpb24gYm9udXMgaW4gQlRDKS4KLSBJZiB0aGUgY2FsbGVyIGlzIHRoZSBkZXNpZ25hdGVkIGtlZXBlAAAACWxpcXVpZGF0ZQAAAAAAAAIAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAc5PbmUtdGltZSBjb250cmFjdCBpbml0aWFsaXphdGlvbi4gIENhbiBvbmx5IGJlIGNhbGxlZCBvbmNlLgoKIyBQYXJhbWV0ZXJzCi0gYGFkbWluYCAgICAgICAgICDigJQgQWRkcmVzcyB0aGF0IGNhbiB1cGRhdGUgdGhlIGtlZXBlci4KLSBgc3B2X2NvbnRyYWN0YCAgIOKAlCBEZXBsb3llZCBgYml0Y29pbi1zcHZgIFNvcm9iYW4gY29udHJhY3QgYWRkcmVzcy4KLSBgdXNkY190b2tlbmAgICAgIOKAlCBVU0RDIFN0ZWxsYXIgQXNzZXQgQ29udHJhY3QgYWRkcmVzcy4KLSBgb3JhY2xlYCAgICAgICAgIOKAlCBTRVAtNDAgQlRDL1VTRCBvcmFjbGUgYWRkcmVzcyAoUmVkU3RvbmUpLgotIGBrZWVwZXJgICAgICAgICAg4oCUIFRydXN0ZWQgbGlxdWlkYXRpb24ga2VlcGVyIChQaGFzZSAxKS4KLSBgcmVsYXllcmAgICAgICAgIOKAlCBBdXRvLWNvc2lnbiByZWxheWVyIHdhdGNoZXIgYWRkcmVzcyAoSVNTVUUtMDA5KS4AAAAAAAppbml0aWFsaXplAAAAAAAGAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADHNwdl9jb250cmFjdAAAABMAAAAAAAAACnVzZGNfdG9rZW4AAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAdyZWxheWVyAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAACdVcGRhdGUgdGhlIGtlZXBlciBhZGRyZXNzLiAgQWRtaW4gb25seS4AAAAACnNldF9rZWVwZXIAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAKbmV3X2tlZXBlcgAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAAAGJVcGRhdGVzIHRoZSByZWxheWVyIGFkZHJlc3MgYXV0aG9yaXplZCB0byBjYWxsIGBwdWJsaXNoX3JlbGVhc2VfcHNidGAuCkFkbWluIG9ubHkuICBTZWUgSVNTVUUtMDA5LgAAAAAAC3NldF9yZWxheWVyAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAALbmV3X3JlbGF5ZXIAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAAAIJMZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbCwgbWFraW5nIGl0IGF2YWlsYWJsZSBmb3IgYm9ycm93aW5nLgpMZW5kZXJzIGVhcm4gYHN1cHBseV9yYXRlX2JwKClgIEFQUiBvbiB0aGVpciBzdXBwbGllZCBhbW91bnQuAAAAAAALc3VwcGx5X3VzZGMAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAADtSZXR1cm5zIHRoZSBwb3NpdGlvbiBmb3IgdGhlIGdpdmVuIEJpdGNvaW4gdHhpZCwgb3IgYE5vbmVgLgAAAAAMZ2V0X3Bvc2l0aW9uAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+gAAAfQAAAACFBvc2l0aW9u",
        "AAAAAAAAADhMZW5kZXIgd2l0aGRyYXdzIHByZXZpb3VzbHkgc3VwcGxpZWQgVVNEQyBmcm9tIHRoZSBwb29sLgAAAA93aXRoZHJhd19zdXBwbHkAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAAKVSZXR1cm5zIHRoZSByZWxheWVyLXB1Ymxpc2hlZCByZWxlYXNlIFBTQlQgZm9yIGEgcG9zaXRpb24sIG9yIGBOb25lYAppZiB0aGUgcmVsYXllciBoYXNuJ3QgcHVibGlzaGVkIG9uZSB5ZXQgKG9yIHRoZSBwb3NpdGlvbiB3YXMgbmV2ZXIKZnVsbHkgcmVwYWlkKS4gU2VlIElTU1VFLTAwOS4AAAAAAAAQZ2V0X3JlbGVhc2VfcHNidAAAAAEAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAPoAAAADg==",
        "AAAAAAAAAQtFeHBsaWNpdCBsaXZlbmVzcyBzaWduYWwgZnJvbSB0aGUgZGVzaWduYXRlZCBrZWVwZXIgKElTU1VFLTAxMCkuCgpMZXRzIHRoZSBrZWVwZXIgcmVzZXQgdGhlIHN0YWxlLXdpbmRvdyBjbG9jayBldmVuIHdoZW4gdGhlcmUgaXMKbm90aGluZyB0byBsaXF1aWRhdGUgcmlnaHQgbm93IChgbGlxdWlkYXRlYCBpdHNlbGYgYWxzbyByZWZyZXNoZXMKdGhpcyBvbiBldmVyeSBzdWNjZXNzZnVsIGNhbGwg4oCUIHRoaXMgZW50cnlwb2ludCBjb3ZlcnMgaWRsZSBwZXJpb2RzKS4AAAAAEGtlZXBlcl9oZWFydGJlYXQAAAABAAAAAAAAAAZrZWVwZXIAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAEFByaXZhdGVMZW5kRXJyb3I=",
        "AAAAAAAAADtDdXJyZW50IGFubnVhbCBib3Jyb3cgcmF0ZSBpbiBiYXNpcyBwb2ludHMgKGUuZy4gODAwID0gOCUpLgAAAAASZ2V0X2JvcnJvd19yYXRlX2JwAAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAADBSZXR1cm5zIGEgc25hcHNob3Qgb2YgdGhlIGdsb2JhbCBwcm90b2NvbCBzdGF0ZS4AAAASZ2V0X3Byb3RvY29sX3N0YXRlAAAAAAAAAAAAAQAAB9AAAAANUHJvdG9jb2xTdGF0ZQAAAA==",
        "AAAAAAAAADpSZXR1cm5zIHRoZSBVU0RDIHN1cHBseSBiYWxhbmNlIChpbiBzdHJvb3BzKSBmb3IgYSBsZW5kZXIuAAAAAAASZ2V0X3N1cHBseV9iYWxhbmNlAAAAAAABAAAAAAAAAAZsZW5kZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAACtDdXJyZW50IGFubnVhbCBzdXBwbHkgcmF0ZSBpbiBiYXNpcyBwb2ludHMuAAAAABJnZXRfc3VwcGx5X3JhdGVfYnAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAJ9SZXR1cm5zIHRoZSBoZWFsdGggcmF0aW8gKGluIGJhc2lzIHBvaW50cykgZm9yIGEgcG9zaXRpb24uCgoxNV8wMDAgPSAxNTAlIChoZWFsdGh5KSwgMTJfMDAwID0gMTIwJSAobGlxdWlkYXRpb24gdGhyZXNob2xkKSwKYGkxMjg6Ok1BWGAgPSBwb3NpdGlvbiBoYXMgbm8gZGVidC4AAAAAE2dldF9oZWFsdGhfcmF0aW9fYnAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+kAAAALAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAZJQdWJsaXNoZXMgYSBjby1zaWduZWQgUGF0aCBBIHJlbGVhc2UgUFNCVCBmb3IgYSByZXBhaWQgcG9zaXRpb24uCgpDYWxsZWQgYnkgdGhlIHJlbGF5ZXIgd2F0Y2hlciBpbW1lZGlhdGVseSBhZnRlciBpdCBkZXRlY3RzIGEKYFJlcGF5RnVsbEV2ZW50YCwgYnVpbGRzIHRoZSByZWxlYXNlIHRyYW5zYWN0aW9uLCBhbmQgY28tc2lnbnMgaXQg4oCUCnNlZSBgZG9jcy9zZWN1cml0eS9rbm93bi1pc3N1ZXMubWRgIElTU1VFLTAwOS4gU3RvcmluZyB0aGUgUFNCVApvbi1jaGFpbiAocmF0aGVyIHRoYW4gZS5nLiBJUEZTKSBtZWFucyB0aGUgdXNlciBjYW4gcmV0cmlldmUgYW5kCmJyb2FkY2FzdCBpdCBldmVuIGlmIHRoZSBlbnRpcmUgV3JpdHogb2ZmLWNoYWluIHN0YWNrIGlzIGRvd24uClJlbGF5ZXIgb25seS4AAAAAABRwdWJsaXNoX3JlbGVhc2VfcHNidAAAAAMAAAAAAAAAB3JlbGF5ZXIAAAAAEwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAARwc2J0AAAADgAAAAEAAAPpAAAAAgAAB9AAAAAQUHJpdmF0ZUxlbmRFcnJvcg==",
        "AAAAAAAAAWNFeHRlbmQgdGhlIFRUTCBvZiBhIHBvc2l0aW9uIGVudHJ5IHRvIGFub3RoZXIgMTgwLWRheSB3aW5kb3cuCgpJZiBhIHBvc2l0aW9uIGV4cGlyZXMsIHRoZSBkZXBvc2l0b3IgbG9zZXMgYWNjZXNzIHRvIHRoZWlyIHJlY29yZCBhbmQKdGhlIGR1cGxpY2F0ZS1kZXBvc2l0IGd1YXJkIGFsc28gZXhwaXJlcyAocmUtZGVwb3NpdCBhdHRhY2sgcmlzaykuCktlZXBlcnMgb3IgYm9ycm93ZXJzIHNob3VsZCBjYWxsIHRoaXMgYmVmb3JlIGFueSBwb3NpdGlvbiBhcHByb2FjaGVzCnRoZSBlbmQgb2YgaXRzIDE4MC1kYXkgd2luZG93LgpSZXR1cm5zIGZhbHNlIGlmIG5vIHBvc2l0aW9uIGV4aXN0cyBmb3IgdGhlIGdpdmVuIHR4aWQuAAAAABRyZWZyZXNoX3Bvc2l0aW9uX3R0bAAAAAEAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAADdFeHRlbmQgdGhlIFRUTCBvZiB0aGUgZ2xvYmFsIHByb3RvY29sIGFjY291bnRpbmcgZW50cnkuAAAAABRyZWZyZXNoX3Byb3RvY29sX3R0bAAAAAAAAAAA",
        "AAAAAAAAAHJVcGRhdGVzIGhvdyBtYW55IHNlY29uZHMgb2Yga2VlcGVyIGluYWN0aXZpdHkgYmVmb3JlIGxpcXVpZGF0aW9uCm9wZW5zIHRvIGFueSBjYWxsZXIuICBBZG1pbiBvbmx5LiAgU2VlIElTU1VFLTAxMC4AAAAAABdzZXRfa2VlcGVyX3N0YWxlX3dpbmRvdwAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABHNlY3MAAAAGAAAAAQAAA+kAAAACAAAH0AAAABBQcml2YXRlTGVuZEVycm9y",
        "AAAAAAAAAQZFeHRlbmQgdGhlIFRUTCBvZiBhIGxlbmRlcidzIHN1cHBseSBiYWxhbmNlIGVudHJ5IHRvIGFub3RoZXIgMTgwLWRheSB3aW5kb3cuCgpMZW5kZXJzIHdobyBzdXBwbGllZCBVU0RDIGFuZCBkbyBub3QgaW50ZXJhY3QgZm9yIGFuIGV4dGVuZGVkIHBlcmlvZCByaXNrCmhhdmluZyB0aGVpciBiYWxhbmNlIGVudHJ5IGV4cGlyZSwgcHJldmVudGluZyB3aXRoZHJhd2FsLgpSZXR1cm5zIGZhbHNlIGlmIHRoZSBsZW5kZXIgaGFzIG5vIHJlY29yZGVkIGJhbGFuY2UuAAAAAAAacmVmcmVzaF9zdXBwbHlfYmFsYW5jZV90dGwAAAAAAAEAAAAAAAAABmxlbmRlcgAAAAAAEwAAAAEAAAAB",
        "AAAABAAAAAAAAAAAAAAAEFByaXZhdGVMZW5kRXJyb3IAAAAQAAAAJkNvbnRyYWN0IGhhcyBhbHJlYWR5IGJlZW4gaW5pdGlhbGl6ZWQuAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAJkNvbnRyYWN0IGhhcyBub3QgYmVlbiBpbml0aWFsaXplZCB5ZXQuAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAYQ2FsbGVyIGlzIG5vdCB0aGUgYWRtaW4uAAAADFVuYXV0aG9yaXplZAAAAAMAAAA9VGhlIFNQViB2ZXJpZmljYXRpb24gY2FsbCB0byB0aGUgYml0Y29pbi1zcHYgY29udHJhY3QgZmFpbGVkLgAAAAAAABVTcHZWZXJpZmljYXRpb25GYWlsZWQAAAAAAAAEAAAAUE5vIFAyV1NIIG91dHB1dCBtYXRjaGluZyB0aGUgcHJvdmlkZWQgc2NyaXB0UHViS2V5IHdhcyBmb3VuZCBpbiB0aGUgdHJhbnNhY3Rpb24uAAAADk91dHB1dE5vdEZvdW5kAAAAAAAFAAAANVRoZSBCVEMgZGVwb3NpdCBpcyBiZWxvdyB0aGUgbWluaW11bSByZXF1aXJlZCBhbW91bnQuAAAAAAAAD0RlcG9zaXRUb29TbWFsbAAAAAAGAAAAMEEgcG9zaXRpb24gYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgQml0Y29pbiB0eGlkLgAAABVQb3NpdGlvbkFscmVhZHlFeGlzdHMAAAAAAAAHAAAALU5vIHBvc2l0aW9uIGZvdW5kIGZvciB0aGUgZ2l2ZW4gQml0Y29pbiB0eGlkLgAAAAAAABBQb3NpdGlvbk5vdEZvdW5kAAAACAAAAERUaGUgcG9zaXRpb24gaXMgbm90IGluIEFjdGl2ZSBzdGF0dXMgKGFscmVhZHkgY2xvc2VkIG9yIGxpcXVpZGF0ZWQpLgAAABFQb3NpdGlvbk5vdEFjdGl2ZQAAAAAAAAkAAAA/VGhlIGJvcnJvdyBhbW91bnQgd291bGQgZXhjZWVkIHRoZSBtYXhpbXVtIGxvYW4tdG8tdmFsdWUgcmF0aW8uAAAAABZFeGNlZWRzQ29sbGF0ZXJhbFJhdGlvAAAAAAAKAAAAJk5vdCBlbm91Z2ggVVNEQyBsaXF1aWRpdHkgaW4gdGhlIHBvb2wuAAAAAAAVSW5zdWZmaWNpZW50TGlxdWlkaXR5AAAAAAAACwAAAC5SZXBheW1lbnQgYW1vdW50IGV4Y2VlZHMgdGhlIG91dHN0YW5kaW5nIGRlYnQuAAAAAAAQUmVwYXlFeGNlZWRzRGVidAAAAAwAAAA3V2l0aGRyYXdhbCB3b3VsZCByZWR1Y2UgcG9vbCBiZWxvdyB0aGUgYm9ycm93ZWQgYW1vdW50LgAAAAASSW5zdWZmaWNpZW50U3VwcGx5AAAAAAANAAAANVRoZSBwb3NpdGlvbiBpcyBoZWFsdGh5IGFuZCBjYW5ub3QgYmUgbGlxdWlkYXRlZCB5ZXQuAAAAAAAAD1Bvc2l0aW9uSGVhbHRoeQAAAAAOAAAALkFuIGludGVnZXIgb3ZlcmZsb3cgb3IgdW5kZXJmbG93IHdhcyBkZXRlY3RlZC4AAAAAAAhPdmVyZmxvdwAAAA8AAABEVGhlIHByb3ZpZGVkIHNjcmlwdFB1YktleSBpcyBub3QgYSB2YWxpZCAzNC1ieXRlIFAyV1NIIHNjcmlwdFB1YktleS4AAAATSW52YWxpZFNjcmlwdFB1YktleQAAAAAQ",
        "AAAAAQAAAG5JbW11dGFibGUgcHJvdG9jb2wgY29uZmlndXJhdGlvbiBzZXQgYXQgaW5pdGlhbGl6YXRpb24uCgpTdG9yZWQgdW5kZXIgYERhdGFLZXk6OkNvbmZpZ2AgaW4gcGVyc2lzdGVudCBzdG9yYWdlLgAAAAAAAAAAAAZDb25maWcAAAAAAAwAAAAwQWRtaW4gYWRkcmVzcyDigJQgY2FuIHVwZGF0ZSB0aGUga2VlcGVyIGFkZHJlc3MuAAAABWFkbWluAAAAAAAAEwAAADBUcnVzdGVkIGtlZXBlciBhZGRyZXNzIGZvciBQaGFzZSAxIGxpcXVpZGF0aW9ucy4AAAAGa2VlcGVyAAAAAAATAAABDFNlY29uZHMgb2Yga2VlcGVyIGluYWN0aXZpdHkgYWZ0ZXIgd2hpY2ggbGlxdWlkYXRpb24gb3BlbnMgdG8gYW55CmNhbGxlciwgbm90IGp1c3QgYGtlZXBlcmAgKGRlZmF1bHQ6IDg2XzQwMCA9IDI0aCkuIFNlZSBJU1NVRS0wMTAgaW4KYGRvY3Mvc2VjdXJpdHkva25vd24taXNzdWVzLm1kYCDigJQgdGhpcyBpcyBhIGxpdmVuZXNzL2NlbnNvcnNoaXAKZmFsbGJhY2ssIG5vdCBhIHByaXZhY3kgbWVjaGFuaXNtICh0aGlzIGNvbnRyYWN0IGhhcyBubyBaSyBwcml2YWN5KS4AAAAXa2VlcGVyX3N0YWxlX2FmdGVyX3NlY3MAAAAABgAAAEdCb251cyB0aGUgbGlxdWlkYXRvciBlYXJucyBleHByZXNzZWQgYXMgYWRkaXRpb25hbCBCVEMgJSAoMV8wMDAgPSAxMCUpLgAAAAAUbGlxdWlkYXRpb25fYm9udXNfYnAAAAAEAAAARkhlYWx0aCByYXRpbyBiZWxvdyB3aGljaCBhIHBvc2l0aW9uIGNhbiBiZSBsaXF1aWRhdGVkICgxMl8wMDAgPSAxMjAlKS4AAAAAABhsaXF1aWRhdGlvbl90aHJlc2hvbGRfYnAAAAAEAAAAOU1pbmltdW0gY29sbGF0ZXJhbCByYXRpbyBpbiBiYXNpcyBwb2ludHMgKDE1XzAwMCA9IDE1MCUpLgAAAAAAABdtaW5fY29sbGF0ZXJhbF9yYXRpb19icAAAAAAEAAAASU1pbmltdW0gU1BWIGNvbmZpcm1hdGlvbiBkZXB0aCBiZWZvcmUgYSBkZXBvc2l0IGlzIGFjY2VwdGVkIChkZWZhdWx0OiA2KS4AAAAAAAARbWluX2NvbmZpcm1hdGlvbnMAAAAAAAAEAAAAP01pbmltdW0gQlRDIGRlcG9zaXQgaW4gc2F0b3NoaXMgKGRlZmF1bHQ6IDEwMF8wMDAgPSAwLjAwMSBCVEMpLgAAAAAUbWluX2RlcG9zaXRfc2F0b3NoaXMAAAAGAAAAPkFkZHJlc3Mgb2YgdGhlIFNFUC00MCBCVEMvVVNEIHByaWNlIG9yYWNsZSAoUmVkU3RvbmUgcHJpbWFyeSkuAAAAAAAGb3JhY2xlAAAAAAATAAAAfEFkZHJlc3MgYXV0aG9yaXplZCB0byBwdWJsaXNoIGEgY28tc2lnbmVkIHJlbGVhc2UgUFNCVCB2aWEKYHB1Ymxpc2hfcmVsZWFzZV9wc2J0YCAoSVNTVUUtMDA5J3MgYXV0by1jb3NpZ24gcmVsYXllciB3YXRjaGVyKS4AAAAHcmVsYXllcgAAAAATAAAAN0FkZHJlc3Mgb2YgdGhlIGRlcGxveWVkIGBiaXRjb2luLXNwdmAgU29yb2JhbiBjb250cmFjdC4AAAAADHNwdl9jb250cmFjdAAAABMAAAA7QWRkcmVzcyBvZiB0aGUgVVNEQyBTdGVsbGFyIEFzc2V0IENvbnRyYWN0IG9uIHRoaXMgbmV0d29yay4AAAAACnVzZGNfdG9rZW4AAAAAABM=",
        "AAAAAQAAAOFBIHNpbmdsZSBCVEMtY29sbGF0ZXJhbGl6ZWQgbGVuZGluZyBwb3NpdGlvbi4KClN0b3JlZCBpbiBwZXItZW50cnkgcGVyc2lzdGVudCBzdG9yYWdlIGtleWVkIGJ5IEJpdGNvaW4gdHhpZC4KTmV2ZXIgc3RvcmVkIGluIGEgZ3Jvd2luZyBjb2xsZWN0aW9uIG9uIHRoZSBpbnN0YW5jZSDigJQgc2VlIENlcnRpSyB3YXJuaW5nCmFib3V0IHVuYm91bmRlZCBpbnN0YW5jZSBzdG9yYWdlIGdyb3d0aC4AAAAAAAAAAAAACFBvc2l0aW9uAAAACQAAAEZTYXRvc2hpcyBsb2NrZWQgaW4gdGhlIFAyV1NIIG91dHB1dCDigJQgdmVyaWZpZWQgb24tY2hhaW4gZnJvbSByYXdfdHguAAAAAAAMYnRjX3NhdG9zaGlzAAAABgAAAEVCaXRjb2luIHRyYW5zYWN0aW9uIElEICgzMiBieXRlcywgaW50ZXJuYWwvbGl0dGxlLWVuZGlhbiBieXRlIG9yZGVyKS4AAAAAAAAIYnRjX3R4aWQAAAPuAAAAIAAAAENUaGUgZGVwb3NpdG9yJ3MgU3RlbGxhciBhZGRyZXNzIChtdXN0IHJlcGF5IHRvIGNsb3NlIHRoZSBwb3NpdGlvbikuAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAPFN0ZWxsYXIgbGVkZ2VyIHNlcXVlbmNlIG51bWJlciBhdCB0aGUgbGFzdCBpbnRlcmVzdCBhY2NydWFsLgAAABJsYXN0X3VwZGF0ZV9sZWRnZXIAAAAAAAQAAACPVGhlIDM0LWJ5dGUgUDJXU0ggc2NyaXB0UHViS2V5IChPUF8wICsgMzItYnl0ZSBzY3JpcHQgaGFzaCkgb2YgdGhpcyBkZXBvc2l0LgpVc2VkIGJ5IHRoZSBiYWNrZW5kIHRvIGlkZW50aWZ5IHdoaWNoIFVUWE8gdG8gY28tc2lnbiBmb3IgcmVsZWFzZS4AAAAAE3Ayd3NoX3NjcmlwdF9wdWJrZXkAAAAADgAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADlBvc2l0aW9uU3RhdHVzAAAAAABCQWJzb2x1dGUgQml0Y29pbiBibG9jayBoZWlnaHQgZm9yIHRoZSBDTFRWIGVtZXJnZW5jeSBlc2NhcGUgaGF0Y2guAAAAAAAPdGltZWxvY2tfaGVpZ2h0AAAAAAQAAABhT3V0c3RhbmRpbmcgVVNEQyBkZWJ0IGluIHN0cm9vcHMgKDEgVVNEQyA9IDEwXzAwMF8wMDAgc3Ryb29wcykuCkdyb3dzIHdpdGggZWFjaCBpbnRlcmVzdCBhY2NydWFsLgAAAAAAAAl1c2RjX2RlYnQAAAAAAAALAAABsFRoZSBkZXBvc2l0b3IncyAzMy1ieXRlIGNvbXByZXNzZWQgQml0Y29pbiBwdWJsaWMga2V5IChJU1NVRS0wMDkpLgpBbHJlYWR5IHB1YmxpYyBpbmZvcm1hdGlvbiDigJQgaXQncyByZXZlYWxlZCB0aGUgbW9tZW50IGVpdGhlcgpzcGVuZGluZyBwYXRoIGlzIHVzZWQg4oCUIHNvIHN0b3JpbmcgaXQgcGxhaW50ZXh0IGlzIG5vdCBhIG5ldyBwcml2YWN5CmxlYWsuIExldHMgdGhlIGF1dG8tY29zaWduIHJlbGF5ZXIgd2F0Y2hlciByZWNvbnN0cnVjdCB0aGUgcmVkZWVtCnNjcmlwdCBhbmQgdGhlIHVzZXIncyBkZWZhdWx0IHJldHVybiBhZGRyZXNzIChhIFAyV1BLSCBhZGRyZXNzCmRlcml2ZWQgZnJvbSB0aGlzIGtleSkgZnJvbSBvbi1jaGFpbiBzdGF0ZSBhbG9uZSwgd2l0aG91dCBhIHNlcGFyYXRlCm9mZi1jaGFpbiAicmV0dXJuIGFkZHJlc3MiIHN0b3JlLgAAAAt1c2VyX3B1YmtleQAAAAPuAAAAIQ==",
        "AAAAAQAAAM9SZXR1cm4gdHlwZSBvZiB0aGUgY3Jvc3MtY29udHJhY3QgU1BWIHZlcmlmaWNhdGlvbiBjYWxsLgoKTXVzdCBtYXRjaCB0aGUgYFZlcmlmaWNhdGlvblJlc3VsdGAgY29udHJhY3R0eXBlIGluIHRoZSBgYml0Y29pbi1zcHZgIGNvbnRyYWN0CmZpZWxkLWZvci1maWVsZCBzbyB0aGF0IFNvcm9iYW4ncyBWYWwgZW5jb2RpbmcgZGVzZXJpYWxpemVzIGNvcnJlY3RseS4AAAAAAAAAAAlTcHZSZXN1bHQAAAAAAAADAAAAAAAAAApibG9ja19oYXNoAAAAAAPuAAAAIAAAAAAAAAANY29uZmlybWF0aW9ucwAAAAAAAAQAAAAAAAAABHR4aWQAAAPuAAAAIA==",
        "AAAAAQAAAFBHbG9iYWwgcHJvdG9jb2wgYWNjb3VudGluZy4KCkEgc2luZ2xlIGluc3RhbmNlIHN0b3JlZCB1bmRlciBgRGF0YUtleTo6UHJvdG9jb2xgLgAAAAAAAAANUHJvdG9jb2xTdGF0ZQAAAAAAAAMAAAE3TGVkZ2VyIHRpbWVzdGFtcCBvZiB0aGUgbW9zdCByZWNlbnQgc3VjY2Vzc2Z1bCBsaXF1aWRhdGlvbiBieSB0aGUKZGVzaWduYXRlZCBgY29uZmlnLmtlZXBlcmAgKElTU1VFLTAxMCkuIFVzZWQgdG8gZGV0ZWN0IGEgc3RhbGUvYWJzZW50CmtlZXBlciBhbmQgb3BlbiBsaXF1aWRhdGlvbiB0byBhbnkgY2FsbGVyIHdpdGggYSB2YWxpZAp1bmRlcmNvbGxhdGVyYWxpemF0aW9uIGNoZWNrIGFmdGVyIGBjb25maWcua2VlcGVyX3N0YWxlX2FmdGVyX3NlY3NgLgpFeHBsaWNpdCBga2VlcGVyX2hlYXJ0YmVhdGAgY2FsbHMgYWxzbyB1cGRhdGUgdGhpcy4AAAAAFWxhc3Rfa2VlcGVyX2hlYXJ0YmVhdAAAAAAAAAYAAAB/VG90YWwgb3V0c3RhbmRpbmcgVVNEQyBkZWJ0IGFjcm9zcyBhbGwgYWN0aXZlIHBvc2l0aW9ucyAoaW4gc3Ryb29wcykuClVwZGF0ZWQgb24gZXZlcnkgYm9ycm93LCByZXBheSwgYWNjcnVhbCwgYW5kIGxpcXVpZGF0aW9uLgAAAAAOdG90YWxfYm9ycm93ZWQAAAAAAAsAAACeVG90YWwgVVNEQyBzdXBwbGllZCBieSBsZW5kZXJzIChpbiBzdHJvb3BzKS4gRG9lcyBub3QgZGVjcmVhc2Ugd2hlbgppbnRlcmVzdCBhY2NydWVzIOKAlCBpbnRlcmVzdCBlYXJuZWQgaW5jcmVhc2VzIHRoZSBlZmZlY3RpdmUgdmFsdWUgb2YKZWFjaCBsZW5kZXIncyBzaGFyZS4AAAAAAA50b3RhbF9zdXBwbGllZAAAAAAACw==",
        "AAAAAgAAABpQb3NpdGlvbiBsaWZlY3ljbGUgc3RhdGVzLgAAAAAAAAAAAA5Qb3NpdGlvblN0YXR1cwAAAAAAAwAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAEpMb2FuIGZ1bGx5IHJlcGFpZDsgcHJvdG9jb2wgY28tc2lnbmF0dXJlIGZvciBCVEMgcmVsZWFzZSBoYXMgYmVlbiBlbWl0dGVkLgAAAAAABkNsb3NlZAAAAAAAAAAAAD5Qb3NpdGlvbiB3YXMgdW5kZXJjb2xsYXRlcmFsaXplZCBhbmQgbGlxdWlkYXRlZCBieSB0aGUga2VlcGVyLgAAAAAACkxpcXVpZGF0ZWQAAA==",
        "AAAABQAAAEVFbWl0dGVkIHdoZW4gYSBwYXJ0aWFsIHJlcGF5bWVudCByZWR1Y2VzIGJ1dCBkb2VzIG5vdCBjbGVhciB0aGUgZGVidC4AAAAAAAAAAAAAClJlcGF5RXZlbnQAAAAAAAEAAAAFcmVwYXkAAAAAAAACAAAAAAAAAAR0eGlkAAAD7gAAACAAAAABAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAI=",
        "AAAABQAAADpFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciBkcmF3cyBVU0RDIGFnYWluc3QgYSBCVEMgcG9zaXRpb24uAAAAAAAAAAAAC0JvcnJvd0V2ZW50AAAAAAEAAAAGYm9ycm93AAAAAAADAAAAAAAAAAR0eGlkAAAD7gAAACAAAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAI=",
        "AAAABQAAADdFbWl0dGVkIHdoZW4gYSBCVEMgZGVwb3NpdCBpcyByZWdpc3RlcmVkIHZpYSBTUFYgcHJvb2YuAAAAAAAAAAAMRGVwb3NpdEV2ZW50AAAAAQAAAAdkZXBvc2l0AAAAAAMAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAAAAAADGJ0Y19zYXRvc2hpcwAAAAYAAAAAAAAAAAAAAA90aW1lbG9ja19oZWlnaHQAAAAABAAAAAAAAAAC",
        "AAAABQAAAMxFbWl0dGVkIHdoZW4gYSBrZWVwZXIgbGlxdWlkYXRlcyBhbiB1bmRlcmNvbGxhdGVyYWxpemVkIHBvc2l0aW9uLgoKVGhlIFdyaXR6IGJhY2tlbmQgbW9uaXRvcnMgdGhpcyBldmVudCB0byBjby1zaWduIHRoZSBCaXRjb2luIHJlbGVhc2UKdG8gdGhlIGtlZXBlciBhdCBhIGRpc2NvdW50IG9mIGBsaXF1aWRhdGlvbl9ib251c19icCAvIDEwMGAgcGVyY2VudC4AAAAAAAAADkxpcXVpZGF0ZUV2ZW50AAAAAAABAAAACWxpcXVpZGF0ZQAAAAAAAAQAAAAAAAAABHR4aWQAAAPuAAAAIAAAAAEAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAAAAAAE3Ayd3NoX3NjcmlwdF9wdWJrZXkAAAAADgAAAAAAAAAAAAAAFGxpcXVpZGF0aW9uX2JvbnVzX2JwAAAABAAAAAAAAAAC",
        "AAAABQAAALlFbWl0dGVkIHdoZW4gYSByZXBheW1lbnQgZnVsbHkgY2xlYXJzIHRoZSBvdXRzdGFuZGluZyBkZWJ0LgoKVGhlIFdyaXR6IGJhY2tlbmQgbW9uaXRvcnMgdGhpcyBldmVudCB0byBjby1zaWduIHRoZSBCaXRjb2luIHJlbGVhc2UKdHJhbnNhY3Rpb24gKHNwZW5kaW5nIHBhdGggQTogcHJvdG9jb2wga2V5ICsgdXNlciBrZXkpLgAAAAAAAAAAAAAOUmVwYXlGdWxsRXZlbnQAAAAAAAEAAAAKcmVwYXlfZnVsbAAAAAAAAwAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAAAAAAAAHcmVwYXllcgAAAAATAAAAAAAAAAAAAAATcDJ3c2hfc2NyaXB0X3B1YmtleQAAAAAOAAAAAAAAAAI=",
        "AAAAAgAAARdTdG9yYWdlIGtleXMg4oCUIGVhY2ggdmFyaWFudCBtYXBzIHRvIGFuIGlzb2xhdGVkIHBlcnNpc3RlbnQgc3RvcmFnZSBlbnRyeS4KClVzaW5nIHBlci1lbnRyeSBrZXlpbmcgKG5vdCBhIHNpbmdsZSBncm93aW5nIG1hcCkgcHJldmVudHMgdW5ib3VuZGVkCmluc3RhbmNlIHN0b3JhZ2UgZ3Jvd3RoLCB3aGljaCBpcyB0aGUgIzEgU29yb2JhbiB2dWxuZXJhYmlsaXR5IGNsYXNzCmlkZW50aWZpZWQgYnkgdGhlIFN0ZWxsYXIgQXVkaXQgQmFuayAoQ2VydGlLLCBPdHRlclNlYywgWmVsbGljKS4AAAAAAAAAAAdEYXRhS2V5AAAAAAUAAAAAAAAAP1NpbmdsZXRvbjogcHJvdG9jb2wgY29uZmlndXJhdGlvbiAoc2V0IG9uY2UgYXQgaW5pdGlhbGl6YXRpb24pLgAAAAAGQ29uZmlnAAAAAAAAAAAAPlNpbmdsZXRvbjogZ2xvYmFsIGFjY291bnRpbmcgc3RhdGUgKGJvcnJvd2VkL3N1cHBsaWVkIHRvdGFscykuAAAAAAAIUHJvdG9jb2wAAAABAAAAMFBlci1kZXBvc2l0IHBvc2l0aW9uLCBrZXllZCBieSB0aGUgQml0Y29pbiB0eGlkLgAAAAhQb3NpdGlvbgAAAAEAAAPuAAAAIAAAAAEAAAAqUGVyLWxlbmRlciBVU0RDIHN1cHBseSBiYWxhbmNlIGluIHN0cm9vcHMuAAAAAAANU3VwcGx5QmFsYW5jZQAAAAAAAAEAAAATAAAAAQAAANxUaGUgcmVsYXllci1wdWJsaXNoZWQsIGNvLXNpZ25lZCBQYXRoIEEgcmVsZWFzZSBQU0JUIGZvciBhIGZ1bGx5CnJlcGFpZCBwb3NpdGlvbiwga2V5ZWQgYnkgQml0Y29pbiB0eGlkIChJU1NVRS0wMDkpLiBMZXRzIGEgdXNlcgpyZXRyaWV2ZSBhbmQgYnJvYWRjYXN0IHRoZWlyIHJlbGVhc2UgdHJhbnNhY3Rpb24gZXZlbiBpZiB0aGUgV3JpdHoKZnJvbnRlbmQgaXMgdW5hdmFpbGFibGUuAAAAC1JlbGVhc2VQc2J0AAAAAAEAAAPuAAAAIA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    repay: this.txFromJSON<Result<void>>,
        borrow: this.txFromJSON<Result<void>>,
        deposit: this.txFromJSON<Result<Buffer>>,
        liquidate: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        set_keeper: this.txFromJSON<Result<void>>,
        set_relayer: this.txFromJSON<Result<void>>,
        supply_usdc: this.txFromJSON<Result<void>>,
        get_position: this.txFromJSON<Option<Position>>,
        withdraw_supply: this.txFromJSON<Result<void>>,
        get_release_psbt: this.txFromJSON<Option<Buffer>>,
        keeper_heartbeat: this.txFromJSON<Result<void>>,
        get_borrow_rate_bp: this.txFromJSON<i128>,
        get_protocol_state: this.txFromJSON<ProtocolState>,
        get_supply_balance: this.txFromJSON<i128>,
        get_supply_rate_bp: this.txFromJSON<i128>,
        get_health_ratio_bp: this.txFromJSON<Result<i128>>,
        publish_release_psbt: this.txFromJSON<Result<void>>,
        refresh_position_ttl: this.txFromJSON<boolean>,
        refresh_protocol_ttl: this.txFromJSON<null>,
        set_keeper_stale_window: this.txFromJSON<Result<void>>,
        refresh_supply_balance_ttl: this.txFromJSON<boolean>
  }
}