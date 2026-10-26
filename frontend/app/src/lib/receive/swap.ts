import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";
import type { Emit } from "@/lib/flow/engine";
import { signAndSubmit } from "@/lib/flow/stellarTx";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import { callContract } from "./call";

/** 0.5%: the default the swap screen offers. */
export const DEFAULT_SLIPPAGE_BP = 50;
export const MAX_SLIPPAGE_BP = 500;
const DEADLINE_SECONDS = 300;

const routerId = () => requireContract(config.receive.soroswapRouter, "Soroswap router");

/** USDC to `token` on their direct pair; every leg is a SAC with 7 decimals. */
export const usdcToPath = (token: string): string[] => [requireContract(config.contracts.usdcToken, "USDC token"), token];

/** USDC to XLM on the direct pair. */
export const usdcToXlmPath = (): string[] => usdcToPath(requireContract(config.receive.xlmToken, "XLM token"));

/** The least the swap may return before it reverts: `quoted` less `slippageBp`, rounded down. */
export function minOut(quoted: bigint, slippageBp: number): bigint {
  if (!Number.isInteger(slippageBp) || slippageBp < 0 || slippageBp > MAX_SLIPPAGE_BP) {
    throw new Error(`Slippage must be a whole number of basis points from 0 to ${MAX_SLIPPAGE_BP}.`);
  }
  return (quoted * BigInt(10_000 - slippageBp)) / 10_000n;
}

/** Unix seconds after which the router refuses the swap. */
export const swapDeadline = (nowMs: number, seconds = DEADLINE_SECONDS): bigint =>
  BigInt(Math.floor(nowMs / 1000) + seconds);

const pathScVal = (path: string[]) => nativeToScVal(path.map((p) => Address.fromString(p)));

/** What `amountIn` stroops of USDC buy at the end of `path` right now, from the router's own pair reserves. */
export async function quoteUsdcTo(amountIn: bigint, path: string[]): Promise<bigint> {
  if (amountIn <= 0n) throw new Error("Enter an amount above 0.");
  const tx = await callContract<bigint[]>({
    contractId: routerId(),
    method: "router_get_amounts_out",
    args: [nativeToScVal(amountIn, { type: "i128" }), pathScVal(path)],
  });
  const amounts = tx.result;
  const out = amounts[amounts.length - 1];
  if (out === undefined) throw new Error("The router returned no quote.");
  return BigInt(out);
}

export interface SwapResult {
  hash: string;
  quotedOut: bigint;
  minOut: bigint;
  /** Stroops of the bought asset the router paid, from the transaction result. */
  received: bigint | null;
}

/**
 * Swap borrowed USDC for the asset at the end of `path` through the Soroswap
 * router. The quote is taken again right before signing so the minimum
 * reflects the pool as it is now.
 */
export async function swapUsdcTo(params: {
  owner: string;
  path: string[];
  amountIn: bigint;
  slippageBp?: number;
  signTransaction: SignTransaction;
  emit?: Emit;
  now?: () => number;
}): Promise<SwapResult> {
  const { owner, path, amountIn, signTransaction, emit, slippageBp = DEFAULT_SLIPPAGE_BP, now = Date.now } = params;

  emit?.({ type: "preparing", step: "reading" });
  const quotedOut = await quoteUsdcTo(amountIn, path);
  const floor = minOut(quotedOut, slippageBp);

  emit?.({ type: "preparing", step: "building" });
  const tx = await callContract<bigint[]>({
    contractId: routerId(),
    method: "swap_exact_tokens_for_tokens",
    publicKey: owner,
    args: [
      nativeToScVal(amountIn, { type: "i128" }),
      nativeToScVal(floor, { type: "i128" }),
      pathScVal(path),
      Address.fromString(owner).toScVal(),
      nativeToScVal(swapDeadline(now()), { type: "u64" }),
    ],
  });
  const { hash, sent } = await signAndSubmit(tx, { signTransaction, emit });
  emit?.({ type: "settled", hash });
  const amounts = sent.result;
  const out = Array.isArray(amounts) ? amounts[amounts.length - 1] : undefined;
  return { hash, quotedOut, minOut: floor, received: out === undefined ? null : BigInt(out) };
}

/** XLM to USDC on the same pair, for topping up a repayment. */
export const xlmToUsdcPath = (): string[] => [...usdcToXlmPath()].reverse();

/** The most `slippageBp` lets the swap take: `quoted` plus slippage, rounded up. */
export function maxIn(quoted: bigint, slippageBp: number): bigint {
  if (!Number.isInteger(slippageBp) || slippageBp < 0 || slippageBp > MAX_SLIPPAGE_BP) {
    throw new Error(`Slippage must be a whole number of basis points from 0 to ${MAX_SLIPPAGE_BP}.`);
  }
  return (quoted * BigInt(10_000 + slippageBp) + 9_999n) / 10_000n;
}

/** XLM stroops it takes right now to receive exactly `amountOut` USDC stroops. */
export async function quoteXlmForUsdc(amountOut: bigint, path: string[] = xlmToUsdcPath()): Promise<bigint> {
  if (amountOut <= 0n) throw new Error("Enter an amount above 0.");
  const tx = await callContract<bigint[]>({
    contractId: routerId(),
    method: "router_get_amounts_in",
    args: [nativeToScVal(amountOut, { type: "i128" }), pathScVal(path)],
  });
  const first = tx.result[0];
  if (first === undefined) throw new Error("The router returned no quote.");
  return BigInt(first);
}

/**
 * Buys exactly `amountOut` USDC with XLM through the Soroswap router, so a
 * borrower who holds only what they borrowed can cover the interest and
 * repay in full. The quote is taken right before signing.
 */
export async function buyUsdcWithXlm(params: {
  owner: string;
  amountOut: bigint;
  slippageBp?: number;
  signTransaction: SignTransaction;
  emit?: Emit;
  now?: () => number;
}): Promise<{ hash: string; maxIn: bigint }> {
  const { owner, amountOut, signTransaction, emit, slippageBp = DEFAULT_SLIPPAGE_BP, now = Date.now } = params;
  const path = xlmToUsdcPath();

  emit?.({ type: "preparing", step: "reading" });
  const ceiling = maxIn(await quoteXlmForUsdc(amountOut, path), slippageBp);

  emit?.({ type: "preparing", step: "building" });
  const tx = await callContract<bigint[]>({
    contractId: routerId(),
    method: "swap_tokens_for_exact_tokens",
    publicKey: owner,
    args: [
      nativeToScVal(amountOut, { type: "i128" }),
      nativeToScVal(ceiling, { type: "i128" }),
      pathScVal(path),
      Address.fromString(owner).toScVal(),
      nativeToScVal(swapDeadline(now()), { type: "u64" }),
    ],
  });
  const { hash } = await signAndSubmit(tx, { signTransaction, emit });
  emit?.({ type: "settled", hash });
  return { hash, maxIn: ceiling };
}
