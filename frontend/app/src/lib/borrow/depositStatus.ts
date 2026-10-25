/**
 * What the deposit status card shows: how many Bitcoin confirmations the
 * deployment requires, and how far the deposit is.
 */

const MAX_CONFIRMATIONS = 100;

const valid = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_CONFIRMATIONS;

/**
 * Confirmations required before the SPV proof is accepted. A count the
 * deployment reports (the relayer, or the saved deposit) wins, in the order
 * given; otherwise the configured `config.bitcoin.minConfirmations`. Null
 * when none of them is a usable count, so the card says "Checking" instead
 * of inventing one.
 */
export function confirmationTarget(reported: readonly (number | null | undefined)[], configured: number): number | null {
  return reported.find(valid) ?? (valid(configured) ? configured : null);
}

export type DepositStage =
  /** On Bitcoin, `n` of `m` confirmations. */
  | { kind: "confirming"; n: number; m: number }
  /** Enough confirmations; the SPV proof is not on Stellar yet. */
  | { kind: "ready" }
  /** `writz-lend` accepted the SPV proof in a Stellar transaction. */
  | { kind: "verified" };

/**
 * The deposit card's stage. `verified` only once a Stellar transaction that
 * registered the deposit exists, never from the confirmation count alone.
 */
export function depositStage(args: { n: number | null; m: number | null; stellarTxHash: string | null }): DepositStage | null {
  if (args.stellarTxHash) return { kind: "verified" };
  if (args.n === null || args.m === null) return null;
  const n = Math.max(0, Math.min(args.n, args.m));
  return n >= args.m ? { kind: "ready" } : { kind: "confirming", n, m: args.m };
}
