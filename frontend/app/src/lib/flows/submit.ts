import { resolveContractError, type ContractName } from "@/lib/errors/contract";
import { errorMessage } from "@/lib/wallet/rejection";

/**
 * Retry a contract simulation that fails for transient reasons - mainly RPC
 * state lag right after a prior action (for the Lend tab's commitment tree, a
 * new Merkle root may not have propagated to the simulation view yet), account
 * concurrency, or a stale sequence. Nothing is re-signed across attempts.
 *
 * Genuine errors (a truly stale local position, insufficient liquidity, an
 * unfunded account, etc.) surface at once or after the attempts are exhausted.
 * "Account not found" must not count as transient: an unfunded account would
 * otherwise wait out every attempt before the user learns to fund it.
 */
export function isTransientSimulationError(message: string, contract: ContractName = "commitment-tree"): boolean {
  const failure = resolveContractError(message, undefined, contract);
  if (failure) return failure.contract === "commitment-tree" && failure.variant === "RootMismatch";
  return /RootMismatch|TRY_AGAIN_LATER|txBadSeq/.test(message);
}

// RPC state lag after a prior action can take longer than a few seconds to clear
// (notably borrow-right-after-repay), so we stay patient: ~30s total across
// attempts with a gentle progressive backoff, capped per wait.
export async function simulateWithRetry<T>(
  build: () => Promise<T>,
  attempts = 8,
  baseDelayMs = 2500,
  maxDelayMs = 6000,
  contract: ContractName = "commitment-tree",
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await build();
    } catch (e) {
      lastErr = e;
      if (isTransientSimulationError(errorMessage(e), contract) && i < attempts) {
        const delay = Math.min(baseDelayMs + (i - 1) * 1000, maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** `simulateWithRetry` for a `writz-lend` call: its contract errors are never state lag. */
export const simulateWritzLend = <T>(build: () => Promise<T>): Promise<T> =>
  simulateWithRetry(build, undefined, undefined, undefined, "writz-lend");
