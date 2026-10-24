import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { bytesToHex, hexToBytes, isHash, reverseHex } from "./hex.js";
import { ContractCaller, type ContractClientOptions } from "./soroban.js";
import type { BestTip, Checkpoint, HeaderEntry, SorobanArgs, VerificationResult } from "./types.js";

const bytes = (hex: string) => nativeToScVal(hexToBytes(hex));
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });

function hash(hex: string, what: string): xdr.ScVal {
  if (!isHash(hex)) throw new TypeError(`${what} must be 64 hex characters`);
  return bytes(hex);
}

/** The `verify_transaction` arguments as XDR, in contract order. */
export function verifyTransactionArgs(args: SorobanArgs): xdr.ScVal[] {
  if (!Number.isInteger(args.min_confirmations) || args.min_confirmations < 1) {
    throw new RangeError("min_confirmations must be an integer >= 1");
  }
  return [
    hash(args.block_hash, "block_hash"),
    xdr.ScVal.scvVec(args.merkle_proof.map((h) => hash(h, "merkle_proof item"))),
    u32(args.tx_index),
    bytes(args.raw_tx),
    u32(args.min_confirmations),
  ];
}

type Raw = Record<string, unknown>;
const hexOf = (v: unknown) => bytesToHex(v as Uint8Array);

export function decodeVerificationResult(v: unknown): VerificationResult {
  const r = v as Raw;
  const txid = hexOf(r.txid);
  return {
    txid,
    txidDisplay: reverseHex(txid),
    blockHash: hexOf(r.block_hash),
    blockHeight: Number(r.block_height),
    confirmations: Number(r.confirmations),
  };
}

/**
 * Client for the `bitcoin-spv` light client. Every method is a simulated
 * read except `buildVerifyTransaction`. Hashes are hex in internal byte
 * order, the contract's own order; use `reverseHex` for explorer order.
 */
export class BitcoinSpvClient {
  private readonly c: ContractCaller;

  constructor(opts: ContractClientOptions) {
    this.c = new ContractCaller("bitcoin-spv", opts.contractId ?? opts.network.contracts.bitcoinSpv, opts);
  }

  get contractId(): string {
    return this.c.contractId;
  }

  /**
   * Proves a transaction is in a block of the most-work chain with at least
   * `min_confirmations` confirmations. Pass the relayer's `sorobanArgs`
   * unchanged; `minConfirmations` overrides its `min_confirmations`.
   * Throws `ContractError` (code 22 HeaderNotFound, 2 InsufficientConfirmations, ...).
   *
   * Inclusion only: check the outputs (amount, scriptPubKey) yourself.
   */
  async verifyTransaction(args: SorobanArgs, minConfirmations?: number): Promise<VerificationResult> {
    const a = minConfirmations === undefined ? args : { ...args, min_confirmations: minConfirmations };
    return decodeVerificationResult(await this.c.read("verify_transaction", ...verifyTransactionArgs(a)));
  }

  /**
   * An unsigned `verify_transaction` transaction for `source` (base64 XDR),
   * for when the verification has to be recorded on chain. Most callers only
   * need `verifyTransaction`.
   */
  async buildVerifyTransaction(source: string, args: SorobanArgs): Promise<string> {
    return this.c.prepare(source, "verify_transaction", ...verifyTransactionArgs(args));
  }

  /** The tip of the most-work chain, or `null` before the checkpoint is set. */
  async getBestTip(): Promise<BestTip | null> {
    const r = (await this.c.read("get_best_tip")) as Raw | null | undefined;
    if (!r) return null;
    return { hash: hexOf(r.hash), height: Number(r.height), chainwork: BigInt(r.chainwork as bigint) };
  }

  /** The trust root. Only blocks after it can be proven. */
  async getCheckpoint(): Promise<Checkpoint | null> {
    const r = (await this.c.read("get_checkpoint")) as Raw | null | undefined;
    if (!r) return null;
    return {
      height: Number(r.height),
      blockHash: hexOf(r.block_hash),
      bits: Number(r.bits),
      time: Number(r.time),
      periodStartTime: Number(r.period_start_time),
      setAtLedger: Number(r.set_at_ledger),
    };
  }

  /** The stored header for a block hash (internal order), or `null`. */
  async getHeader(blockHash: string): Promise<HeaderEntry | null> {
    const r = (await this.c.read("get_header", hash(blockHash, "blockHash"))) as Raw | null | undefined;
    if (!r) return null;
    return {
      prev: hexOf(r.prev),
      merkleRoot: hexOf(r.merkle_root),
      height: Number(r.height),
      bits: Number(r.bits),
      time: Number(r.time),
      periodStartTime: Number(r.period_start_time),
      chainwork: BigInt(r.chainwork as bigint),
    };
  }

  /** The most-work chain's block hash (internal order) at a height, or `null`. */
  async getCanonicalHash(height: number): Promise<string | null> {
    const r = await this.c.read("get_canonical_hash", u32(height));
    return r ? hexOf(r) : null;
  }
}
