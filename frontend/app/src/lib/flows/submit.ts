import { errorMessage } from "@/lib/wallet/rejection";

/**
 * Retry a contract simulation that fails for transient reasons - mainly RPC
 * state lag right after a prior action, account concurrency, or a stale
 * sequence. Nothing is re-signed across attempts.
 *
 * Genuine errors (a truly stale local position, insufficient liquidity, an
 * unfunded account, etc.) surface at once or after the attempts are exhausted.
 * "Account not found" must not count as transient: an unfunded account would
 * otherwise wait out every attempt before the user learns to fund it.
 */
export function isTransientSimulationError(message: string): boolean {
  return /TRY_AGAIN_LATER|txBadSeq/.test(message);
}

// RPC state lag after a prior action can take longer than a few seconds to clear
// (notably borrow-right-after-repay), so we stay patient: ~30s total across
// attempts with a gentle progressive backoff, capped per wait.
export async function simulateWithRetry<T>(
  build: () => Promise<T>,
  attempts = 8,
  baseDelayMs = 2500,
  maxDelayMs = 6000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await build();
    } catch (e) {
      lastErr = e;
      if (isTransientSimulationError(errorMessage(e)) && i < attempts) {
        const delay = Math.min(baseDelayMs + (i - 1) * 1000, maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** `simulateWithRetry` for a `writz-lend` call. */
export const simulateWritzLend = <T>(build: () => Promise<T>): Promise<T> =>
  simulateWithRetry(build);
