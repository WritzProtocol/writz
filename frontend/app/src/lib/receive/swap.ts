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

/** USDC to XLM on the direct pair; both legs are SACs with 7 decimals. */
export const usdcToXlmPath = (): string[] => [
  requireContract(config.contracts.usdcToken, "USDC token"),
  requireContract(config.receive.xlmToken, "XLM token"),
];

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

/** What `amountIn` stroops of USDC buy in XLM stroops right now, from the router's own pair reserves. */
export async function quoteUsdcToXlm(amountIn: bigint, path: string[] = usdcToXlmPath()): Promise<bigint> {
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
}

/**
 * Swap borrowed USDC for XLM through the Soroswap router. The quote is taken
 * again right before signing so the minimum reflects the pool as it is now.
 */
export async function swapUsdcToXlm(params: {
  owner: string;
  amountIn: bigint;
  slippageBp?: number;
  signTransaction: SignTransaction;
  emit?: Emit;
  now?: () => number;
}): Promise<SwapResult> {
  const { owner, amountIn, signTransaction, emit, slippageBp = DEFAULT_SLIPPAGE_BP, now = Date.now } = params;
  const path = usdcToXlmPath();

  emit?.({ type: "preparing", step: "reading" });
  const quotedOut = await quoteUsdcToXlm(amountIn, path);
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
  const { hash } = await signAndSubmit(tx, { signTransaction, emit });
  emit?.({ type: "settled", hash });
  return { hash, quotedOut, minOut: floor };
}
