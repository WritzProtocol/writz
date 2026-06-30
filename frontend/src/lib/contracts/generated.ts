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
  15: {message:"WithdrawExceedsBalance"}
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
  spv_contract: string;
  usdc_token: string;
  zk_verifier: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Pool", values: void} | {tag: "MerkleRoot", values: void} | {tag: "SpentNullifier", values: readonly [Buffer]} | {tag: "PendingCommitment", values: readonly [Buffer]} | {tag: "TxCommitment", values: readonly [Buffer]} | {tag: "SupplyBalance", values: readonly [string]};


/**
 * BN254 G1 affine point — 64 bytes (X || Y, big-endian).
 * Mirrors `zk_verifier::G1Point`.
 */
export interface G1Point {
  bytes: Buffer;
}


/**
 * BN254 G2 affine point — 128 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
 * Mirrors `zk_verifier::G2Point`.
 */
export interface G2Point {
  bytes: Buffer;
}


export interface PoolState {
  total_borrowed: i128;
  total_supplied: i128;
}


/**
 * Mirrors `bitcoin_spv::VerificationResult`.
 * Field names must match exactly for XDR round-tripping through the
 * cross-contract call to work.
 */
export interface SpvResult {
  block_hash: Buffer;
  confirmations: u32;
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
   * The borrow_repay proof (with `is_borrow = 1`) proves — without
   * revealing collateral, debt amount, or position owner — that:
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
   * * `old_root == stored_root` — no stale proofs.
   * * `is_borrow == 1` — prevents a repay proof being used here.
   * * `min_ratio_bp == config.min_collateral_ratio_bp` — no custom thresholds.
   * * `btc_price == oracle price` — no inflated collateral valuations.
   * * `old_nullifier` not spent — no double-borrow.
   * 
   * # Public signals (borrow_repay circuit)
   * | Index | Signal |
   * |-------|---
   */
  borrow: ({borrower, zk_proof, public_signals, enc_note}: {borrower: string, zk_proof: Proof, public_signals: Array<Buffer>, enc_note: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a BTC deposit with a ZK commitment.
   * 
   * The function performs the following checks, in order:
   * 
   * 1. **SPV** — the BTC transaction is confirmed with `min_confirmations`.
   * 2. **Duplicate guard** — the txid has not been deposited before.
   * 3. **Txid binding** — `signal[BTC_TXID_LO]` and `signal[BTC_TXID_HI]`
   * encode the same txid that the SPV call returned.  This prevents
   * replaying a proof from a different transaction.
   * 4. **Protocol param** — `signal[MIN_DEPOSIT_SATS]` equals the
   * configured minimum.  This prevents generating a proof with a lower
   * minimum to sneak in an undersized deposit.
   * 5. **Nullifier freshness** — the nullifier was not previously spent.
   * 6. **ZK proof** — Groth16 verification via the `zk-verifier` contract.
   * 
   * On success, the commitment is stored as *pending* tree insertion.
   * Call `insert_commitment` (admin/relayer) to advance the Merkle root
   * and make the position borrowable.
   * 
   * # Public signals (deposit circuit)
   * | Index | Signal | Description |
   * |-------|--------|-------------|
   * | 0 | `co
   */
  deposit: ({depositor, headers, merkle_proof_btc, tx_index, raw_tx, zk_proof, public_signals, enc_note}: {depositor: string, headers: Array<Buffer>, merkle_proof_btc: Array<Buffer>, tx_index: u32, raw_tx: Buffer, zk_proof: Proof, public_signals: Array<Buffer>, enc_note: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a liquidate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Liquidate an undercollateralized position using a ZK proof.
   * 
   * The ZK liquidation proof proves — without revealing the position owner
   * or collateral amount — that:
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
   * Liquidation reveals the debt amount by design — the position is being
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
   * | Index | Si
   */
  liquidate: ({keeper, zk_proof, public_signals}: {keeper: string, zk_proof: Proof, public_signals: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time contract initialization.
   * 
   * Stores the admin, external contract addresses, and protocol parameters.
   * Initializes the on-chain Merkle root to the depth-20 Poseidon empty-tree
   * root so that the first borrow proof's `old_root` can be independently
   * verified off-chain without any trusted setup.
   */
  initialize: ({admin, spv_contract, zk_verifier, usdc_token, oracle, min_confirmations}: {admin: string, spv_contract: string, zk_verifier: string, usdc_token: string, oracle: string, min_confirmations: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Construct and simulate a withdraw_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lender withdraws USDC from the pool.
   * 
   * Two limits are enforced:
   * 1. The supplier cannot withdraw more than their own deposited balance —
   * prevents one lender from draining another lender's funds.
   * 2. The pool must have sufficient undeployed liquidity
   * (`total_supplied − total_borrowed`) — prevents withdrawing USDC that
   * is currently lent out to borrowers.
   */
  withdraw_supply: ({supplier, amount}: {supplier: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refresh_pool_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the TTL of the USDC pool accounting entry.
   */
  refresh_pool_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAAxdSZXBheSBVU0RDIGRlYnQgb24gYSBaSyBwb3NpdGlvbi4KClRoZSBib3Jyb3dfcmVwYXkgcHJvb2YgKHdpdGggYGlzX2JvcnJvdyA9IDBgKSBwcm92ZXMgdGhhdDoKKiBUaGUgY2FsbGVyJ3MgY29tbWl0bWVudCBleGlzdHMgaW4gdGhlIHRyZWUgYXQgYG9sZF9yb290YC4KKiBUaGUgbmV3IGNvbW1pdG1lbnQgY29ycmVjdGx5IHJlZmxlY3RzIHRoZSByZWR1Y2VkIGRlYnQuCiogYG5ld19yb290YCByZWZsZWN0cyB0aGUgdXBkYXRlZCBjb21taXRtZW50LgoKVGhlIFVTREMgYW1vdW50IGNvbGxlY3RlZCBmcm9tIHRoZSByZXBheWVyIGlzIHJlY292ZXJlZCBmcm9tIHRoZQpwcm9vZidzIGBkZWx0YV9zdHJvb3BzYCBzaWduYWwgKGVuY29kZWQgYXMgYHAg4oiSIHJlcGF5X2Ftb3VudGAsIHRoZQpCTjI1NCBmaWVsZCBuZWdhdGlvbikgc28gdGhlIHRyYW5zZmVyIGV4YWN0bHkgbWF0Y2hlcyB0aGUgY2lyY3VpdCdzCmNvbW1pdHRlZCB2YWx1ZToKYHJlcGF5X2Ftb3VudCA9IEJOMjU0X1BSSU1FIOKIkiBzaWduYWxbREVMVEFfU1RST09QU11gCgpBIGBuZXdfY29tbWl0bWVudGAgd2l0aCB6ZXJvIGRlYnQgc2lnbmFscyBmdWxsIHJlcGF5bWVudC4gIFRoZSBXcml0egpiYWNrZW5kIG1vbml0b3JzIHRoZSBgUmVwYXlFdmVudGAgdG8gY28tc2lnbiB0aGUgQlRDIHJlbGVhc2UgKHBhdGggQSkuCgojIFZhbGlkYXRpb25zCiogYG9sZF9yb290ID09IHN0b3JlZF9yb290YAoqIGBpc19ib3Jyb3cgPT0gMGAKKiBgb2xkX251bGxpZmllcmAgbm90IHNwZW50CiogR3JvdGgxNiBwcm9vZiBjb3JyZWN0bmVzcwAAAAAFcmVwYXkAAAAAAAAEAAAAAAAAAAdyZXBheWVyAAAAABMAAAAAAAAACHprX3Byb29mAAAH0AAAAAVQcm9vZgAAAAAAAAAAAAAOcHVibGljX3NpZ25hbHMAAAAAA+oAAAPuAAAAIAAAAAAAAAAIZW5jX25vdGUAAAAOAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAABABCb3Jyb3cgVVNEQyBhZ2FpbnN0IGEgQlRDIHBvc2l0aW9uIHVzaW5nIGEgWksgcHJvb2YuCgpUaGUgYm9ycm93X3JlcGF5IHByb29mICh3aXRoIGBpc19ib3Jyb3cgPSAxYCkgcHJvdmVzIOKAlCB3aXRob3V0CnJldmVhbGluZyBjb2xsYXRlcmFsLCBkZWJ0IGFtb3VudCwgb3IgcG9zaXRpb24gb3duZXIg4oCUIHRoYXQ6CiogVGhlIGNhbGxlcidzIGNvbW1pdG1lbnQgZXhpc3RzIGluIHRoZSB0cmVlIGF0IGBvbGRfcm9vdGAuCiogQWZ0ZXIgYWRkaW5nIGBkZWx0YV9zdHJvb3BzYCwgY29sbGF0ZXJhbCByYXRpbyDiiaUgMTUwJS4KKiBgbmV3X3Jvb3RgIGNvcnJlY3RseSByZWZsZWN0cyB0aGUgdXBkYXRlZCBjb21taXRtZW50LgoKVGhlIFVTREMgYW1vdW50IHRyYW5zZmVycmVkIHRvIHRoZSBib3Jyb3dlciBpcyBkZXJpdmVkICoqZnJvbSB0aGUKcHJvb2YncyBgZGVsdGFfc3Ryb29wc2Agc2lnbmFsKiosIG5vdCBmcm9tIGEgY2FsbGVyLXByb3ZpZGVkIHBhcmFtZXRlci4KVGhpcyBlbnN1cmVzIHRoZSBvbi1jaGFpbiB0cmFuc2ZlciBleGFjdGx5IG1hdGNoZXMgd2hhdCB0aGUgY2lyY3VpdApjb21taXR0ZWQgdG8uCgojIFZhbGlkYXRpb25zCkJleW9uZCBHcm90aDE2IGNvcnJlY3RuZXNzLCB0aGUgY29udHJhY3QgZW5mb3JjZXM6CiogYG9sZF9yb290ID09IHN0b3JlZF9yb290YCDigJQgbm8gc3RhbGUgcHJvb2ZzLgoqIGBpc19ib3Jyb3cgPT0gMWAg4oCUIHByZXZlbnRzIGEgcmVwYXkgcHJvb2YgYmVpbmcgdXNlZCBoZXJlLgoqIGBtaW5fcmF0aW9fYnAgPT0gY29uZmlnLm1pbl9jb2xsYXRlcmFsX3JhdGlvX2JwYCDigJQgbm8gY3VzdG9tIHRocmVzaG9sZHMuCiogYGJ0Y19wcmljZSA9PSBvcmFjbGUgcHJpY2VgIOKAlCBubyBpbmZsYXRlZCBjb2xsYXRlcmFsIHZhbHVhdGlvbnMuCiogYG9sZF9udWxsaWZpZXJgIG5vdCBzcGVudCDigJQgbm8gZG91YmxlLWJvcnJvdy4KCiMgUHVibGljIHNpZ25hbHMgKGJvcnJvd19yZXBheSBjaXJjdWl0KQp8IEluZGV4IHwgU2lnbmFsIHwKfC0tLS0tLS18LS0tAAAABmJvcnJvdwAAAAAABAAAAAAAAAAIYm9ycm93ZXIAAAATAAAAAAAAAAh6a19wcm9vZgAAB9AAAAAFUHJvb2YAAAAAAAAAAAAADnB1YmxpY19zaWduYWxzAAAAAAPqAAAD7gAAACAAAAAAAAAACGVuY19ub3RlAAAADgAAAAEAAAPpAAAAAgAAB9AAAAATQ29tbWl0bWVudFRyZWVFcnJvcgA=",
        "AAAAAAAABABSZWdpc3RlciBhIEJUQyBkZXBvc2l0IHdpdGggYSBaSyBjb21taXRtZW50LgoKVGhlIGZ1bmN0aW9uIHBlcmZvcm1zIHRoZSBmb2xsb3dpbmcgY2hlY2tzLCBpbiBvcmRlcjoKCjEuICoqU1BWKiog4oCUIHRoZSBCVEMgdHJhbnNhY3Rpb24gaXMgY29uZmlybWVkIHdpdGggYG1pbl9jb25maXJtYXRpb25zYC4KMi4gKipEdXBsaWNhdGUgZ3VhcmQqKiDigJQgdGhlIHR4aWQgaGFzIG5vdCBiZWVuIGRlcG9zaXRlZCBiZWZvcmUuCjMuICoqVHhpZCBiaW5kaW5nKiog4oCUIGBzaWduYWxbQlRDX1RYSURfTE9dYCBhbmQgYHNpZ25hbFtCVENfVFhJRF9ISV1gCmVuY29kZSB0aGUgc2FtZSB0eGlkIHRoYXQgdGhlIFNQViBjYWxsIHJldHVybmVkLiAgVGhpcyBwcmV2ZW50cwpyZXBsYXlpbmcgYSBwcm9vZiBmcm9tIGEgZGlmZmVyZW50IHRyYW5zYWN0aW9uLgo0LiAqKlByb3RvY29sIHBhcmFtKiog4oCUIGBzaWduYWxbTUlOX0RFUE9TSVRfU0FUU11gIGVxdWFscyB0aGUKY29uZmlndXJlZCBtaW5pbXVtLiAgVGhpcyBwcmV2ZW50cyBnZW5lcmF0aW5nIGEgcHJvb2Ygd2l0aCBhIGxvd2VyCm1pbmltdW0gdG8gc25lYWsgaW4gYW4gdW5kZXJzaXplZCBkZXBvc2l0Lgo1LiAqKk51bGxpZmllciBmcmVzaG5lc3MqKiDigJQgdGhlIG51bGxpZmllciB3YXMgbm90IHByZXZpb3VzbHkgc3BlbnQuCjYuICoqWksgcHJvb2YqKiDigJQgR3JvdGgxNiB2ZXJpZmljYXRpb24gdmlhIHRoZSBgemstdmVyaWZpZXJgIGNvbnRyYWN0LgoKT24gc3VjY2VzcywgdGhlIGNvbW1pdG1lbnQgaXMgc3RvcmVkIGFzICpwZW5kaW5nKiB0cmVlIGluc2VydGlvbi4KQ2FsbCBgaW5zZXJ0X2NvbW1pdG1lbnRgIChhZG1pbi9yZWxheWVyKSB0byBhZHZhbmNlIHRoZSBNZXJrbGUgcm9vdAphbmQgbWFrZSB0aGUgcG9zaXRpb24gYm9ycm93YWJsZS4KCiMgUHVibGljIHNpZ25hbHMgKGRlcG9zaXQgY2lyY3VpdCkKfCBJbmRleCB8IFNpZ25hbCB8IERlc2NyaXB0aW9uIHwKfC0tLS0tLS18LS0tLS0tLS18LS0tLS0tLS0tLS0tLXwKfCAwIHwgYGNvAAAAB2RlcG9zaXQAAAAACAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAHaGVhZGVycwAAAAPqAAAD7gAAAFAAAAAAAAAAEG1lcmtsZV9wcm9vZl9idGMAAAPqAAAD7gAAACAAAAAAAAAACHR4X2luZGV4AAAABAAAAAAAAAAGcmF3X3R4AAAAAAAOAAAAAAAAAAh6a19wcm9vZgAAB9AAAAAFUHJvb2YAAAAAAAAAAAAADnB1YmxpY19zaWduYWxzAAAAAAPqAAAD7gAAACAAAAAAAAAACGVuY19ub3RlAAAADgAAAAEAAAPpAAAD7gAAACAAAAfQAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IA",
        "AAAAAAAABABMaXF1aWRhdGUgYW4gdW5kZXJjb2xsYXRlcmFsaXplZCBwb3NpdGlvbiB1c2luZyBhIFpLIHByb29mLgoKVGhlIFpLIGxpcXVpZGF0aW9uIHByb29mIHByb3ZlcyDigJQgd2l0aG91dCByZXZlYWxpbmcgdGhlIHBvc2l0aW9uIG93bmVyCm9yIGNvbGxhdGVyYWwgYW1vdW50IOKAlCB0aGF0OgoqIFRoZSBjb21taXRtZW50IGlzIGluIHRoZSB0cmVlIGF0IGBtZXJrbGVfcm9vdGAuCiogVGhlIGNvbGxhdGVyYWwgcmF0aW8gaXMgYmVsb3cgYGxpcXVpZGF0aW9uX3RocmVzaG9sZF9icGAuCiogYHVzZGNfZGVidGAgbWF0Y2hlcyB0aGUgcHJpdmF0ZSBkZWJ0IGVuY29kZWQgaW4gdGhlIGNvbW1pdG1lbnQuCgpUaGUgZGVidCBhbW91bnQgaXMgZXh0cmFjdGVkICoqZnJvbSB0aGUgcHJvb2YncyBgdXNkY19kZWJ0YCBzaWduYWwqKiwgbm90CmZyb20gYSBjYWxsZXItc3VwcGxpZWQgcGFyYW1ldGVyLiAgVGhlIGNpcmN1aXQgY29uc3RyYWlucwpgdXNkY19kZWJ0ID09IGRlYnRfc3Ryb29wc2Agd2hlcmUgYGRlYnRfc3Ryb29wc2AgaXMgdGhlIHByaXZhdGUgdmFsdWUKaGFzaGVkIGludG8gdGhlIGNvbW1pdG1lbnQsIHNvIGEga2VlcGVyIGNhbm5vdCBpbmZsYXRlIG9yIGRlZmxhdGUgdGhlCmFtb3VudCBjb2xsZWN0ZWQuCgpMaXF1aWRhdGlvbiByZXZlYWxzIHRoZSBkZWJ0IGFtb3VudCBieSBkZXNpZ24g4oCUIHRoZSBwb3NpdGlvbiBpcyBiZWluZwpwdWJsaWNseSBjbG9zZWQgYW5kIHRoZSBvbi1jaGFpbiBVU0RDIHRyYW5zZmVyIG11c3QgbWF0Y2ggdGhlIHByb3ZlbiBkZWJ0LgoKIyBWYWxpZGF0aW9ucwoqIGBtZXJrbGVfcm9vdCA9PSBzdG9yZWRfcm9vdGAKKiBgbGlxdWlkYXRpb25fdGhyZXNob2xkX2JwID09IGNvbmZpZy5saXF1aWRhdGlvbl90aHJlc2hvbGRfYnBgCiogYGJ0Y19wcmljZSA9PSBvcmFjbGUgcHJpY2VgCiogYG51bGxpZmllcmAgbm90IHNwZW50CiogR3JvdGgxNiBwcm9vZiBjb3JyZWN0bmVzcwoKIyBQdWJsaWMgc2lnbmFscyAobGlxdWlkYXRpb24gY2lyY3VpdCkKfCBJbmRleCB8IFNpAAAACWxpcXVpZGF0ZQAAAAAAAAMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAIemtfcHJvb2YAAAfQAAAABVByb29mAAAAAAAAAAAAAA5wdWJsaWNfc2lnbmFscwAAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAASdPbmUtdGltZSBjb250cmFjdCBpbml0aWFsaXphdGlvbi4KClN0b3JlcyB0aGUgYWRtaW4sIGV4dGVybmFsIGNvbnRyYWN0IGFkZHJlc3NlcywgYW5kIHByb3RvY29sIHBhcmFtZXRlcnMuCkluaXRpYWxpemVzIHRoZSBvbi1jaGFpbiBNZXJrbGUgcm9vdCB0byB0aGUgZGVwdGgtMjAgUG9zZWlkb24gZW1wdHktdHJlZQpyb290IHNvIHRoYXQgdGhlIGZpcnN0IGJvcnJvdyBwcm9vZidzIGBvbGRfcm9vdGAgY2FuIGJlIGluZGVwZW5kZW50bHkKdmVyaWZpZWQgb2ZmLWNoYWluIHdpdGhvdXQgYW55IHRydXN0ZWQgc2V0dXAuAAAAAAppbml0aWFsaXplAAAAAAAGAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADHNwdl9jb250cmFjdAAAABMAAAAAAAAAC3prX3ZlcmlmaWVyAAAAABMAAAAAAAAACnVzZGNfdG9rZW4AAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAAAAAARbWluX2NvbmZpcm1hdGlvbnMAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAAPtMZW5kZXIgc3VwcGxpZXMgVVNEQyB0byB0aGUgcG9vbCB0byBlYXJuIHlpZWxkIGZyb20gYm9ycm93ZXIgaW50ZXJlc3QuCgpFYWNoIHN1cHBsaWVyJ3MgYmFsYW5jZSBpcyB0cmFja2VkIGluZGl2aWR1YWxseSB1bmRlcgpgRGF0YUtleTo6U3VwcGx5QmFsYW5jZShzdXBwbGllcilgIHNvIHRoYXQgYHdpdGhkcmF3X3N1cHBseWAgY2FuIGVuZm9yY2UKdGhhdCBubyBzdXBwbGllciB3aXRoZHJhd3MgbW9yZSB0aGFuIHRoZXkgZGVwb3NpdGVkLgAAAAALc3VwcGx5X3VzZGMAAAAAAgAAAAAAAAAIc3VwcGxpZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IA",
        "AAAAAAAAAERSZXR1cm5zIHRoZSBjb21taXRtZW50IGZvciBhIEJpdGNvaW4gdHhpZCwgb3IgTm9uZSBpZiBub3QgZGVwb3NpdGVkLgAAAA5nZXRfY29tbWl0bWVudAAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAADtSZXR1cm5zIGAodG90YWxfc3VwcGxpZWQsIHRvdGFsX2JvcnJvd2VkKWAgaW4gVVNEQyBzdHJvb3BzLgAAAAAOZ2V0X3Bvb2xfc3RhdGUAAAAAAAAAAAABAAAD7QAAAAIAAAALAAAACw==",
        "AAAAAAAAAElSZXR1cm5zIHRoZSBjdXJyZW50IFBvc2VpZG9uIE1lcmtsZSByb290IG9mIHRoZSBwb3NpdGlvbiBjb21taXRtZW50IHRyZWUuAAAAAAAAD2dldF9tZXJrbGVfcm9vdAAAAAAAAAAAAQAAA+4AAAAg",
        "AAAAAAAAAWVMZW5kZXIgd2l0aGRyYXdzIFVTREMgZnJvbSB0aGUgcG9vbC4KClR3byBsaW1pdHMgYXJlIGVuZm9yY2VkOgoxLiBUaGUgc3VwcGxpZXIgY2Fubm90IHdpdGhkcmF3IG1vcmUgdGhhbiB0aGVpciBvd24gZGVwb3NpdGVkIGJhbGFuY2Ug4oCUCnByZXZlbnRzIG9uZSBsZW5kZXIgZnJvbSBkcmFpbmluZyBhbm90aGVyIGxlbmRlcidzIGZ1bmRzLgoyLiBUaGUgcG9vbCBtdXN0IGhhdmUgc3VmZmljaWVudCB1bmRlcGxveWVkIGxpcXVpZGl0eQooYHRvdGFsX3N1cHBsaWVkIOKIkiB0b3RhbF9ib3Jyb3dlZGApIOKAlCBwcmV2ZW50cyB3aXRoZHJhd2luZyBVU0RDIHRoYXQKaXMgY3VycmVudGx5IGxlbnQgb3V0IHRvIGJvcnJvd2Vycy4AAAAAAAAPd2l0aGRyYXdfc3VwcGx5AAAAAAIAAAAAAAAACHN1cHBsaWVyAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAADFFeHRlbmQgdGhlIFRUTCBvZiB0aGUgVVNEQyBwb29sIGFjY291bnRpbmcgZW50cnkuAAAAAAAAEHJlZnJlc2hfcG9vbF90dGwAAAAAAAAAAA==",
        "AAAAAAAAAcdJbnNlcnQgYSBwZW5kaW5nIGNvbW1pdG1lbnQgaW50byB0aGUgTWVya2xlIHRyZWUgYW5kIGFkdmFuY2UgdGhlIHJvb3QuCgoqKlBoYXNlIDEgKHRydXN0ZWQgYWRtaW4pOioqIHRoZSByZWxheWVyIHJ1bnMgdGhlIFBvc2VpZG9uIHRyZWUgb2ZmLWNoYWluCndpdGggY2lyY29tbGlianMsIGluc2VydHMgdGhlIGNvbW1pdG1lbnQgYXQgdGhlIG5leHQgYXZhaWxhYmxlIGxlYWYsIGFuZApzdWJtaXRzIHRoZSByZXN1bHRpbmcgcm9vdCBoZXJlLgoKKipQaGFzZSAyIChwbGFubmVkKToqKiB3aWxsIHJlcXVpcmUgYSBaSyBwcm9vZiBvZiBjb3JyZWN0IGluc2VydGlvbgoodXNpbmcgYE1lcmtsZVRyZWVVcGRhdGVyYCkgbWFraW5nIHRoaXMgb3BlcmF0aW9uIGZ1bGx5IHRydXN0bGVzcy4KClRoZSBjb21taXRtZW50IG11c3QgaGF2ZSBiZWVuIHByZXZpb3VzbHkgcmVnaXN0ZXJlZCB2aWEgYGRlcG9zaXRgLgAAAAARaW5zZXJ0X2NvbW1pdG1lbnQAAAAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAhuZXdfcm9vdAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAABNDb21taXRtZW50VHJlZUVycm9yAA==",
        "AAAAAAAAADpSZXR1cm5zIHRoZSBVU0RDIHN1cHBseSBiYWxhbmNlIChpbiBzdHJvb3BzKSBmb3IgYSBsZW5kZXIuAAAAAAASZ2V0X3N1cHBseV9iYWxhbmNlAAAAAAABAAAAAAAAAAZsZW5kZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAADVSZXR1cm5zIHRydWUgaWYgdGhlIG51bGxpZmllciBoYXMgYWxyZWFkeSBiZWVuIHNwZW50LgAAAAAAABJpc19udWxsaWZpZXJfc3BlbnQAAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAPpFeHRlbmQgdGhlIGluc3RhbmNlIHN0b3JhZ2UgVFRMIHRvIGFub3RoZXIgOTAtZGF5IHdpbmRvdy4KCkluc3RhbmNlIHN0b3JhZ2UgaG9sZHMgdGhlIGNvbnRyYWN0IENvbmZpZy4gSWYgdGhlIHByb3RvY29sIGlzIGluYWN0aXZlCmZvciA5MCBkYXlzLCB0aGUgQ29uZmlnIGVudHJ5IGV4cGlyZXMgYW5kIGFsbCBmdW5jdGlvbnMgcmV0dXJuCmBOb3RJbml0aWFsaXplZGAuIEtlZXBlcnMgc2hvdWxkIGNhbGwgdGhpcyBwZXJpb2RpY2FsbHkuAAAAAAAUcmVmcmVzaF9pbnN0YW5jZV90dGwAAAAAAAAAAA==",
        "AAAAAAAAAD5SZXR1cm5zIHRydWUgaWYgYSBjb21taXRtZW50IGlzIHBlbmRpbmcgTWVya2xlIHRyZWUgaW5zZXJ0aW9uLgAAAAAAFWlzX2NvbW1pdG1lbnRfcGVuZGluZwAAAAAAAAEAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAYdFeHRlbmQgdGhlIFRUTCBvZiBhIHNwZW50LW51bGxpZmllciBlbnRyeSB0byBhbm90aGVyIDE4MC1kYXkgd2luZG93LgoKU3BlbnQgbnVsbGlmaWVycyBhcmUgdGhlIHByaW1hcnkgZG91YmxlLXNwZW5kIGd1YXJkIGZvciBaSyBwb3NpdGlvbnMuCklmIGEgbnVsbGlmaWVyIGVudHJ5IGV4cGlyZXMsIHRoZSBjb3JyZXNwb25kaW5nIG9sZCBjb21taXRtZW50IGNvdWxkCnRoZW9yZXRpY2FsbHkgYmUgcmUtdXNlZCBpbiBhIG5ldyBwcm9vZi4gS2VlcGVycyBzaG91bGQgcmVmcmVzaCBhbnkKbnVsbGlmaWVyIHRoYXQgaXMgYXBwcm9hY2hpbmcgaXRzIDE4MC1kYXkgd2luZG93LgpSZXR1cm5zIGZhbHNlIGlmIHRoZSBudWxsaWZpZXIgaXMgbm90IGN1cnJlbnRseSBtYXJrZWQgYXMgc3BlbnQuAAAAABVyZWZyZXNoX251bGxpZmllcl90dGwAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAUFFeHRlbmQgdGhlIFRUTCBvZiB0aGUgQml0Y29pbiB0eGlkIOKGkiBjb21taXRtZW50IGRlZHVwIHJlY29yZC4KCklmIHRoaXMgZW50cnkgZXhwaXJlcywgdGhlIHNhbWUgQml0Y29pbiB0cmFuc2FjdGlvbiBjYW4gYmUgZGVwb3NpdGVkIGEKc2Vjb25kIHRpbWUsIGNyZWF0aW5nIGEgZHVwbGljYXRlIGNvbW1pdG1lbnQgYmFja2VkIGJ5IHRoZSBzYW1lIFVUWE8uCkNhbGwgdGhpcyBwZXJpb2RpY2FsbHkgZm9yIGFueSBhY3RpdmUgb3IgcmVjZW50bHktY2xvc2VkIGRlcG9zaXQuClJldHVybnMgZmFsc2UgaWYgdGhlIHR4aWQgaGFzIG5vdCBiZWVuIGRlcG9zaXRlZC4AAAAAAAAWcmVmcmVzaF9jb21taXRtZW50X3R0bAAAAAAAAQAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAV9FeHRlbmQgdGhlIFRUTCBvZiB0aGUgb24tY2hhaW4gTWVya2xlIHJvb3QgdG8gYW5vdGhlciAxODAtZGF5IHdpbmRvdy4KCklmIHRoZSByb290IGVudHJ5IGV4cGlyZXMsIGBzdG9yZWRfcm9vdGAgZmFsbHMgYmFjayB0byBgRU1QVFlfVFJFRV9ST09UYCwKbWFraW5nIGFsbCBleGlzdGluZyBwb3NpdGlvbiBwcm9vZnMgZmFpbCB3aXRoIGBSb290TWlzbWF0Y2hgIHVudGlsIHRoZQpyb290IGlzIHJlc3RvcmVkIGJ5IGEgbmV3IGJvcnJvdy9yZXBheS9pbnNlcnRfY29tbWl0bWVudC4gQ2FsbCB0aGlzIGFueQp0aW1lIHRoZSBwcm90b2NvbCBleHBlcmllbmNlcyBhbiBleHRlbmRlZCBwZXJpb2Qgb2YgaW5hY3Rpdml0eS4AAAAAF3JlZnJlc2hfbWVya2xlX3Jvb3RfdHRsAAAAAAAAAAAA",
        "AAAAAAAAAOxFeHRlbmQgdGhlIFRUTCBvZiBhIGxlbmRlcidzIHN1cHBseSBiYWxhbmNlIGVudHJ5LgoKTGVuZGVycyB3aG8gc3VwcGxpZWQgVVNEQyBhbmQgZG8gbm90IGludGVyYWN0IGZvciBhbiBleHRlbmRlZCBwZXJpb2QKcmlzayBoYXZpbmcgdGhlaXIgYmFsYW5jZSBlbnRyeSBleHBpcmUsIHByZXZlbnRpbmcgd2l0aGRyYXdhbC4KUmV0dXJucyBmYWxzZSBpZiB0aGUgbGVuZGVyIGhhcyBubyByZWNvcmRlZCBiYWxhbmNlLgAAABpyZWZyZXNoX3N1cHBseV9iYWxhbmNlX3R0bAAAAAAAAQAAAAAAAAAGbGVuZGVyAAAAAAATAAAAAQAAAAE=",
        "AAAABAAAAAAAAAAAAAAAE0NvbW1pdG1lbnRUcmVlRXJyb3IAAAAADwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAC5aSyBwcm9vZiBmYWlsZWQgb24tY2hhaW4gR3JvdGgxNiB2ZXJpZmljYXRpb24uAAAAAAAOSW52YWxpZFprUHJvb2YAAAAAAAQAAAA+YG9sZF9yb290YCBpbiB0aGUgcHJvb2YgZG9lcyBub3QgbWF0Y2ggdGhlIHN0b3JlZCBNZXJrbGUgcm9vdC4AAAAAAAxSb290TWlzbWF0Y2gAAAAFAAAAJlRoaXMgbnVsbGlmaWVyIGhhcyBhbHJlYWR5IGJlZW4gc3BlbnQuAAAAAAAVTnVsbGlmaWVyQWxyZWFkeVNwZW50AAAAAAAABgAAADRBIGRlcG9zaXQgd2l0aCB0aGUgc2FtZSBCaXRjb2luIHR4aWQgYWxyZWFkeSBleGlzdHMuAAAAEER1cGxpY2F0ZURlcG9zaXQAAAAHAAAAMFRoZSBjb21taXRtZW50IHdhcyBub3QgcmVnaXN0ZXJlZCB2aWEgYGRlcG9zaXRgLgAAABJDb21taXRtZW50Tm90Rm91bmQAAAAAAAgAAAAzVVNEQyBwb29sIGRvZXMgbm90IGhhdmUgZW5vdWdoIGF2YWlsYWJsZSBsaXF1aWRpdHkuAAAAABVJbnN1ZmZpY2llbnRMaXF1aWRpdHkAAAAAAAAJAAAASGBpc19ib3Jyb3dgIHNpZ25hbCBkb2Vzbid0IG1hdGNoIHRoZSBmdW5jdGlvbiBjYWxsZWQgKGJvcnJvdyB2cy4gcmVwYXkpLgAAABBXcm9uZ0NpcmN1aXRNb2RlAAAACgAAAIJBIHB1YmxpYyBwcm90b2NvbCBwYXJhbWV0ZXIgaW4gdGhlIHByb29mIChtaW5fcmF0aW9fYnAsIHRocmVzaG9sZCwgZXRjLikKZG9lcyBub3QgbWF0Y2ggdGhlIHZhbHVlIHN0b3JlZCBpbiB0aGUgY29udHJhY3QncyBjb25maWcuAAAAAAAVUHJvdG9jb2xQYXJhbU1pc21hdGNoAAAAAAAACwAAAElUaGUgQlRDL1VTRCBwcmljZSBpbiB0aGUgcHJvb2YgZG9lcyBub3QgbWF0Y2ggdGhlIG9yYWNsZSdzIGN1cnJlbnQgcHJpY2UuAAAAAAAADVByaWNlTWlzbWF0Y2gAAAAAAAAMAAAASlRoZSBCVEMgdHhpZCBlbmNvZGVkIGluIHRoZSBaSyBwcm9vZiBkb2VzIG5vdCBtYXRjaCB0aGUgU1BWLXZlcmlmaWVkIHR4aWQuAAAAAAAMVHhpZE1pc21hdGNoAAAADQAAAIBBIHNpZ25hbCB2YWx1ZSBpcyB0b28gbGFyZ2UgdG8gZXh0cmFjdCBhcyBhIFNvcm9iYW4tbmF0aXZlIGludGVnZXIuCkluZGljYXRlcyB0aGUgcHJvb2Ygd2FzIGNvbXB1dGVkIHdpdGggYW4gb3V0LW9mLXJhbmdlIHZhbHVlLgAAAA5TaWduYWxPdmVyZmxvdwAAAAAADgAAAD9XaXRoZHJhd2FsIGFtb3VudCBleGNlZWRzIHRoZSBzdXBwbGllcidzIG93biBkZXBvc2l0ZWQgYmFsYW5jZS4AAAAAFldpdGhkcmF3RXhjZWVkc0JhbGFuY2UAAAAAAA8=",
        "AAAAAQAAAC1Hcm90aDE2IHByb29mLiAgTWlycm9ycyBgemtfdmVyaWZpZXI6OlByb29mYC4AAAAAAAAAAAAABVByb29mAAAAAAAAAwAAAAAAAAAEcGlfYQAAB9AAAAAHRzFQb2ludAAAAAAAAAAABHBpX2IAAAfQAAAAB0cyUG9pbnQAAAAAAAAAAARwaV9jAAAH0AAAAAdHMVBvaW50AA==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAACQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAABhsaXF1aWRhdGlvbl90aHJlc2hvbGRfYnAAAAAEAAAAAAAAABdtaW5fY29sbGF0ZXJhbF9yYXRpb19icAAAAAAEAAAAAAAAABFtaW5fY29uZmlybWF0aW9ucwAAAAAAAAQAAAAAAAAAFG1pbl9kZXBvc2l0X3NhdG9zaGlzAAAABgAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAAAAAAxzcHZfY29udHJhY3QAAAATAAAAAAAAAAp1c2RjX3Rva2VuAAAAAAATAAAAAAAAAAt6a192ZXJpZmllcgAAAAAT",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAA/U2luZ2xldG9uOiBwcm90b2NvbCBjb25maWd1cmF0aW9uIChzZXQgb25jZSBhdCBpbml0aWFsaXphdGlvbikuAAAAAAZDb25maWcAAAAAAAAAAAAlU2luZ2xldG9uOiBhZ2dyZWdhdGUgVVNEQyBwb29sIHN0YXRlLgAAAAAAAARQb29sAAAAAAAAAEFUaGUgY3VycmVudCBQb3NlaWRvbiBNZXJrbGUgcm9vdCBvZiB0aGUgcG9zaXRpb24gY29tbWl0bWVudCB0cmVlLgAAAAAAAApNZXJrbGVSb290AAAAAAABAAAAO01hcmtzIGEgbnVsbGlmaWVyIGFzIHNwZW50LiAgRW50cnkgZXhpc3RlbmNlIG1lYW5zICJzcGVudCIuAAAAAA5TcGVudE51bGxpZmllcgAAAAAAAQAAA+4AAAAgAAAAAQAAAGpDb21taXRtZW50IHBlbmRpbmcgTWVya2xlIHRyZWUgaW5zZXJ0aW9uIGJ5IHRoZSByZWxheWVyLgpTZXQgYnkgYGRlcG9zaXRgLCBjbGVhcmVkIGJ5IGBpbnNlcnRfY29tbWl0bWVudGAuAAAAAAARUGVuZGluZ0NvbW1pdG1lbnQAAAAAAAABAAAD7gAAACAAAAABAAAALk1hcHMgYSBCaXRjb2luIHR4aWQgdG8gaXRzIGRlcG9zaXQgY29tbWl0bWVudC4AAAAAAAxUeENvbW1pdG1lbnQAAAABAAAD7gAAACAAAAABAAAAKlBlci1sZW5kZXIgVVNEQyBzdXBwbHkgYmFsYW5jZSBpbiBzdHJvb3BzLgAAAAAADVN1cHBseUJhbGFuY2UAAAAAAAABAAAAEw==",
        "AAAAAQAAAFhCTjI1NCBHMSBhZmZpbmUgcG9pbnQg4oCUIDY0IGJ5dGVzIChYIHx8IFksIGJpZy1lbmRpYW4pLgpNaXJyb3JzIGB6a192ZXJpZmllcjo6RzFQb2ludGAuAAAAAAAAAAdHMVBvaW50AAAAAAEAAAAAAAAABWJ5dGVzAAAAAAAD7gAAAEA=",
        "AAAAAQAAAGNCTjI1NCBHMiBhZmZpbmUgcG9pbnQg4oCUIDEyOCBieXRlcyAoWC5jMSB8fCBYLmMwIHx8IFkuYzEgfHwgWS5jMCkuCk1pcnJvcnMgYHprX3ZlcmlmaWVyOjpHMlBvaW50YC4AAAAAAAAAAAdHMlBvaW50AAAAAAEAAAAAAAAABWJ5dGVzAAAAAAAD7gAAAIA=",
        "AAAAAQAAAAAAAAAAAAAACVBvb2xTdGF0ZQAAAAAAAAIAAAAAAAAADnRvdGFsX2JvcnJvd2VkAAAAAAALAAAAAAAAAA50b3RhbF9zdXBwbGllZAAAAAAACw==",
        "AAAAAQAAAIlNaXJyb3JzIGBiaXRjb2luX3Nwdjo6VmVyaWZpY2F0aW9uUmVzdWx0YC4KRmllbGQgbmFtZXMgbXVzdCBtYXRjaCBleGFjdGx5IGZvciBYRFIgcm91bmQtdHJpcHBpbmcgdGhyb3VnaCB0aGUKY3Jvc3MtY29udHJhY3QgY2FsbCB0byB3b3JrLgAAAAAAAAAAAAAJU3B2UmVzdWx0AAAAAAAAAwAAAAAAAAAKYmxvY2tfaGFzaAAAAAAD7gAAACAAAAAAAAAADWNvbmZpcm1hdGlvbnMAAAAAAAAEAAAAAAAAAAR0eGlkAAAD7gAAACA=",
        "AAAABQAAANJFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciByZXBheXMgVVNEQyBkZWJ0IG9uIGEgWksgcG9zaXRpb24uCmBuZXdfY29tbWl0bWVudGAgZW5jb2RlcyB0aGUgdXBkYXRlZCAobG93ZXIpIGRlYnQg4oCUIGEgemVyby1kZWJ0IGNvbW1pdG1lbnQKc2lnbmFscyBmdWxsIHJlcGF5bWVudDsgdGhlIGJhY2tlbmQgY28tc2lnbnMgdGhlIEJUQyByZWxlYXNlIG9uIHNlZWluZyBpdC4AAAAAAAAAAAAKUmVwYXlFdmVudAAAAAAAAQAAAAVyZXBheQAAAAAAAAYAAAAAAAAACG5ld19yb290AAAD7gAAACAAAAABAAAAAAAAAAdyZXBheWVyAAAAABMAAAAAAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAAAAAANb2xkX251bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAAAAAAObmV3X2NvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAE5FbmNyeXB0ZWQgcG9zaXRpb24gbm90ZSBmb3IgdGhlIG5ldyAobG93ZXItZGVidCkgY29tbWl0bWVudC4gU2VlIERlcG9zaXRFdmVudC4AAAAAAAhlbmNfbm90ZQAAAA4AAAAAAAAAAg==",
        "AAAABQAAAHFFbWl0dGVkIHdoZW4gYSBib3Jyb3dlciBkcmF3cyBVU0RDIGFnYWluc3QgYSBaSyBwb3NpdGlvbi4KYG9sZF9udWxsaWZpZXJgIG1hcmtzIHRoZSBwcmV2aW91cyBjb21taXRtZW50IGFzIHNwZW50LgAAAAAAAAAAAAALQm9ycm93RXZlbnQAAAAAAQAAAAZib3Jyb3cAAAAAAAUAAAAAAAAACG5ld19yb290AAAD7gAAACAAAAABAAAAAAAAAAhib3Jyb3dlcgAAABMAAAAAAAAAAAAAAAt1c2RjX2Ftb3VudAAAAAALAAAAAAAAAAAAAAANb2xkX251bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAE9FbmNyeXB0ZWQgcG9zaXRpb24gbm90ZSBmb3IgdGhlIG5ldyAoaGlnaGVyLWRlYnQpIGNvbW1pdG1lbnQuIFNlZSBEZXBvc2l0RXZlbnQuAAAAAAhlbmNfbm90ZQAAAA4AAAAAAAAAAg==",
        "AAAABQAAAHlFbWl0dGVkIHdoZW4gYSBCVEMgZGVwb3NpdCBpcyBzdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBhbmQgdGhlIFpLCmNvbW1pdG1lbnQgaXMgcXVldWVkIGZvciBpbnNlcnRpb24gaW50byB0aGUgTWVya2xlIHRyZWUuAAAAAAAAAAAAAAxEZXBvc2l0RXZlbnQAAAABAAAAB2RlcG9zaXQAAAAABQAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAAAAAAAAAAAEdHhpZAAAA+4AAAAgAAAAAAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAA1E9wYXF1ZSBjaXBoZXJ0ZXh0IG9mIHRoZSBwb3NpdGlvbiBub3RlICh7Y29sbGF0ZXJhbCwgZGVidCwgbm9uY2UsIC4uLn0pCmVuY3J5cHRlZCB0byB0aGUgb3duZXIncyB2aWV3aW5nIGtleSwgZm9yIGNyb3NzLWRldmljZSByZWNvdmVyeS4gVGhlCmNvbnRyYWN0IG5ldmVyIGRlY3J5cHRzIGl0IOKAlCBpdCBvbmx5IGVjaG9lcyB0aGUgY2xpZW50LXN1cHBsaWVkIGJsb2IuAAAACGVuY19ub3RlAAAADgAAAAAAAAAC",
        "AAAABQAAAI5FbWl0dGVkIHdoZW4gYSBrZWVwZXIgbGlxdWlkYXRlcyBhbiB1bmRlcmNvbGxhdGVyYWxpemVkIFpLIHBvc2l0aW9uLgpUaGUgYmFja2VuZCBtb25pdG9ycyB0aGlzIGV2ZW50IHRvIGNvLXNpZ24gdGhlIEJUQyByZWxlYXNlIHRvIHRoZSBrZWVwZXIuAAAAAAAAAAAADkxpcXVpZGF0ZUV2ZW50AAAAAAABAAAACWxpcXVpZGF0ZQAAAAAAAAMAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAAAAAAJdXNkY19kZWJ0AAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAHBFbWl0dGVkIHdoZW4gdGhlIGFkbWluL3JlbGF5ZXIgaW5zZXJ0cyBhIHBlbmRpbmcgY29tbWl0bWVudCBpbnRvIHRoZQpvbi1jaGFpbiBNZXJrbGUgdHJlZSBhbmQgYWR2YW5jZXMgdGhlIHJvb3QuAAAAAAAAAA9JbnNlcnRMZWFmRXZlbnQAAAAAAQAAAAtpbnNlcnRfbGVhZgAAAAACAAAAAAAAAAhuZXdfcm9vdAAAA+4AAAAgAAAAAQAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAAg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    repay: this.txFromJSON<Result<void>>,
        borrow: this.txFromJSON<Result<void>>,
        deposit: this.txFromJSON<Result<Buffer>>,
        liquidate: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        supply_usdc: this.txFromJSON<Result<void>>,
        get_commitment: this.txFromJSON<Option<Buffer>>,
        get_pool_state: this.txFromJSON<readonly [i128, i128]>,
        get_merkle_root: this.txFromJSON<Buffer>,
        withdraw_supply: this.txFromJSON<Result<void>>,
        refresh_pool_ttl: this.txFromJSON<null>,
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