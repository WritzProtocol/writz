/**
 * Keeps the on-chain bitcoin-spv light client fed with Bitcoin headers.
 *
 * bitcoin-spv only accepts a header that descends from one already stored,
 * so the store must hold every header from its checkpoint up to the tip.
 * This module plans contiguous batches of at most `maxPerSubmit` headers
 * and submits them in order. Pure planning and the sync loop take their
 * I/O as parameters, so the batching is unit-tested without a network.
 */

export interface HeaderBatch {
  /** First height in the batch (inclusive). */
  fromHeight: number;
  /** Last height in the batch (inclusive). */
  toHeight: number;
}

/** Splits [fromHeight, toHeight] into contiguous batches of ≤ maxPerSubmit. */
export function planHeaderBatches(
  fromHeight: number,
  toHeight: number,
  maxPerSubmit: number,
): HeaderBatch[] {
  if (!Number.isInteger(maxPerSubmit) || maxPerSubmit < 1) {
    throw new RangeError(`maxPerSubmit must be a positive integer, got ${maxPerSubmit}`);
  }
  const batches: HeaderBatch[] = [];
  for (let start = fromHeight; start <= toHeight; start += maxPerSubmit) {
    batches.push({ fromHeight: start, toHeight: Math.min(start + maxPerSubmit - 1, toHeight) });
  }
  return batches;
}

export interface HeaderSyncDeps {
  /** Raw 80-byte header hex for a height. */
  getHeaderHex: (height: number) => Promise<string>;
  /** Submits one contiguous run of headers (hex strings) to bitcoin-spv. */
  submitHeaders: (headersHex: string[]) => Promise<void>;
}

/**
 * Submits every header from `fromHeight` to `toHeight` in order. Stops at the
 * first failed batch and returns how far it got, so a retry resumes there.
 */
export async function syncHeaders(
  fromHeight: number,
  toHeight: number,
  maxPerSubmit: number,
  deps: HeaderSyncDeps,
): Promise<{ submittedThrough: number | null }> {
  let submittedThrough: number | null = null;
  for (const batch of planHeaderBatches(fromHeight, toHeight, maxPerSubmit)) {
    const headers: string[] = [];
    for (let h = batch.fromHeight; h <= batch.toHeight; h++) {
      headers.push(await deps.getHeaderHex(h));
    }
    await deps.submitHeaders(headers);
    submittedThrough = batch.toHeight;
  }
  return { submittedThrough };
}
