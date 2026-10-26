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
 * Runs `fn`, retrying with exponential backoff while `isRetryable` accepts
 * the error (an Esplora 429, in practice: a sync from an old checkpoint asks
 * for hundreds of headers in a row and public Esplora instances throttle
 * that). Throws the last error once `retries` are spent.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: (e: unknown) => boolean,
  { retries = 5, baseDelayMs = 1_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * How many blocks below bitcoin-spv's best tip each sync pass starts. The
 * contract skips headers it already stores, so this costs one cheap batch,
 * and it lets a Bitcoin reorg of up to this depth extend the new branch from
 * a parent the contract knows.
 */
export const REORG_RESUBMIT_DEPTH = 6;

/**
 * Where a sync pass starts: just below the contract's best tip, never before
 * the configured start height. Without the tip (nothing synced yet, or the
 * read failed) it starts from the configured height.
 */
export function syncStartHeight(configuredFrom: number, contractTipHeight: number | undefined): number {
  if (contractTipHeight === undefined) return configuredFrom;
  return Math.max(configuredFrom, contractTipHeight - REORG_RESUBMIT_DEPTH);
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

/** A chain tip: height and block hash, hex in Esplora's display byte order. */
export interface ChainTip {
  height: number;
  hash: string;
}

/**
 * Whether a sync pass has anything to store. bitcoin-spv skips headers it
 * already holds but still charges for the call, so a pass with no new block
 * only costs fees: before this check, about nine in ten calls on testnet
 * stored nothing.
 *
 * Submits when the contract has no tip yet, when the Bitcoin source is
 * higher, or when both are at the same height on different blocks (a
 * same-height reorg: the resubmitted range carries the competing branch).
 * Skips when the source is at the contract's tip or behind it.
 */
export function hasNewHeaders(bitcoinTip: ChainTip, contractTip: ChainTip | undefined): boolean {
  if (contractTip === undefined) return true;
  if (bitcoinTip.height > contractTip.height) return true;
  if (bitcoinTip.height < contractTip.height) return false;
  return bitcoinTip.hash.toLowerCase() !== contractTip.hash.toLowerCase();
}

/** 32-byte hash in the contract's internal byte order, as Esplora's display hex. */
export function internalHashToDisplayHex(hash: Uint8Array): string {
  return Buffer.from(hash).reverse().toString("hex");
}

/** Stroops as an XLM string with seven decimals, for logs and /health. */
export function stroopsToXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / 10_000_000n;
  const frac = (abs % 10_000_000n).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Thrown when a simulated submit_headers would cost more than the configured
 * ceiling. Nothing is sent; the next pass simulates again, so the sync
 * resumes on its own once network fees fall back under the ceiling.
 */
export class FeeCeilingExceededError extends Error {
  constructor(
    readonly feeStroops: bigint,
    readonly maxFeeStroops: bigint,
  ) {
    super(
      `submit_headers would cost ${stroopsToXlm(feeStroops)} XLM, above the ${stroopsToXlm(maxFeeStroops)} XLM ceiling (SPV_MAX_FEE_XLM)`,
    );
    this.name = "FeeCeilingExceededError";
  }
}

/** Throws FeeCeilingExceededError when `feeStroops` is above `maxFeeStroops`. */
export function assertWithinFeeCeiling(feeStroops: bigint, maxFeeStroops: bigint): void {
  if (feeStroops > maxFeeStroops) throw new FeeCeilingExceededError(feeStroops, maxFeeStroops);
}

/** Header sync state reported by GET /health. Amounts are XLM strings. */
export interface HeaderSyncStatus {
  enabled: boolean;
  lastPassAt: string | null;
  bitcoinTipHeight: number | null;
  contractTipHeight: number | null;
  lastSubmittedThrough: number | null;
  lastSubmissionAt: string | null;
  lastFeeXlm: string | null;
  maxFeeXlm: string | null;
  submissions: number;
  skippedNoNewHeaders: number;
  skippedFeeCeiling: number;
  lastFeeCeilingSkip: { at: string; feeXlm: string } | null;
  relayerBalanceXlm: string | null;
  minBalanceXlm: string | null;
  balanceLow: boolean;
  lastError: string | null;
}

export const headerSyncStatus: HeaderSyncStatus = {
  enabled: false,
  lastPassAt: null,
  bitcoinTipHeight: null,
  contractTipHeight: null,
  lastSubmittedThrough: null,
  lastSubmissionAt: null,
  lastFeeXlm: null,
  maxFeeXlm: null,
  submissions: 0,
  skippedNoNewHeaders: 0,
  skippedFeeCeiling: 0,
  lastFeeCeilingSkip: null,
  relayerBalanceXlm: null,
  minBalanceXlm: null,
  balanceLow: false,
  lastError: null,
};

/**
 * Records the relayer account balance and reports whether it is under the
 * alert threshold. The caller logs the alert at error level on every pass
 * while this returns true, so log-based alerting sees it until it is topped up.
 */
export function recordRelayerBalance(
  status: HeaderSyncStatus,
  balanceStroops: bigint,
  minBalanceStroops: bigint,
): boolean {
  status.relayerBalanceXlm = stroopsToXlm(balanceStroops);
  status.minBalanceXlm = stroopsToXlm(minBalanceStroops);
  status.balanceLow = balanceStroops < minBalanceStroops;
  return status.balanceLow;
}
