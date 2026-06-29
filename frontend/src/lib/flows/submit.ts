/**
 * Retry a contract simulation that fails for transient reasons — mainly RPC
 * state lag right after a prior action (the new Merkle root / nullifier may not
 * have propagated to the simulation view yet), account concurrency, or a stale
 * sequence. The proof is reused across attempts (no re-proving, no re-signing).
 *
 * Genuine errors (a truly stale local position, insufficient liquidity, etc.)
 * still surface after the attempts are exhausted.
 */
const TRANSIENT =
  /Error\(Contract, #5\)|RootMismatch|TRY_AGAIN_LATER|txBadSeq|NotFound|not found/i;

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
      const msg = e instanceof Error ? e.message : String(e);
      if (TRANSIENT.test(msg) && i < attempts) {
        const delay = Math.min(baseDelayMs + (i - 1) * 1000, maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
