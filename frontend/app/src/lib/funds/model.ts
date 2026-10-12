import { parseUsdcAmount } from "@/lib/loan/model";

/** Money going into the vault or pool, or coming back out. */
export type FundsSide = "in" | "out";

export interface Withdrawable {
  stroops: bigint;
  /** Pool liquidity, not the user's balance, is what caps it. */
  limitedByPool: boolean;
}

/** What can come out now: the user's balance, capped by what the pool has not lent out. */
export function withdrawable(held: bigint, liquidity: bigint | null): Withdrawable {
  if (liquidity === null || liquidity >= held) return { stroops: held, limitedByPool: false };
  return { stroops: liquidity > 0n ? liquidity : 0n, limitedByPool: true };
}

export type AmountCheck = { ok: true; stroops: bigint } | { ok: false; error: string };

/** Parses the field and checks it against the side's cap; an unknown cap is left to the contract. */
export function checkAmount(input: string, max: bigint | null, over: (max: bigint) => string): AmountCheck {
  const parsed = parseUsdcAmount(input);
  if (!parsed.ok) return parsed;
  if (max !== null && parsed.stroops > max) return { ok: false, error: over(max) };
  return { ok: true, stroops: parsed.stroops };
}
