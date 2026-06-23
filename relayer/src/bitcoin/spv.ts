/**
 * SPV proof assembly.
 *
 * Coordinates the Esplora API calls needed to produce a complete proof
 * bundle that can be submitted directly to the Writz `bitcoin-spv`
 * Soroban contract via `verify_transaction`.
 */

import { EsploraClient } from "./esplora.js";
import { stripWitness } from "./tx.js";

export interface SPVProofBundle {
  /** Transaction ID in display byte order (for human reference). */
  txid: string;

  /**
   * Raw transaction bytes WITHOUT witness data, as a hex string.
   *
   * This is the input to SHA256d that produces the txid in internal
   * byte order. Pass this directly to the Soroban contract's `raw_tx`
   * parameter.
   */
  rawTxNoWitness: string;

  /**
   * 0-based index of the transaction within its block.
   * Maps to the `tx_index` parameter of `verify_transaction`.
   */
  txIndex: number;

  /**
   * Sibling hashes for the Merkle inclusion proof, ordered leaf → root.
   * Each entry is a 32-byte hash as a 64-character hex string.
   *
   * Maps to the `merkle_proof` parameter of `verify_transaction`.
   */
  merkleProof: string[];

  /**
   * A contiguous chain of 80-byte block headers, each as a 160-character
   * hex string. `headers[0]` is the block containing the transaction;
   * subsequent headers provide confirmation depth.
   *
   * Maps to the `headers` parameter of `verify_transaction`.
   */
  headers: string[];

  /** Block height of the block containing the transaction. */
  blockHeight: number;

  /** Number of confirmation headers included (equals `headers.length`). */
  confirmations: number;
}

/**
 * Assembles a complete SPV proof bundle for the given txid.
 *
 * @param txid            - Transaction ID in display (reversed) byte order.
 * @param confirmations   - Number of block headers to include (≥ 1).
 * @param esplora         - Configured Esplora API client.
 * @throws If the transaction is unconfirmed, or if there are fewer
 *         confirmed blocks available than `confirmations` requests.
 */
export async function buildSPVProof(
  txid: string,
  confirmations: number,
  esplora: EsploraClient
): Promise<SPVProofBundle> {
  if (confirmations < 1) throw new Error("confirmations must be ≥ 1");

  // ── 1. Verify the transaction is confirmed ──────────────────────────────
  const txInfo = await esplora.getTxInfo(txid);
  if (!txInfo.status.confirmed || txInfo.status.block_height === null) {
    throw new UnconfirmedTxError(txid);
  }
  const blockHeight = txInfo.status.block_height;

  // ── 2. Check we have enough confirmations available ─────────────────────
  const tipHeight = await esplora.getTipHeight();
  const available = tipHeight - blockHeight + 1; // blocks from tx's block to tip
  if (available < confirmations) {
    throw new InsufficientConfirmationsError(txid, confirmations, available);
  }

  // ── 3. Fetch raw transaction and strip witness ───────────────────────────
  const rawTxFull = await esplora.getRawTx(txid);
  const rawTxNoWitness = stripWitness(rawTxFull);

  // ── 4. Fetch the Merkle inclusion proof ─────────────────────────────────
  const merkleProofData = await esplora.getMerkleProof(txid);

  // ── 5. Fetch the block header chain ─────────────────────────────────────
  //
  // We need `confirmations` headers starting from `blockHeight`.
  // Each header is fetched individually; the chain is assembled in order.
  //
  // Parallelise the header fetches to minimise latency.
  const headerHeights = Array.from(
    { length: confirmations },
    (_, i) => blockHeight + i
  );

  const blockHashes = await Promise.all(
    headerHeights.map((h) => esplora.getBlockHashAtHeight(h))
  );

  const headerHexes = await Promise.all(
    blockHashes.map((hash) => esplora.getBlockHeader(hash.trim()))
  );

  return {
    txid,
    rawTxNoWitness,
    txIndex: merkleProofData.pos,
    merkleProof: merkleProofData.merkle,
    headers: headerHexes.map((h) => h.trim()),
    blockHeight,
    confirmations,
  };
}

// ── Custom errors ────────────────────────────────────────────────────────────

export class UnconfirmedTxError extends Error {
  constructor(public readonly txid: string) {
    super(`Transaction ${txid} is not yet confirmed`);
    this.name = "UnconfirmedTxError";
  }
}

export class InsufficientConfirmationsError extends Error {
  constructor(
    public readonly txid: string,
    public readonly requested: number,
    public readonly available: number
  ) {
    super(
      `Requested ${requested} confirmations for ${txid}, but only ${available} available`
    );
    this.name = "InsufficientConfirmationsError";
  }
}
