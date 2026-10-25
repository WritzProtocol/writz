/**
 * Receive as XLM: the borrowed USDC swapped on Stellar through the Soroswap
 * router, as a second transaction after the borrow. The UI codes against
 * `SwapApi`; the transaction itself lives in its implementation.
 */

export interface SwapQuote {
  /** USDC in, stroops. */
  amountInStroops: bigint;
  /** XLM out at the quoted reserves, stroops. */
  amountOutStroops: bigint;
  /** The least XLM the swap accepts; below it the transaction fails and nothing moves. */
  minOutStroops: bigint;
  slippageBp: number;
  /** Unix ms. */
  quotedAt: number;
}

export interface SwapApi {
  quote(usdcStroops: bigint): Promise<SwapQuote>;
  /** Builds, has `owner` sign and submits the swap; resolves with the Stellar transaction hash once it settles. */
  execute(quote: SwapQuote, owner: string): Promise<{ hash: string }>;
}

/** A quote older than this is fetched again before signing. */
export const QUOTE_MAX_AGE_MS = 15_000;

export function minOutFor(amountOutStroops: bigint, slippageBp: number): bigint {
  return (amountOutStroops * BigInt(10_000 - slippageBp)) / 10_000n;
}

export function quoteFresh(q: SwapQuote, now: number, maxAgeMs = QUOTE_MAX_AGE_MS): boolean {
  return now - q.quotedAt >= 0 && now - q.quotedAt <= maxAgeMs;
}

/** "1.5%" from 150 basis points. */
export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2)}%`;
}
