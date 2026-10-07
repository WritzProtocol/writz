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




export const CommitmentTreeError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  /**
   * ZK proof failed on-chain Groth16 verification.
   */
  4: {message:"InvalidZkProof"},
  /**
   * `old_root` in the proof does not match the stored Merkle root.
   */
  5: {message:"RootMismatch"},
  /**
   * This nullifier has already been spent.
   */
  6: {message:"NullifierAlreadySpent"},
  /**
   * A deposit with the same Bitcoin txid already exists.
   */
  7: {message:"DuplicateDeposit"},
  /**
   * The commitment was not registered via `deposit`.
   */
  8: {message:"CommitmentNotFound"},
  /**
   * USDC pool does not have enough available liquidity.
   */
  9: {message:"InsufficientLiquidity"},
  /**
   * `is_borrow` signal doesn't match the function called (borrow vs. repay).
   */
  10: {message:"WrongCircuitMode"},
  /**
   * A public protocol parameter in the proof (min_ratio_bp, threshold, etc.)
   * does not match the value stored in the contract's config.
   */
  11: {message:"ProtocolParamMismatch"},
  /**
   * The BTC/USD price in the proof does not match the oracle's current price.
   */
  12: {message:"PriceMismatch"},
  /**
   * The BTC txid encoded in the ZK proof does not match the SPV-verified txid.
   */
  13: {message:"TxidMismatch"},
  /**
   * A signal value is too large to extract as a Soroban-native integer.
   * Indicates the proof was computed with an out-of-range value.
   */
  14: {message:"SignalOverflow"},
  /**
   * Withdrawal amount exceeds the supplier's own deposited balance.
   */
  15: {message:"WithdrawExceedsBalance"},
  /**
   * The contract is paused - new deposits, borrows, and USDC supply are
   * refused. Existing positions can still repay, withdraw, and liquidate;
   * a pause only blocks new risk-taking.
   */
  16: {message:"Paused"},
  /**
   * `raw_tx` has no output paying the Writz P2WSH derived from the
   * protocol key, the depositor's key and the timelock - this deposit's
   * Bitcoin transaction never locked collateral under the protocol's
   * co-signing key (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6,
   * GHSA-mg4x-cr23-4x3v).
   */
  17: {message:"VaultOutputNotFound"},
  /**
   * The proof's private `collateral_satoshis` (bound in-circuit to the
   * public `actual_satoshis` signal) does not match the amount this
   * contract independently parsed from `raw_tx`.
   */
  18: {message:"CollateralAmountMismatch"},
  /**
   * `signal[RECIPIENT_LO/HI]` (sha256 of the recipient's strkey address)
   * does not match the authenticated `borrower` argument - the proof was
   * generated for a different recipient and cannot be redirected
   * (GHSA-xxqv-6vhx-hhrx, GHSA-mhp9-jmvc-x9mw).
   */
  19: {message:"RecipientMismatch"},
  /**
   * A constructor `protocol_pubkey` or deposit `user_pubkey` is not a
   * compressed secp256k1 key encoding (`02`/`03` prefix).
   */
  20: {message:"InvalidPubkey"},
  /**
   * The deposit's timelock is outside 1,008..=105,000 blocks above the
   * Bitcoin block that confirmed it - an instant or absurdly distant
   * escape hatch.
   */
  21: {message:"InvalidTimelock"}
}


/**
 * Groth16 proof.  Mirrors `zk_verifier::Proof`.
 */
export interface Proof {
  pi_a: G1Point;
  pi_b: G2Point;
  pi_c: G1Point;
}


export interface Config {
  admin: string;
  liquidation_threshold_bp: u32;
  min_collateral_ratio_bp: u32;
  min_confirmations: u32;
  min_deposit_satoshis: u64;
  oracle: string;
  /**
 * When true, `deposit`/`borrow`/`supply_usdc` (new risk-taking actions)
 * are refused. `repay`/`withdraw_supply`/`liquidate` stay open so users
 * can always exit - a pause is an emergency brake on new exposure, not
 * a freeze on existing positions. Admin-gated via `set_paused`. See
 * `docs/architecture/contract-migration-runbook.md`, Track 2.
 */
paused: boolean;
  /**
 * The protocol's 33-byte compressed Bitcoin co-signing key. Every ZK
 * deposit must pay the Writz P2WSH built from this key, the depositor's
 * own key and a bounded timelock - the same script `private-lend`
 * checks, so the depositor keeps a unilateral timelock exit and the
 * protocol can only ever co-sign. Immutable per contract; rotating it
 * means a new deployment (#177).
 */
protocol_pubkey: Buffer;
  spv_contract: string;
  usdc_token: string;
  zk_verifier: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Pool", values: void} | {tag: "MerkleRoot", values: void} | {tag: "SpentNullifier", values: readonly [Buffer]} | {tag: "PendingCommitment", values: readonly [Buffer]} | {tag: "TxCommitment", values: readonly [Buffer]} | {tag: "SupplyBalance", values: readonly [string]};


/**
 * BN254 G1 affine point - 64 bytes (X || Y, big-endian).
 * Mirrors `zk_verifier::G1Point`.
 */
export interface G1Point {
  bytes: Buffer;
}


/**
 * BN254 G2 affine point - 128 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
 * Mirrors `zk_verifier::G2Point`.
 */
export interface G2Point {
  bytes: Buffer;
}


export interface PoolState {
  total_borrowed: i128;
  total_supplied: i128;
}










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
   * Repay USDC debt on a ZK position.
   * 
   * The borrow_repay proof (with `is_borrow = 0`) proves that:
   * * The caller's commitment exists in the tree at `old_root`.
   * * The new commitment correctly reflects the reduced debt.
   * * `new_root` reflects the updated commitment.
   * 
   * The USDC amount collected from the repayer is recovered from the
   * proof's `delta_stroops` signal (encoded as `p − repay_amount`, the
   * BN254 field negation) so the transfer exactly matches the circuit's
   * committed value:
   * `repay_amount = BN254_PRIME − signal[DELTA_STROOPS]`
   * 
   * A `new_commitment` with zero debt signals full repayment.  The Writz
   * backend monitors the `RepayEvent` to co-sign the BTC release (path A).
   * 
   * # Validations
   * * `old_root == stored_root`
   * * `is_borrow == 0`
   * * `old_nullifier` not spent
   * * Groth16 proof correctness
   */
  repay: ({repayer, zk_proof, public_signals, enc_note}: {repayer: string, zk_proof: Proof, public_signals: Array<Buffer>, enc_note: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a borrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Borrow USDC against a BTC position using a ZK proof.
   * 
   * The borrow_repay proof (with `is_borrow = 1`) proves - without
   * revealing collateral, debt amount, or position owner - that:
   * * The caller's commitment exists in the tree at `old_root`.
   * * After adding `delta_stroops`, collateral ratio ≥ 150%.
   * * `new_root` correctly reflects the updated commitment.
   * 
   * The USDC amount transferred to the borrower is derived **from the
   * proof's `delta_stroops` signal**, not from a caller-provided parameter.
   * This ensures the on-chain transfer exactly matches what the circuit
   * committed to.
   * 
   * # Validations
   * Beyond Groth16 correctness, the contract enforces:
   * * `old_root == stored_root` - no stale proofs.
   * * `is_borrow == 1` - prevents a repay proof being used here.
   * * `min_ratio_bp == config.min_collateral_ratio_bp` - no custom thresholds.
   * * `btc_price == oracle price` - no inflated collateral valuations.
   * * `old_nullifier` not spent - no double-borrow.
   * * `signal[RECIPIENT_LO/HI] == sha256(borrower strkey)` - the proof
   * commits to this exa
   */
  borrow: ({borrower, zk_proof, public_signals, enc_note}: {borrower: string, zk_proof: Proof, public_signals: Array<Buffer>, enc_note: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a BTC deposit with a ZK commitment.
   * 
   * The function performs the following checks, in order:
   * 
   * 1. **SPV** - the BTC transaction is confirmed with `min_confirmations`.
   * 2. **Duplicate guard** - the txid has not been deposited before.
   * 3. **Txid binding** - `signal[BTC_TXID_LO]` and `signal[BTC_TXID_HI]`
   * encode the same txid that the SPV call returned.  This prevents
   * replaying a proof from a different transaction.
   * 4. **Protocol param** - `signal[MIN_DEPOSIT_SATS]` equals the
   * configured minimum.  This prevents generating a proof with a lower
   * minimum to sneak in an undersized deposit.
   * 4b. **Collateral binding** - `raw_tx` actually pays the Writz P2WSH
   * rebuilt from `Config.protocol_pubkey`, `user_pubkey` and
   * `timelock_height` (the timelock bounded to 1,008..=105,000 blocks
   * above the confirming block), and `signal[ACTUAL_SATOSHIS]` equals
   * that real amount (the circuit separately binds it to the private
   * `collateral_satoshis`). Without this, the referenced transaction
   * need not lock anything under the protocol's c
   */
  deposit: ({depositor, block_hash, merkle_proof_btc, tx_index, raw_tx, user_pubkey, timelock_height, zk_proof, public_signals, enc_note}: {depositor: string, block_hash: Buffer, merkle_proof_btc: Array<Buffer>, tx_index: u32, raw_tx: Buffer, user_pubkey: Buffer, timelock_height: u32, zk_proof: Proof, public_signals: Array<Buffer>, enc_note: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a liquidate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Liquidate an undercollateralized position using a ZK proof.
   * 
   * The ZK liquidation proof proves - without revealing the position owner
   * or collateral amount - that:
   * * The commitment is in the tree at `merkle_root`.
   * * The collateral ratio is below `liquidation_threshold_bp`.
   * * `usdc_debt` matches the private debt encoded in the commitment.
   * 
   * The debt amount is extracted **from the proof's `usdc_debt` signal**, not
   * from a caller-supplied parameter.  The circuit constrains
   * `usdc_debt == debt_stroops` where `debt_stroops` is the private value
   * hashed into the commitment, so a keeper cannot inflate or deflate the
   * amount collected.
   * 
   * Liquidation reveals the debt amount by design - the position is being
   * publicly closed and the on-chain USDC transfer must match the proven debt.
   * 
   * # Validations
   * * `merkle_root == stored_root`
   * * `liquidation_threshold_bp == config.liquidation_threshold_bp`
   * * `btc_price == oracle price`
   * * `nullifier` not spent
   * * Groth16 proof correctness
   * 
   * # Public signals (liquidation circuit)
   * | Index | Signal |
   */
  liquidate: ({keeper, zk_proof, public_signals}: {keeper: string, zk_proof: Proof, public_signals: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the oracle contract address used for BTC/USD pricing. Admin only.
   * 
   * Note: as of Phase 1, `oracle::get_btc_price_stroops` ignores the
   * `oracle` config field entirely and returns a hardcoded stub price -
   * see `oracle.rs`. This setter exists so that swapping to a real oracle
   * in Phase 2 is a config change plus one function-body edit in
   * `oracle.rs`, not also a migration to add the setter itself. It does
   * not, on its own, make oracle pricing live.
   */
  set_oracle: ({caller, new_oracle}: {caller: string, new_oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses or unpauses new deposits/borrows/USDC supply. Admin only.
   * 
   * A pause never affects existing positions: `repay`, `withdraw_supply`,
   * and `liquidate` all ignore `Config::paused` by design, so users can
   * always exit. This is an emergency brake on new exposure, not a freeze
   * - see `docs/architecture/contract-migration-runbook.md`.
   */
  set_paused: ({caller, paused}: {caller: string, paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a supply_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lender supplies USDC to the pool to earn yield from borrower interest.
   * 
   * Each supplier's balance is tracked individually under
   * `DataKey::SupplyBalance(supplier)` so that `withdraw_supply` can enforce
   * that no supplier withdraws more than they deposited.
   */
  supply_usdc: ({supplier, amount}: {supplier: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a mark_released transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Records that a fully repaid position's BTC has been released, by
   * spending the zero-debt leaf's nullifier (GHSA-w4rp-v54x-2cv3,
   * GHSA-hcjf-8vjc-2hfv). After this, `borrow` on that leaf fails its
   * nullifier check.
   * 
   * Permissionless: the zero-debt proof needs the position's secret and
   * nonce, so only its owner can produce one.
   * 
   * Public signals (zero_debt circuit): [commitment, nullifier, merkle_root].
   */
  mark_released: ({zk_proof, public_signals}: {zk_proof: Proof, public_signals: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_commitment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the commitment for a Bitcoin txid, or None if not deposited.
   */
  get_commitment: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_pool_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `(total_supplied, total_borrowed)` in USDC stroops.
   */
  get_pool_state: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128]>>

  /**
   * Construct and simulate a get_merkle_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the current Poseidon Merkle root of the position commitment tree.
   */
  get_merkle_root: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a set_zk_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the zk-verifier contract address used for ZK proof verification.
   * Admin only. Changing this mid-flight affects only proofs submitted
   * after the change.
   */
  set_zk_verifier: ({caller, new_zk_verifier}: {caller: string, new_zk_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lender withdraws USDC from the pool.
   * 
   * Two limits are enforced:
   * 1. The supplier cannot withdraw more than their own deposited balance -
   * prevents one lender from draining another lender's funds.
   * 2. The pool must have sufficient undeployed liquidity
   * (`total_supplied − total_borrowed`) - prevents withdrawing USDC that
   * is currently lent out to borrowers.
   */
  withdraw_supply: ({supplier, amount}: {supplier: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refresh_pool_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of the USDC pool accounting entry.
   */
  refresh_pool_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_spv_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the bitcoin-spv contract address used for deposit verification.
   * Admin only. Changing this mid-flight affects only deposits submitted
   * after the change - an in-flight deposit's SPV proof was already
   * verified against the previous contract by the time this would run.
   */
  set_spv_contract: ({caller, new_spv_contract}: {caller: string, new_spv_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a insert_commitment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Insert a pending commitment into the Merkle tree and advance the root.
   * 
   * **Phase 1 (trusted admin):** the relayer runs the Poseidon tree off-chain
   * with circomlibjs, inserts the commitment at the next available leaf, and
   * submits the resulting root here.
   * 
   * **Phase 2 (planned):** will require a ZK proof of correct insertion
   * (using `MerkleTreeUpdater`) making this operation fully trustless.
   * 
   * The commitment must have been previously registered via `deposit`.
   */
  insert_commitment: ({caller, commitment, new_root}: {caller: string, commitment: Buffer, new_root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_supply_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the USDC supply balance (in stroops) for a lender.
   */
  get_supply_balance: ({lender}: {lender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_nullifier_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true if the nullifier has already been spent.
   */
  is_nullifier_spent: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_instance_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the instance storage TTL to another 90-day window.
   * 
   * Instance storage holds the contract Config. If the protocol is inactive
   * for 90 days, the Config entry expires and all functions return
   * `NotInitialized`. Keepers should call this periodically.
   */
  refresh_instance_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_commitment_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true if a commitment is pending Merkle tree insertion.
   */
  is_commitment_pending: ({commitment}: {commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_nullifier_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of a spent-nullifier entry to another 180-day window.
   * 
   * Spent nullifiers are the primary double-spend guard for ZK positions.
   * If a nullifier entry expires, the corresponding old commitment could
   * theoretically be re-used in a new proof. Keepers should refresh any
   * nullifier that is approaching its 180-day window.
   * Returns false if the nullifier is not currently marked as spent.
   */
  refresh_nullifier_ttl: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_commitment_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of the Bitcoin txid → commitment dedup record.
   * 
   * If this entry expires, the same Bitcoin transaction can be deposited a
   * second time, creating a duplicate commitment backed by the same UTXO.
   * Call this periodically for any active or recently-closed deposit.
   * Returns false if the txid has not been deposited.
   */
  refresh_commitment_ttl: ({txid}: {txid: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a refresh_merkle_root_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of the on-chain Merkle root to another 180-day window.
   * 
   * If the root entry expires, `stored_root` falls back to `EMPTY_TREE_ROOT`,
   * making all existing position proofs fail with `RootMismatch` until the
   * root is restored by a new borrow/repay/insert_commitment. Call this any
   * time the protocol experiences an extended period of inactivity.
   */
  refresh_merkle_root_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a refresh_supply_balance_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of a lender's supply balance entry.
   * 
   * Lenders who supplied USDC and do not interact for an extended period
   * risk having their balance entry expire, preventing withdrawal.
   * Returns false if the lender has no recorded balance.
   */
  refresh_supply_balance_ttl: ({lender}: {lender: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, spv_contract, zk_verifier, usdc_token, oracle, min_confirmations, protocol_pubkey}: {admin: string, spv_contract: string, zk_verifier: string, usdc_token: string, oracle: string, min_confirmations: u32, protocol_pubkey: Buffer},
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
    return ContractClient.deploy({admin, spv_contract, zk_verifier, usdc_token, oracle, min_confirmations, protocol_pubkey}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAxdSZXBheSBVU0RDIGRlYnQgb24gYSBaSyBwb3NpdGlvbi4KClRoZSBib3Jyb3dfcmVwYXkgcHJvb2YgKHdpdGggYGlzX2JvcnJvdyA9IDBgKSBwcm92ZXMgdGhhdDoKKiBUaGUgY2FsbGVyJ3MgY29tbWl0bWVudCBleGlzdHMgaW4gdGhlIHRyZWUgYXQgYG9sZF9yb290YC4KKiBUaGUgbmV3IGNvbW1pdG1lbnQgY29ycmVjdGx5IHJlZmxlY3RzIHRoZSByZWR1Y2VkIGRlYnQuCiogYG5ld19yb290YCByZWZsZWN0cyB0aGUgdXBkYXRlZCBjb21taXRtZW50LgoKVGhlIFVTREMgYW1vdW50IGNvbGxlY3RlZCBmcm9tIHRoZSByZXBheWVyIGlzIHJlY292ZXJlZCBmcm9tIHRoZQpwcm9vZidzIGBkZWx0YV9zdHJvb3BzYCBzaWduYWwgKGVuY29kZWQgYXMgYHAg4oiSIHJlcGF5X2Ftb3VudGAsIHRoZQpCTjI1NCBmaWVsZCBuZWdhdGlvbikgc28gdGhlIHRyYW5zZmVyIGV4YWN0bHkgbWF0Y2hlcyB0aGUgY2lyY3VpdCdzCmNvbW1pdHRlZCB2YWx1ZToKYHJlcGF5X2Ftb3VudCA9IEJOMjU0X1BSSU1FIOKIkiBzaWduYWxbREVMVEFfU1RST09QU11gCgpBIGBuZXdfY29tbWl0bWVudGAgd2l0aCB6ZXJvIGRlYnQgc2lnbmFscyBmdWxsIHJlcGF5bWVudC4gIFRoZSBXcml0egpiYWNrZW5kIG1vbml0b3JzIHRoZSBgUmVwYXlFdmVudGAgdG8gY28tc2lnbiB0aGUgQlRDIHJlbGVhc2UgKHBhdGggQSkuCgojIFZhbGlkYXRpb25zCiogYG9sZF9yb290ID09IHN0b3JlZF9yb290YAoqIGBpc19ib3Jyb3cgPT0gMGAKKiBgb2xkX251bGxpZmllcmAgbm90IHNwZW50CiogR3JvdGgxNiBwcm9vZiBjb3JyZWN0bmVzcwAAAAAFcmVwYXkAAAAAAAAEAAAAAAAAAAdyZXBheWVyAAAAABMAAAAAAAAACHprX3Byb29mAAAH0AAAAAVQcm9vZgAAAAAAAAAAAAAOcHVibGljX3NpZ25hbHMAAAAAA+oAAAPuAAAAIAAAAAAAAAAIZW5jX25vdGUAAAAOAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAABABCb3Jyb3cgVVNEQyBhZ2FpbnN0IGEgQlRDIHBvc2l0aW9uIHVzaW5nIGEgWksgcHJvb2YuCgpUaGUgYm9ycm93X3JlcGF5IHByb29mICh3aXRoIGBpc19ib3Jyb3cgPSAxYCkgcHJvdmVzIC0gd2l0aG91dApyZXZlYWxpbmcgY29sbGF0ZXJhbCwgZGVidCBhbW91bnQsIG9yIHBvc2l0aW9uIG93bmVyIC0gdGhhdDoKKiBUaGUgY2FsbGVyJ3MgY29tbWl0bWVudCBleGlzdHMgaW4gdGhlIHRyZWUgYXQgYG9sZF9yb290YC4KKiBBZnRlciBhZGRpbmcgYGRlbHRhX3N0cm9vcHNgLCBjb2xsYXRlcmFsIHJhdGlvIOKJpSAxNTAlLgoqIGBuZXdfcm9vdGAgY29ycmVjdGx5IHJlZmxlY3RzIHRoZSB1cGRhdGVkIGNvbW1pdG1lbnQuCgpUaGUgVVNEQyBhbW91bnQgdHJhbnNmZXJyZWQgdG8gdGhlIGJvcnJvd2VyIGlzIGRlcml2ZWQgKipmcm9tIHRoZQpwcm9vZidzIGBkZWx0YV9zdHJvb3BzYCBzaWduYWwqKiwgbm90IGZyb20gYSBjYWxsZXItcHJvdmlkZWQgcGFyYW1ldGVyLgpUaGlzIGVuc3VyZXMgdGhlIG9uLWNoYWluIHRyYW5zZmVyIGV4YWN0bHkgbWF0Y2hlcyB3aGF0IHRoZSBjaXJjdWl0CmNvbW1pdHRlZCB0by4KCiMgVmFsaWRhdGlvbnMKQmV5b25kIEdyb3RoMTYgY29ycmVjdG5lc3MsIHRoZSBjb250cmFjdCBlbmZvcmNlczoKKiBgb2xkX3Jvb3QgPT0gc3RvcmVkX3Jvb3RgIC0gbm8gc3RhbGUgcHJvb2ZzLgoqIGBpc19ib3Jyb3cgPT0gMWAgLSBwcmV2ZW50cyBhIHJlcGF5IHByb29mIGJlaW5nIHVzZWQgaGVyZS4KKiBgbWluX3JhdGlvX2JwID09IGNvbmZpZy5taW5fY29sbGF0ZXJhbF9yYXRpb19icGAgLSBubyBjdXN0b20gdGhyZXNob2xkcy4KKiBgYnRjX3ByaWNlID09IG9yYWNsZSBwcmljZWAgLSBubyBpbmZsYXRlZCBjb2xsYXRlcmFsIHZhbHVhdGlvbnMuCiogYG9sZF9udWxsaWZpZXJgIG5vdCBzcGVudCAtIG5vIGRvdWJsZS1ib3Jyb3cuCiogYHNpZ25hbFtSRUNJUElFTlRfTE8vSEldID09IHNoYTI1Nihib3Jyb3dlciBzdHJrZXkpYCAtIHRoZSBwcm9vZgpjb21taXRzIHRvIHRoaXMgZXhhAAAABmJvcnJvdwAAAAAABAAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAAAAAAh6a19wcm9vZgAAB9AAAAAFUHJvb2YAAAAAAAAAAAAADnB1YmxpY19zaWduYWxzAAAAAAPqAAAD7gAAACAAAAAAAAAACGVuY19ub3RlAAAADgAAAAEAAAPpAAAAAgAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAABABSZWdpc3RlciBhIEJUQyBkZXBvc2l0IHdpdGggYSBaSyBjb21taXRtZW50LgoKVGhlIGZ1bmN0aW9uIHBlcmZvcm1zIHRoZSBmb2xsb3dpbmcgY2hlY2tzLCBpbiBvcmRlcjoKCjEuICoqU1BWKiogLSB0aGUgQlRDIHRyYW5zYWN0aW9uIGlzIGNvbmZpcm1lZCB3aXRoIGBtaW5fY29uZmlybWF0aW9uc2AuCjIuICoqRHVwbGljYXRlIGd1YXJkKiogLSB0aGUgdHhpZCBoYXMgbm90IGJlZW4gZGVwb3NpdGVkIGJlZm9yZS4KMy4gKipUeGlkIGJpbmRpbmcqKiAtIGBzaWduYWxbQlRDX1RYSURfTE9dYCBhbmQgYHNpZ25hbFtCVENfVFhJRF9ISV1gCmVuY29kZSB0aGUgc2FtZSB0eGlkIHRoYXQgdGhlIFNQViBjYWxsIHJldHVybmVkLiAgVGhpcyBwcmV2ZW50cwpyZXBsYXlpbmcgYSBwcm9vZiBmcm9tIGEgZGlmZmVyZW50IHRyYW5zYWN0aW9uLgo0LiAqKlByb3RvY29sIHBhcmFtKiogLSBgc2lnbmFsW01JTl9ERVBPU0lUX1NBVFNdYCBlcXVhbHMgdGhlCmNvbmZpZ3VyZWQgbWluaW11bS4gIFRoaXMgcHJldmVudHMgZ2VuZXJhdGluZyBhIHByb29mIHdpdGggYSBsb3dlcgptaW5pbXVtIHRvIHNuZWFrIGluIGFuIHVuZGVyc2l6ZWQgZGVwb3NpdC4KNGIuICoqQ29sbGF0ZXJhbCBiaW5kaW5nKiogLSBgcmF3X3R4YCBhY3R1YWxseSBwYXlzIHRoZSBXcml0eiBQMldTSApyZWJ1aWx0IGZyb20gYENvbmZpZy5wcm90b2NvbF9wdWJrZXlgLCBgdXNlcl9wdWJrZXlgIGFuZApgdGltZWxvY2tfaGVpZ2h0YCAodGhlIHRpbWVsb2NrIGJvdW5kZWQgdG8gMSwwMDguLj0xMDUsMDAwIGJsb2NrcwphYm92ZSB0aGUgY29uZmlybWluZyBibG9jayksIGFuZCBgc2lnbmFsW0FDVFVBTF9TQVRPU0hJU11gIGVxdWFscwp0aGF0IHJlYWwgYW1vdW50ICh0aGUgY2lyY3VpdCBzZXBhcmF0ZWx5IGJpbmRzIGl0IHRvIHRoZSBwcml2YXRlCmBjb2xsYXRlcmFsX3NhdG9zaGlzYCkuIFdpdGhvdXQgdGhpcywgdGhlIHJlZmVyZW5jZWQgdHJhbnNhY3Rpb24KbmVlZCBub3QgbG9jayBhbnl0aGluZyB1bmRlciB0aGUgcHJvdG9jb2wncyBjAAAAB2RlcG9zaXQAAAAACgAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAKYmxvY2tfaGFzaAAAAAAD7gAAACAAAAAAAAAAEG1lcmtsZV9wcm9vZl9idGMAAAPqAAAD7gAAACAAAAAAAAAACHR4X2luZGV4AAAABAAAAAAAAAAGcmF3X3R4AAAAAAAOAAAAAAAAAAt1c2VyX3B1YmtleQAAAAPuAAAAIQAAAAAAAAAPdGltZWxvY2tfaGVpZ2h0AAAAAAQAAAAAAAAACHprX3Byb29mAAAH0AAAAAVQcm9vZgAAAAAAAAAAAAAOcHVibGljX3NpZ25hbHMAAAAAA+oAAAPuAAAAIAAAAAAAAAAIZW5jX25vdGUAAAAOAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAABABMaXF1aWRhdGUgYW4gdW5kZXJjb2xsYXRlcmFsaXplZCBwb3NpdGlvbiB1c2luZyBhIFpLIHByb29mLgoKVGhlIFpLIGxpcXVpZGF0aW9uIHByb29mIHByb3ZlcyAtIHdpdGhvdXQgcmV2ZWFsaW5nIHRoZSBwb3NpdGlvbiBvd25lcgpvciBjb2xsYXRlcmFsIGFtb3VudCAtIHRoYXQ6CiogVGhlIGNvbW1pdG1lbnQgaXMgaW4gdGhlIHRyZWUgYXQgYG1lcmtsZV9yb290YC4KKiBUaGUgY29sbGF0ZXJhbCByYXRpbyBpcyBiZWxvdyBgbGlxdWlkYXRpb25fdGhyZXNob2xkX2JwYC4KKiBgdXNkY19kZWJ0YCBtYXRjaGVzIHRoZSBwcml2YXRlIGRlYnQgZW5jb2RlZCBpbiB0aGUgY29tbWl0bWVudC4KClRoZSBkZWJ0IGFtb3VudCBpcyBleHRyYWN0ZWQgKipmcm9tIHRoZSBwcm9vZidzIGB1c2RjX2RlYnRgIHNpZ25hbCoqLCBub3QKZnJvbSBhIGNhbGxlci1zdXBwbGllZCBwYXJhbWV0ZXIuICBUaGUgY2lyY3VpdCBjb25zdHJhaW5zCmB1c2RjX2RlYnQgPT0gZGVidF9zdHJvb3BzYCB3aGVyZSBgZGVidF9zdHJvb3BzYCBpcyB0aGUgcHJpdmF0ZSB2YWx1ZQpoYXNoZWQgaW50byB0aGUgY29tbWl0bWVudCwgc28gYSBrZWVwZXIgY2Fubm90IGluZmxhdGUgb3IgZGVmbGF0ZSB0aGUKYW1vdW50IGNvbGxlY3RlZC4KCkxpcXVpZGF0aW9uIHJldmVhbHMgdGhlIGRlYnQgYW1vdW50IGJ5IGRlc2lnbiAtIHRoZSBwb3NpdGlvbiBpcyBiZWluZwpwdWJsaWNseSBjbG9zZWQgYW5kIHRoZSBvbi1jaGFpbiBVU0RDIHRyYW5zZmVyIG11c3QgbWF0Y2ggdGhlIHByb3ZlbiBkZWJ0LgoKIyBWYWxpZGF0aW9ucwoqIGBtZXJrbGVfcm9vdCA9PSBzdG9yZWRfcm9vdGAKKiBgbGlxdWlkYXRpb25fdGhyZXNob2xkX2JwID09IGNvbmZpZy5saXF1aWRhdGlvbl90aHJlc2hvbGRfYnBgCiogYGJ0Y19wcmljZSA9PSBvcmFjbGUgcHJpY2VgCiogYG51bGxpZmllcmAgbm90IHNwZW50CiogR3JvdGgxNiBwcm9vZiBjb3JyZWN0bmVzcwoKIyBQdWJsaWMgc2lnbmFscyAobGlxdWlkYXRpb24gY2lyY3VpdCkKfCBJbmRleCB8IFNpZ25hbCB8AAAACWxpcXVpZGF0ZQAAAAAAAAMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAIemtfcHJvb2YAAAfQAAAABVByb29mAAAAAAAAAAAAAA5wdWJsaWNfc2lnbmFscwAAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAAcFVcGRhdGVzIHRoZSBvcmFjbGUgY29udHJhY3QgYWRkcmVzcyB1c2VkIGZvciBCVEMvVVNEIHByaWNpbmcuIEFkbWluIG9ubHkuCgpOb3RlOiBhcyBvZiBQaGFzZSAxLCBgb3JhY2xlOjpnZXRfYnRjX3ByaWNlX3N0cm9vcHNgIGlnbm9yZXMgdGhlCmBvcmFjbGVgIGNvbmZpZyBmaWVsZCBlbnRpcmVseSBhbmQgcmV0dXJucyBhIGhhcmRjb2RlZCBzdHViIHByaWNlIC0Kc2VlIGBvcmFjbGUucnNgLiBUaGlzIHNldHRlciBleGlzdHMgc28gdGhhdCBzd2FwcGluZyB0byBhIHJlYWwgb3JhY2xlCmluIFBoYXNlIDIgaXMgYSBjb25maWcgY2hhbmdlIHBsdXMgb25lIGZ1bmN0aW9uLWJvZHkgZWRpdCBpbgpgb3JhY2xlLnJzYCwgbm90IGFsc28gYSBtaWdyYXRpb24gdG8gYWRkIHRoZSBzZXR0ZXIgaXRzZWxmLiBJdCBkb2VzCm5vdCwgb24gaXRzIG93biwgbWFrZSBvcmFjbGUgcHJpY2luZyBsaXZlLgAAAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACm5ld19vcmFjbGUAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IA",
        "AAAAAAAAAUpQYXVzZXMgb3IgdW5wYXVzZXMgbmV3IGRlcG9zaXRzL2JvcnJvd3MvVVNEQyBzdXBwbHkuIEFkbWluIG9ubHkuCgpBIHBhdXNlIG5ldmVyIGFmZmVjdHMgZXhpc3RpbmcgcG9zaXRpb25zOiBgcmVwYXlgLCBgd2l0aGRyYXdfc3VwcGx5YCwKYW5kIGBsaXF1aWRhdGVgIGFsbCBpZ25vcmUgYENvbmZpZzo6cGF1c2VkYCBieSBkZXNpZ24sIHNvIHVzZXJzIGNhbgphbHdheXMgZXhpdC4gVGhpcyBpcyBhbiBlbWVyZ2VuY3kgYnJha2Ugb24gbmV3IGV4cG9zdXJlLCBub3QgYSBmcmVlemUKLSBzZWUgYGRvY3MvYXJjaGl0ZWN0dXJlL2NvbnRyYWN0LW1pZ3JhdGlvbi1ydW5ib29rLm1kYC4AAAAAAApzZXRfcGF1c2VkAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAEAAAPpAAAAAgAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAAAPtMZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbCB0byBlYXJuIHlpZWxkIGZyb20gYm9ycm93ZXIgaW50ZXJlc3QuCgpFYWNoIHN1cHBsaWVyJ3MgYmFsYW5jZSBpcyB0cmFja2VkIGluZGl2aWR1YWxseSB1bmRlcgpgRGF0YUtleTo6U3VwcGx5QmFsYW5jZShzdXBwbGllcilgIHNvIHRoYXQgYHdpdGhkcmF3X3N1cHBseWAgY2FuIGVuZm9yY2UKdGhhdCBubyBzdXBwbGllciB3aXRoZHJhd3MgbW9yZSB0aGFuIHRoZXkgZGVwb3NpdGVkLgAAAAALc3VwcGx5X3VzZGMAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IA",
        "AAAAAAAAAWdSdW5zIGV4YWN0bHkgb25jZSwgYXRvbWljYWxseSwgYXMgcGFydCBvZiBkZXBsb3ltZW50IChgX19jb25zdHJ1Y3RvcmApIC0Kc2VlIEdIU0EtNDIybS1mNzN4LWZoNTguCgpTdG9yZXMgdGhlIGFkbWluLCBleHRlcm5hbCBjb250cmFjdCBhZGRyZXNzZXMsIGFuZCBwcm90b2NvbCBwYXJhbWV0ZXJzLgpJbml0aWFsaXplcyB0aGUgb24tY2hhaW4gTWVya2xlIHJvb3QgdG8gdGhlIGRlcHRoLTIwIFBvc2VpZG9uIGVtcHR5LXRyZWUKcm9vdCBzbyB0aGF0IHRoZSBmaXJzdCBib3Jyb3cgcHJvb2YncyBgb2xkX3Jvb3RgIGNhbiBiZSBpbmRlcGVuZGVudGx5CnZlcmlmaWVkIG9mZi1jaGFpbiB3aXRob3V0IGFueSB0cnVzdGVkIHNldHVwLgAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAcAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAMc3B2X2NvbnRyYWN0AAAAEwAAAAAAAAALemtfdmVyaWZpZXIAAAAAEwAAAAAAAAAKdXNkY190b2tlbgAAAAAAEwAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAAAAABFtaW5fY29uZmlybWF0aW9ucwAAAAAAAAQAAAAAAAAAD3Byb3RvY29sX3B1YmtleQAAAAPuAAAAIQAAAAA=",
        "AAAAAAAAAYtSZWNvcmRzIHRoYXQgYSBmdWxseSByZXBhaWQgcG9zaXRpb24ncyBCVEMgaGFzIGJlZW4gcmVsZWFzZWQsIGJ5CnNwZW5kaW5nIHRoZSB6ZXJvLWRlYnQgbGVhZidzIG51bGxpZmllciAoR0hTQS13NHJwLXY1NHgtMmN2MywKR0hTQS1oY2pmLTh2amMtMmhmdikuIEFmdGVyIHRoaXMsIGBib3Jyb3dgIG9uIHRoYXQgbGVhZiBmYWlscyBpdHMKbnVsbGlmaWVyIGNoZWNrLgoKUGVybWlzc2lvbmxlc3M6IHRoZSB6ZXJvLWRlYnQgcHJvb2YgbmVlZHMgdGhlIHBvc2l0aW9uJ3Mgc2VjcmV0IGFuZApub25jZSwgc28gb25seSBpdHMgb3duZXIgY2FuIHByb2R1Y2Ugb25lLgoKUHVibGljIHNpZ25hbHMgKHplcm9fZGVidCBjaXJjdWl0KTogW2NvbW1pdG1lbnQsIG51bGxpZmllciwgbWVya2xlX3Jvb3RdLgAAAAANbWFya19yZWxlYXNlZAAAAAAAAAIAAAAAAAAACHprX3Byb29mAAAH0AAAAAVQcm9vZgAAAAAAAAAAAAAOcHVibGljX3NpZ25hbHMAAAAAA+oAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAAAERSZXR1cm5zIHRoZSBjb21taXRtZW50IGZvciBhIEJpdGNvaW4gdHhpZCwgb3IgTm9uZSBpZiBub3QgZGVwb3NpdGVkLgAAAA5nZXRfY29tbWl0bWVudAAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAADtSZXR1cm5zIGAodG90YWxfc3VwcGxpZWQsIHRvdGFsX2JvcnJvd2VkKWAgaW4gVVNEQyBzdHJvb3BzLgAAAAAOZ2V0X3Bvb2xfc3RhdGUAAAAAAAAAAAABAAAD7QAAAAIAAAALAAAACw==",
        "AAAAAAAAAElSZXR1cm5zIHRoZSBjdXJyZW50IFBvc2VpZG9uIE1lcmtsZSByb290IG9mIHRoZSBwb3NpdGlvbiBjb21taXRtZW50IHRyZWUuAAAAAAAAD2dldF9tZXJrbGVfcm9vdAAAAAAAAAAAAQAAA+4AAAAg",
        "AAAAAAAAAJ1VcGRhdGVzIHRoZSB6ay12ZXJpZmllciBjb250cmFjdCBhZGRyZXNzIHVzZWQgZm9yIFpLIHByb29mIHZlcmlmaWNhdGlvbi4KQWRtaW4gb25seS4gQ2hhbmdpbmcgdGhpcyBtaWQtZmxpZ2h0IGFmZmVjdHMgb25seSBwcm9vZnMgc3VibWl0dGVkCmFmdGVyIHRoZSBjaGFuZ2UuAAAAAAAAD3NldF96a192ZXJpZmllcgAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAD25ld196a192ZXJpZmllcgAAAAATAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAAWFMZW5kZXIgd2l0aGRyYXdzIFVTREMgZnJvbSB0aGUgcG9vbC4KClR3byBsaW1pdHMgYXJlIGVuZm9yY2VkOgoxLiBUaGUgc3VwcGxpZXIgY2Fubm90IHdpdGhkcmF3IG1vcmUgdGhhbiB0aGVpciBvd24gZGVwb3NpdGVkIGJhbGFuY2UgLQpwcmV2ZW50cyBvbmUgbGVuZGVyIGZyb20gZHJhaW5pbmcgYW5vdGhlciBsZW5kZXIncyBmdW5kcy4KMi4gVGhlIHBvb2wgbXVzdCBoYXZlIHN1ZmZpY2llbnQgdW5kZXBsb3llZCBsaXF1aWRpdHkKKGB0b3RhbF9zdXBwbGllZCDiiJIgdG90YWxfYm9ycm93ZWRgKSAtIHByZXZlbnRzIHdpdGhkcmF3aW5nIFVTREMgdGhhdAppcyBjdXJyZW50bHkgbGVudCBvdXQgdG8gYm9ycm93ZXJzLgAAAAAAAA93aXRoZHJhd19zdXBwbHkAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IA",
        "AAAAAAAAADFFeHRlbmQgdGhlIFRUTCBvZiB0aGUgVVNEQyBwb29sIGFjY291bnRpbmcgZW50cnkuAAAAAAAAEHJlZnJlc2hfcG9vbF90dGwAAAAAAAAAAA==",
        "AAAAAAAAAQ9VcGRhdGVzIHRoZSBiaXRjb2luLXNwdiBjb250cmFjdCBhZGRyZXNzIHVzZWQgZm9yIGRlcG9zaXQgdmVyaWZpY2F0aW9uLgpBZG1pbiBvbmx5LiBDaGFuZ2luZyB0aGlzIG1pZC1mbGlnaHQgYWZmZWN0cyBvbmx5IGRlcG9zaXRzIHN1Ym1pdHRlZAphZnRlciB0aGUgY2hhbmdlIC0gYW4gaW4tZmxpZ2h0IGRlcG9zaXQncyBTUFYgcHJvb2Ygd2FzIGFscmVhZHkKdmVyaWZpZWQgYWdhaW5zdCB0aGUgcHJldmlvdXMgY29udHJhY3QgYnkgdGhlIHRpbWUgdGhpcyB3b3VsZCBydW4uAAAAABBzZXRfc3B2X2NvbnRyYWN0AAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAABBuZXdfc3B2X2NvbnRyYWN0AAAAEwAAAAEAAAPpAAAAAgAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAAAcdJbnNlcnQgYSBwZW5kaW5nIGNvbW1pdG1lbnQgaW50byB0aGUgTWVya2xlIHRyZWUgYW5kIGFkdmFuY2UgdGhlIHJvb3QuCgoqKlBoYXNlIDEgKHRydXN0ZWQgYWRtaW4pOioqIHRoZSByZWxheWVyIHJ1bnMgdGhlIFBvc2VpZG9uIHRyZWUgb2ZmLWNoYWluCndpdGggY2lyY29tbGlianMsIGluc2VydHMgdGhlIGNvbW1pdG1lbnQgYXQgdGhlIG5leHQgYXZhaWxhYmxlIGxlYWYsIGFuZApzdWJtaXRzIHRoZSByZXN1bHRpbmcgcm9vdCBoZXJlLgoKKipQaGFzZSAyIChwbGFubmVkKToqKiB3aWxsIHJlcXVpcmUgYSBaSyBwcm9vZiBvZiBjb3JyZWN0IGluc2VydGlvbgoodXNpbmcgYE1lcmtsZVRyZWVVcGRhdGVyYCkgbWFraW5nIHRoaXMgb3BlcmF0aW9uIGZ1bGx5IHRydXN0bGVzcy4KClRoZSBjb21taXRtZW50IG11c3QgaGF2ZSBiZWVuIHByZXZpb3VzbHkgcmVnaXN0ZXJlZCB2aWEgYGRlcG9zaXRgLgAAAAARaW5zZXJ0X2NvbW1pdG1lbnQAAAAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAhuZXdfcm9vdAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAADpSZXR1cm5zIHRoZSBVU0RDIHN1cHBseSBiYWxhbmNlIChpbiBzdHJvb3BzKSBmb3IgYSBsZW5kZXIuAAAAAAASZ2V0X3N1cHBseV9iYWxhbmNlAAAAAAABAAAAAAAAAAZsZW5kZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAADVSZXR1cm5zIHRydWUgaWYgdGhlIG51bGxpZmllciBoYXMgYWxyZWFkeSBiZWVuIHNwZW50LgAAAAAAABJpc19udWxsaWZpZXJfc3BlbnQAAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAPpFeHRlbmQgdGhlIGluc3RhbmNlIHN0b3JhZ2UgVFRMIHRvIGFub3RoZXIgOTAtZGF5IHdpbmRvdy4KCkluc3RhbmNlIHN0b3JhZ2UgaG9sZHMgdGhlIGNvbnRyYWN0IENvbmZpZy4gSWYgdGhlIHByb3RvY29sIGlzIGluYWN0aXZlCmZvciA5MCBkYXlzLCB0aGUgQ29uZmlnIGVudHJ5IGV4cGlyZXMgYW5kIGFsbCBmdW5jdGlvbnMgcmV0dXJuCmBOb3RJbml0aWFsaXplZGAuIEtlZXBlcnMgc2hvdWxkIGNhbGwgdGhpcyBwZXJpb2RpY2FsbHkuAAAAAAAUcmVmcmVzaF9pbnN0YW5jZV90dGwAAAAAAAAAAA==",
        "AAAAAAAAAD5SZXR1cm5zIHRydWUgaWYgYSBjb21taXRtZW50IGlzIHBlbmRpbmcgTWVya2xlIHRyZWUgaW5zZXJ0aW9uLgAAAAAAFWlzX2NvbW1pdG1lbnRfcGVuZGluZwAAAAAAAAEAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAYdFeHRlbmQgdGhlIFRUTCBvZiBhIHNwZW50LW51bGxpZmllciBlbnRyeSB0byBhbm90aGVyIDE4MC1kYXkgd2luZG93LgoKU3BlbnQgbnVsbGlmaWVycyBhcmUgdGhlIHByaW1hcnkgZG91YmxlLXNwZW5kIGd1YXJkIGZvciBaSyBwb3NpdGlvbnMuCklmIGEgbnVsbGlmaWVyIGVudHJ5IGV4cGlyZXMsIHRoZSBjb3JyZXNwb25kaW5nIG9sZCBjb21taXRtZW50IGNvdWxkCnRoZW9yZXRpY2FsbHkgYmUgcmUtdXNlZCBpbiBhIG5ldyBwcm9vZi4gS2VlcGVycyBzaG91bGQgcmVmcmVzaCBhbnkKbnVsbGlmaWVyIHRoYXQgaXMgYXBwcm9hY2hpbmcgaXRzIDE4MC1kYXkgd2luZG93LgpSZXR1cm5zIGZhbHNlIGlmIHRoZSBudWxsaWZpZXIgaXMgbm90IGN1cnJlbnRseSBtYXJrZWQgYXMgc3BlbnQuAAAAABVyZWZyZXNoX251bGxpZmllcl90dGwAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAUFFeHRlbmQgdGhlIFRUTCBvZiB0aGUgQml0Y29pbiB0eGlkIOKGkiBjb21taXRtZW50IGRlZHVwIHJlY29yZC4KCklmIHRoaXMgZW50cnkgZXhwaXJlcywgdGhlIHNhbWUgQml0Y29pbiB0cmFuc2FjdGlvbiBjYW4gYmUgZGVwb3NpdGVkIGEKc2Vjb25kIHRpbWUsIGNyZWF0aW5nIGEgZHVwbGljYXRlIGNvbW1pdG1lbnQgYmFja2VkIGJ5IHRoZSBzYW1lIFVUWE8uCkNhbGwgdGhpcyBwZXJpb2RpY2FsbHkgZm9yIGFueSBhY3RpdmUgb3IgcmVjZW50bHktY2xvc2VkIGRlcG9zaXQuClJldHVybnMgZmFsc2UgaWYgdGhlIHR4aWQgaGFzIG5vdCBiZWVuIGRlcG9zaXRlZC4AAAAAAAAWcmVmcmVzaF9jb21taXRtZW50X3R0bAAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAV9FeHRlbmQgdGhlIFRUTCBvZiB0aGUgb24tY2hhaW4gTWVya2xlIHJvb3QgdG8gYW5vdGhlciAxODAtZGF5IHdpbmRvdy4KCklmIHRoZSByb290IGVudHJ5IGV4cGlyZXMsIGBzdG9yZWRfcm9vdGAgZmFsbHMgYmFjayB0byBgRU1QVFlfVFJFRV9ST09UYCwKbWFraW5nIGFsbCBleGlzdGluZyBwb3NpdGlvbiBwcm9vZnMgZmFpbCB3aXRoIGBSb290TWlzbWF0Y2hgIHVudGlsIHRoZQpyb290IGlzIHJlc3RvcmVkIGJ5IGEgbmV3IGJvcnJvdy9yZXBheS9pbnNlcnRfY29tbWl0bWVudC4gQ2FsbCB0aGlzIGFueQp0aW1lIHRoZSBwcm90b2NvbCBleHBlcmllbmNlcyBhbiBleHRlbmRlZCBwZXJpb2Qgb2YgaW5hY3Rpdml0eS4AAAAAF3JlZnJlc2hfbWVya2xlX3Jvb3RfdHRsAAAAAAAAAAAA",
        "AAAAAAAAAOxFeHRlbmQgdGhlIFRUTCBvZiBhIGxlbmRlcidzIHN1cHBseSBiYWxhbmNlIGVudHJ5LgoKTGVuZGVycyB3aG8gc3VwcGxpZWQgVVNEQyBhbmQgZG8gbm90IGludGVyYWN0IGZvciBhbiBleHRlbmRlZCBwZXJpb2QKcmlzayBoYXZpbmcgdGhlaXIgYmFsYW5jZSBlbnRyeSBleHBpcmUsIHByZXZlbnRpbmcgd2l0aGRyYXdhbC4KUmV0dXJucyBmYWxzZSBpZiB0aGUgbGVuZGVyIGhhcyBubyByZWNvcmRlZCBiYWxhbmNlLgAAABpyZWZyZXNoX3N1cHBseV9iYWxhbmNlX3R0bAAAAAAAAQAAAAAAAAAGbGVuZGVyAAAAAAATAAAAAQAAAAE=",
        "AAAABAAAAAAAAAAAAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IAAAAAFQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAC5aSyBwcm9vZiBmYWlsZWQgb24tY2hhaW4gR3JvdGgxNiB2ZXJpZmljYXRpb24uAAAAAAAOSW52YWxpZFprUHJvb2YAAAAAAAQAAAA+YG9sZF9yb290YCBpbiB0aGUgcHJvb2YgZG9lcyBub3QgbWF0Y2ggdGhlIHN0b3JlZCBNZXJrbGUgcm9vdC4AAAAAAAxSb290TWlzbWF0Y2gAAAAFAAAAJlRoaXMgbnVsbGlmaWVyIGhhcyBhbHJlYWR5IGJlZW4gc3BlbnQuAAAAAAAVTnVsbGlmaWVyQWxyZWFkeVNwZW50AAAAAAAABgAAADRBIGRlcG9zaXQgd2l0aCB0aGUgc2FtZSBCaXRjb2luIHR4aWQgYWxyZWFkeSBleGlzdHMuAAAAEER1cGxpY2F0ZURlcG9zaXQAAAAHAAAAMFRoZSBjb21taXRtZW50IHdhcyBub3QgcmVnaXN0ZXJlZCB2aWEgYGRlcG9zaXRgLgAAABJDb21taXRtZW50Tm90Rm91bmQAAAAAAAgAAAAzVVNEQyBwb29sIGRvZXMgbm90IGhhdmUgZW5vdWdoIGF2YWlsYWJsZSBsaXF1aWRpdHkuAAAAABVJbnN1ZmZpY2llbnRMaXF1aWRpdHkAAAAAAAAJAAAASGBpc19ib3Jyb3dgIHNpZ25hbCBkb2Vzbid0IG1hdGNoIHRoZSBmdW5jdGlvbiBjYWxsZWQgKGJvcnJvdyB2cy4gcmVwYXkpLgAAABBXcm9uZ0NpcmN1aXRNb2RlAAAACgAAAIJBIHB1YmxpYyBwcm90b2NvbCBwYXJhbWV0ZXIgaW4gdGhlIHByb29mIChtaW5fcmF0aW9fYnAsIHRocmVzaG9sZCwgZXRjLikKZG9lcyBub3QgbWF0Y2ggdGhlIHZhbHVlIHN0b3JlZCBpbiB0aGUgY29udHJhY3QncyBjb25maWcuAAAAAAAVUHJvdG9jb2xQYXJhbU1pc21hdGNoAAAAAAAACwAAAElUaGUgQlRDL1VTRCBwcmljZSBpbiB0aGUgcHJvb2YgZG9lcyBub3QgbWF0Y2ggdGhlIG9yYWNsZSdzIGN1cnJlbnQgcHJpY2UuAAAAAAAADVByaWNlTWlzbWF0Y2gAAAAAAAAMAAAASlRoZSBCVEMgdHhpZCBlbmNvZGVkIGluIHRoZSBaSyBwcm9vZiBkb2VzIG5vdCBtYXRjaCB0aGUgU1BWLXZlcmlmaWVkIHR4aWQuAAAAAAAMVHhpZE1pc21hdGNoAAAADQAAAIBBIHNpZ25hbCB2YWx1ZSBpcyB0b28gbGFyZ2UgdG8gZXh0cmFjdCBhcyBhIFNvcm9iYW4tbmF0aXZlIGludGVnZXIuCkluZGljYXRlcyB0aGUgcHJvb2Ygd2FzIGNvbXB1dGVkIHdpdGggYW4gb3V0LW9mLXJhbmdlIHZhbHVlLgAAAA5TaWduYWxPdmVyZmxvdwAAAAAADgAAAD9XaXRoZHJhd2FsIGFtb3VudCBleGNlZWRzIHRoZSBzdXBwbGllcidzIG93biBkZXBvc2l0ZWQgYmFsYW5jZS4AAAAAFldpdGhkcmF3RXhjZWVkc0JhbGFuY2UAAAAAAA8AAACuVGhlIGNvbnRyYWN0IGlzIHBhdXNlZCAtIG5ldyBkZXBvc2l0cywgYm9ycm93cywgYW5kIFVTREMgc3VwcGx5IGFyZQpyZWZ1c2VkLiBFeGlzdGluZyBwb3NpdGlvbnMgY2FuIHN0aWxsIHJlcGF5LCB3aXRoZHJhdywgYW5kIGxpcXVpZGF0ZTsKYSBwYXVzZSBvbmx5IGJsb2NrcyBuZXcgcmlzay10YWtpbmcuAAAAAAAGUGF1c2VkAAAAAAAQAAABE2ByYXdfdHhgIGhhcyBubyBvdXRwdXQgcGF5aW5nIHRoZSBXcml0eiBQMldTSCBkZXJpdmVkIGZyb20gdGhlCnByb3RvY29sIGtleSwgdGhlIGRlcG9zaXRvcidzIGtleSBhbmQgdGhlIHRpbWVsb2NrIC0gdGhpcyBkZXBvc2l0J3MKQml0Y29pbiB0cmFuc2FjdGlvbiBuZXZlciBsb2NrZWQgY29sbGF0ZXJhbCB1bmRlciB0aGUgcHJvdG9jb2wncwpjby1zaWduaW5nIGtleSAoR0hTQS0yaGpqLXg1d3ItNHA2OCwgR0hTQS14cDZqLWcycnctaDVnNiwKR0hTQS1tZzR4LWNyMjMtNHgzdikuAAAAABNWYXVsdE91dHB1dE5vdEZvdW5kAAAAABEAAACvVGhlIHByb29mJ3MgcHJpdmF0ZSBgY29sbGF0ZXJhbF9zYXRvc2hpc2AgKGJvdW5kIGluLWNpcmN1aXQgdG8gdGhlCnB1YmxpYyBgYWN0dWFsX3NhdG9zaGlzYCBzaWduYWwpIGRvZXMgbm90IG1hdGNoIHRoZSBhbW91bnQgdGhpcwpjb250cmFjdCBpbmRlcGVuZGVudGx5IHBhcnNlZCBmcm9tIGByYXdfdHhgLgAAAAAYQ29sbGF0ZXJhbEFtb3VudE1pc21hdGNoAAAAEgAAAPJgc2lnbmFsW1JFQ0lQSUVOVF9MTy9ISV1gIChzaGEyNTYgb2YgdGhlIHJlY2lwaWVudCdzIHN0cmtleSBhZGRyZXNzKQpkb2VzIG5vdCBtYXRjaCB0aGUgYXV0aGVudGljYXRlZCBgYm9ycm93ZXJgIGFyZ3VtZW50IC0gdGhlIHByb29mIHdhcwpnZW5lcmF0ZWQgZm9yIGEgZGlmZmVyZW50IHJlY2lwaWVudCBhbmQgY2Fubm90IGJlIHJlZGlyZWN0ZWQKKEdIU0EteHhxdi02dmh4LWhocngsIEdIU0EtbWhwOS1qbXZjLXg5bXcpLgAAAAAAEVJlY2lwaWVudE1pc21hdGNoAAAAAAAAEwAAAHdBIGNvbnN0cnVjdG9yIGBwcm90b2NvbF9wdWJrZXlgIG9yIGRlcG9zaXQgYHVzZXJfcHVia2V5YCBpcyBub3QgYQpjb21wcmVzc2VkIHNlY3AyNTZrMSBrZXkgZW5jb2RpbmcgKGAwMmAvYDAzYCBwcmVmaXgpLgAAAAANSW52YWxpZFB1YmtleQAAAAAAABQAAACRVGhlIGRlcG9zaXQncyB0aW1lbG9jayBpcyBvdXRzaWRlIDEsMDA4Li49MTA1LDAwMCBibG9ja3MgYWJvdmUgdGhlCkJpdGNvaW4gYmxvY2sgdGhhdCBjb25maXJtZWQgaXQgLSBhbiBpbnN0YW50IG9yIGFic3VyZGx5IGRpc3RhbnQKZXNjYXBlIGhhdGNoLgAAAAAAAA9JbnZhbGlkVGltZWxvY2sAAAAAFQ==",
        "AAAAAQAAAC1Hcm90aDE2IHByb29mLiAgTWlycm9ycyBgemtfdmVyaWZpZXI6OlByb29mYC4AAAAAAAAAAAAABVByb29mAAAAAAAAAwAAAAAAAAAEcGlfYQAAB9AAAAAHRzFQb2ludAAAAAAAAAAABHBpX2IAAAfQAAAAB0cyUG9pbnQAAAAAAAAAAARwaV9jAAAH0AAAAAdHMVBvaW50AA==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAACwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAABhsaXF1aWRhdGlvbl90aHJlc2hvbGRfYnAAAAAEAAAAAAAAABdtaW5fY29sbGF0ZXJhbF9yYXRpb19icAAAAAAEAAAAAAAAABFtaW5fY29uZmlybWF0aW9ucwAAAAAAAAQAAAAAAAAAFG1pbl9kZXBvc2l0X3NhdG9zaGlzAAAABgAAAAAAAAAGb3JhY2xlAAAAAAATAAABTldoZW4gdHJ1ZSwgYGRlcG9zaXRgL2Bib3Jyb3dgL2BzdXBwbHlfdXNkY2AgKG5ldyByaXNrLXRha2luZyBhY3Rpb25zKQphcmUgcmVmdXNlZC4gYHJlcGF5YC9gd2l0aGRyYXdfc3VwcGx5YC9gbGlxdWlkYXRlYCBzdGF5IG9wZW4gc28gdXNlcnMKY2FuIGFsd2F5cyBleGl0IC0gYSBwYXVzZSBpcyBhbiBlbWVyZ2VuY3kgYnJha2Ugb24gbmV3IGV4cG9zdXJlLCBub3QKYSBmcmVlemUgb24gZXhpc3RpbmcgcG9zaXRpb25zLiBBZG1pbi1nYXRlZCB2aWEgYHNldF9wYXVzZWRgLiBTZWUKYGRvY3MvYXJjaGl0ZWN0dXJlL2NvbnRyYWN0LW1pZ3JhdGlvbi1ydW5ib29rLm1kYCwgVHJhY2sgMi4AAAAAAAZwYXVzZWQAAAAAAAEAAAFtVGhlIHByb3RvY29sJ3MgMzMtYnl0ZSBjb21wcmVzc2VkIEJpdGNvaW4gY28tc2lnbmluZyBrZXkuIEV2ZXJ5IFpLCmRlcG9zaXQgbXVzdCBwYXkgdGhlIFdyaXR6IFAyV1NIIGJ1aWx0IGZyb20gdGhpcyBrZXksIHRoZSBkZXBvc2l0b3Incwpvd24ga2V5IGFuZCBhIGJvdW5kZWQgdGltZWxvY2sgLSB0aGUgc2FtZSBzY3JpcHQgYHByaXZhdGUtbGVuZGAKY2hlY2tzLCBzbyB0aGUgZGVwb3NpdG9yIGtlZXBzIGEgdW5pbGF0ZXJhbCB0aW1lbG9jayBleGl0IGFuZCB0aGUKcHJvdG9jb2wgY2FuIG9ubHkgZXZlciBjby1zaWduLiBJbW11dGFibGUgcGVyIGNvbnRyYWN0OyByb3RhdGluZyBpdAptZWFucyBhIG5ldyBkZXBsb3ltZW50ICgjMTc3KS4AAAAAAAAPcHJvdG9jb2xfcHVia2V5AAAAA+4AAAAhAAAAAAAAAAxzcHZfY29udHJhY3QAAAATAAAAAAAAAAp1c2RjX3Rva2VuAAAAAAATAAAAAAAAAAt6a192ZXJpZmllcgAAAAAT",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAA/U2luZ2xldG9uOiBwcm90b2NvbCBjb25maWd1cmF0aW9uIChzZXQgb25jZSBhdCBpbml0aWFsaXphdGlvbikuAAAAAAZDb25maWcAAAAAAAAAAAAlU2luZ2xldG9uOiBhZ2dyZWdhdGUgVVNEQyBwb29sIHN0YXRlLgAAAAAAAARQb29sAAAAAAAAAEFUaGUgY3VycmVudCBQb3NlaWRvbiBNZXJrbGUgcm9vdCBvZiB0aGUgcG9zaXRpb24gY29tbWl0bWVudCB0cmVlLgAAAAAAAApNZXJrbGVSb290AAAAAAABAAAAO01hcmtzIGEgbnVsbGlmaWVyIGFzIHNwZW50LiAgRW50cnkgZXhpc3RlbmNlIG1lYW5zICJzcGVudCIuAAAAAA5TcGVudE51bGxpZmllcgAAAAAAAQAAA+4AAAAgAAAAAQAAAGpDb21taXRtZW50IHBlbmRpbmcgTWVya2xlIHRyZWUgaW5zZXJ0aW9uIGJ5IHRoZSByZWxheWVyLgpTZXQgYnkgYGRlcG9zaXRgLCBjbGVhcmVkIGJ5IGBpbnNlcnRfY29tbWl0bWVudGAuAAAAAAARUGVuZGluZ0NvbW1pdG1lbnQAAAAAAAABAAAD7gAAACAAAAABAAAALk1hcHMgYSBCaXRjb2luIHR4aWQgdG8gaXRzIGRlcG9zaXQgY29tbWl0bWVudC4AAAAAAAxUeENvbW1pdG1lbnQAAAABAAAD7gAAACAAAAABAAAAKlBlci1sZW5kZXIgVVNEQyBzdXBwbHkgYmFsYW5jZSBpbiBzdHJvb3BzLgAAAAAADVN1cHBseUJhbGFuY2UAAAAAAAABAAAAEw==",
        "AAAAAQAAAFZCTjI1NCBHMSBhZmZpbmUgcG9pbnQgLSA2NCBieXRlcyAoWCB8fCBZLCBiaWctZW5kaWFuKS4KTWlycm9ycyBgemtfdmVyaWZpZXI6OkcxUG9pbnRgLgAAAAAAAAAAAAdHMVBvaW50AAAAAAEAAAAAAAAABWJ5dGVzAAAAAAAD7gAAAEA=",
        "AAAAAQAAAGFCTjI1NCBHMiBhZmZpbmUgcG9pbnQgLSAxMjggYnl0ZXMgKFguYzEgfHwgWC5jMCB8fCBZLmMxIHx8IFkuYzApLgpNaXJyb3JzIGB6a192ZXJpZmllcjo6RzJQb2ludGAuAAAAAAAAAAAAAAdHMlBvaW50AAAAAAEAAAAAAAAABWJ5dGVzAAAAAAAD7gAAAIA=",
        "AAAAAQAAAAAAAAAAAAAACVBvb2xTdGF0ZQAAAAAAAAIAAAAAAAAADnRvdGFsX2JvcnJvd2VkAAAAAAALAAAAAAAAAA50b3RhbF9zdXBwbGllZAAAAAAACw==",
        "AAAABQAAANBFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciByZXBheXMgVVNEQyBkZWJ0IG9uIGEgWksgcG9zaXRpb24uCmBuZXdfY29tbWl0bWVudGAgZW5jb2RlcyB0aGUgdXBkYXRlZCAobG93ZXIpIGRlYnQgLSBhIHplcm8tZGVidCBjb21taXRtZW50CnNpZ25hbHMgZnVsbCByZXBheW1lbnQ7IHRoZSBiYWNrZW5kIGNvLXNpZ25zIHRoZSBCVEMgcmVsZWFzZSBvbiBzZWVpbmcgaXQuAAAAAAAAAApSZXBheUV2ZW50AAAAAAABAAAABXJlcGF5AAAAAAAABgAAAAAAAAAIbmV3X3Jvb3QAAAPuAAAAIAAAAAEAAAAAAAAAB3JlcGF5ZXIAAAAAEwAAAAAAAAAAAAAAC3VzZGNfYW1vdW50AAAAAAsAAAAAAAAAAAAAAA1vbGRfbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAAAAAA5uZXdfY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAATkVuY3J5cHRlZCBwb3NpdGlvbiBub3RlIGZvciB0aGUgbmV3IChsb3dlci1kZWJ0KSBjb21taXRtZW50LiBTZWUgRGVwb3NpdEV2ZW50LgAAAAAACGVuY19ub3RlAAAADgAAAAAAAAAC",
        "AAAABQAAAHFFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciBkcmF3cyBVU0RDIGFnYWluc3QgYSBaSyBwb3NpdGlvbi4KYG9sZF9udWxsaWZpZXJgIG1hcmtzIHRoZSBwcmV2aW91cyBjb21taXRtZW50IGFzIHNwZW50LgAAAAAAAAAAAAALQm9ycm93RXZlbnQAAAAAAQAAAAZib3Jyb3cAAAAAAAUAAAAAAAAACG5ld19yb290AAAD7gAAACAAAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAAAAAANb2xkX251bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAE9FbmNyeXB0ZWQgcG9zaXRpb24gbm90ZSBmb3IgdGhlIG5ldyAoaGlnaGVyLWRlYnQpIGNvbW1pdG1lbnQuIFNlZSBEZXBvc2l0RXZlbnQuAAAAAAhlbmNfbm90ZQAAAA4AAAAAAAAAAg==",
        "AAAABQAAAPxFbWl0dGVkIHdoZW4gYSBsZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbC4KCkNsb3NlcyBhIGdhcCBub3RlZCBpbiBgZG9jcy9hcmNoaXRlY3R1cmUvY29udHJhY3QtbWlncmF0aW9uLXJ1bmJvb2subWRgOgp3aXRob3V0IHRoaXMgZXZlbnQsIGxlbmRlcnMgY291bGQgbm90IGJlIGVudW1lcmF0ZWQgb2ZmLWNoYWluIGF0IGFsbAooYGdldF9zdXBwbHlfYmFsYW5jZWAgcmVxdWlyZXMgYWxyZWFkeSBrbm93aW5nIHRoZSBhZGRyZXNzKS4AAAAAAAAAC1N1cHBseUV2ZW50AAAAAAEAAAAGc3VwcGx5AAAAAAADAAAAAAAAAAhzdXBwbGllcgAAABMAAAABAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAAAAAAOdG90YWxfc3VwcGxpZWQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAHlFbWl0dGVkIHdoZW4gYSBCVEMgZGVwb3NpdCBpcyBzdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBhbmQgdGhlIFpLCmNvbW1pdG1lbnQgaXMgcXVldWVkIGZvciBpbnNlcnRpb24gaW50byB0aGUgTWVya2xlIHRyZWUuAAAAAAAAAAAAAAxEZXBvc2l0RXZlbnQAAAABAAAAB2RlcG9zaXQAAAAABwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAAAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAyVRoZSBkZXBvc2l0b3IncyBCaXRjb2luIGtleSBhbmQgQ0xUViBoZWlnaHQgdGhlIGNvbGxhdGVyYWwgaXMgbG9ja2VkCnVuZGVyLiBXaXRoIHRoZSBwcm90b2NvbCBrZXkgdGhleSByZWJ1aWxkIHRoZSBkZXBvc2l0J3MgcmVkZWVtCnNjcmlwdCwgc28gdGhlIHRpbWVsb2NrIGV4aXQgc3RheXMgcmVjb3ZlcmFibGUgZnJvbSBjaGFpbiBkYXRhIGFsb25lLgAAAAAAAAt1c2VyX3B1YmtleQAAAAPuAAAAIQAAAAAAAAAAAAAAD3RpbWVsb2NrX2hlaWdodAAAAAAEAAAAAAAAANJPcGFxdWUgY2lwaGVydGV4dCBvZiB0aGUgcG9zaXRpb24gbm90ZSAoe2NvbGxhdGVyYWwsIGRlYnQsIG5vbmNlLCAuLi59KQplbmNyeXB0ZWQgdG8gdGhlIG93bmVyJ3Mgdmlld2luZyBrZXksIGZvciBjcm9zcy1kZXZpY2UgcmVjb3ZlcnkuIFRoZQpjb250cmFjdCBuZXZlciBkZWNyeXB0cyBpdCAtIGl0IG9ubHkgZWNob2VzIHRoZSBjbGllbnQtc3VwcGxpZWQgYmxvYi4AAAAAAAhlbmNfbm90ZQAAAA4AAAAAAAAAAg==",
        "AAAABQAAADNFbWl0dGVkIHdoZW4gYSBsZW5kZXIgd2l0aGRyYXdzIFVTREMgZnJvbSB0aGUgcG9vbC4AAAAAAAAAAA1XaXRoZHJhd0V2ZW50AAAAAAAAAQAAAAh3aXRoZHJhdwAAAAMAAAAAAAAACHN1cHBsaWVyAAAAEwAAAAEAAAAAAAAAC3VzZGNfYW1vdW50AAAAAAsAAAAAAAAAAAAAAA50b3RhbF9zdXBwbGllZAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAI5FbWl0dGVkIHdoZW4gYSBrZWVwZXIgbGlxdWlkYXRlcyBhbiB1bmRlcmNvbGxhdGVyYWxpemVkIFpLIHBvc2l0aW9uLgpUaGUgYmFja2VuZCBtb25pdG9ycyB0aGlzIGV2ZW50IHRvIGNvLXNpZ24gdGhlIEJUQyByZWxlYXNlIHRvIHRoZSBrZWVwZXIuAAAAAAAAAAAADkxpcXVpZGF0ZUV2ZW50AAAAAAABAAAACWxpcXVpZGF0ZQAAAAAAAAMAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAAAAAAJdXNkY19kZWJ0AAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAI9FbWl0dGVkIHdoZW4gdGhlIGFkbWluIHBhdXNlcyBvciB1bnBhdXNlcyBuZXcgZGVwb3NpdHMvYm9ycm93cy9zdXBwbHkuCkV4aXN0aW5nIHBvc2l0aW9ucyBhcmUgbmV2ZXIgYWZmZWN0ZWQgYnkgYSBwYXVzZSAtIHNlZSBgQ29uZmlnOjpwYXVzZWRgLgAAAAAAAAAADlBhdXNlZFNldEV2ZW50AAAAAAABAAAACnBhdXNlZF9zZXQAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAHBFbWl0dGVkIHdoZW4gdGhlIGFkbWluL3JlbGF5ZXIgaW5zZXJ0cyBhIHBlbmRpbmcgY29tbWl0bWVudCBpbnRvIHRoZQpvbi1jaGFpbiBNZXJrbGUgdHJlZSBhbmQgYWR2YW5jZXMgdGhlIHJvb3QuAAAAAAAAAA9JbnNlcnRMZWFmRXZlbnQAAAAAAQAAAAtpbnNlcnRfbGVhZgAAAAACAAAAAAAAAAhuZXdfcm9vdAAAA+4AAAAgAAAAAQAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAAFVNwdlZlcmlmaWNhdGlvblJlc3VsdAAAAAAAAAQAAAA+VGhlIGhhc2ggKFNIQTI1NmQpIG9mIHRoZSBibG9jayB0aGF0IGNvbnRhaW5zIHRoZSB0cmFuc2FjdGlvbi4AAAAAAApibG9ja19oYXNoAAAAAAPuAAAAIAAAADpCaXRjb2luIGhlaWdodCBvZiB0aGUgYmxvY2sgdGhhdCBjb250YWlucyB0aGUgdHJhbnNhY3Rpb24uAAAAAAAMYmxvY2tfaGVpZ2h0AAAABAAAAEFUaGUgYmxvY2sncyBkZXB0aCBiZWxvdyB0aGUgYmVzdCBjaGFpbiB0aXAgKHRoZSB0aXAgaXRzZWxmIGlzIDEpLgAAAAAAAA1jb25maXJtYXRpb25zAAAAAAAABAAAAEVUaGUgdHJhbnNhY3Rpb24gaWRlbnRpZmllcjogU0hBMjU2ZCBvZiB0aGUgbm9uLXdpdG5lc3Mgc2VyaWFsaXphdGlvbi4AAAAAAAAEdHhpZAAAA+4AAAAg" ]),
      options
    )
  }
  public readonly fromJSON = {
    repay: this.txFromJSON<Result<void>>,
        borrow: this.txFromJSON<Result<void>>,
        deposit: this.txFromJSON<Result<Buffer>>,
        liquidate: this.txFromJSON<Result<void>>,
        set_oracle: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        supply_usdc: this.txFromJSON<Result<void>>,
        mark_released: this.txFromJSON<Result<void>>,
        get_commitment: this.txFromJSON<Option<Buffer>>,
        get_pool_state: this.txFromJSON<readonly [i128, i128]>,
        get_merkle_root: this.txFromJSON<Buffer>,
        set_zk_verifier: this.txFromJSON<Result<void>>,
        withdraw_supply: this.txFromJSON<Result<void>>,
        refresh_pool_ttl: this.txFromJSON<null>,
        set_spv_contract: this.txFromJSON<Result<void>>,
        insert_commitment: this.txFromJSON<Result<void>>,
        get_supply_balance: this.txFromJSON<i128>,
        is_nullifier_spent: this.txFromJSON<boolean>,
        refresh_instance_ttl: this.txFromJSON<null>,
        is_commitment_pending: this.txFromJSON<boolean>,
        refresh_nullifier_ttl: this.txFromJSON<boolean>,
        refresh_commitment_ttl: this.txFromJSON<boolean>,
        refresh_merkle_root_ttl: this.txFromJSON<null>,
        refresh_supply_balance_ttl: this.txFromJSON<boolean>
  }
}