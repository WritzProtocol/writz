import { config } from "@/config";
import type { ClassicAsset } from "@/lib/flows/trustline";

/** What step 2 can swap the borrowed USDC into on Stellar, through the Soroswap router. */
export type SwapAssetId = "eurc" | "pyusd" | "usdt0" | "xlm";

export interface SwapAsset {
  id: SwapAssetId;
  /** The ticker as the borrower reads it. */
  label: string;
  /** The line under the label in the chooser. */
  network: string;
  /** The token's Stellar Asset Contract: the router's path element. */
  token: string;
  /** The classic asset the wallet needs a trustline for; null for XLM, which needs none. */
  classic: ClassicAsset | null;
  /** True when it tracks the US dollar, so the debt in its terms barely moves. */
  usd: boolean;
}

const SWAP_IDS: readonly SwapAssetId[] = ["eurc", "pyusd", "usdt0", "xlm"];

export const isSwapAssetId = (v: string): v is SwapAssetId => (SWAP_IDS as readonly string[]).includes(v);

/** The asset for `id` on this deployment, or null when it is not configured here. */
export function swapAsset(id: SwapAssetId): SwapAsset | null {
  if (id === "xlm") {
    const token = config.receive.xlmToken;
    return token ? { id, label: "XLM", network: "Stellar testnet", token, classic: null, usd: false } : null;
  }
  const a = config.receive.swapAssets?.[id];
  if (!a?.token) return null;
  const classic = { code: a.code, issuer: a.issuer };
  switch (id) {
    case "eurc":
      return { id, label: "EURC", network: "Stellar testnet", token: a.token, classic, usd: false };
    case "pyusd":
      return { id, label: "PYUSD", network: "Stellar testnet", token: a.token, classic, usd: true };
    case "usdt0":
      // No official USDT0 exists on any testnet; the label says whose token it is.
      return { id, label: "USDT0", network: "Writz testnet token", token: a.token, classic, usd: true };
  }
}

/** The swap assets this deployment offers, in the configured order, skipping unknown or unconfigured ids. */
export function offeredSwapAssets(offer: readonly string[] = config.receive.swapOffer): SwapAsset[] {
  if (!config.receive.soroswapRouter) return [];
  const seen = new Set<SwapAssetId>();
  const out: SwapAsset[] = [];
  for (const id of offer) {
    if (!isSwapAssetId(id) || seen.has(id)) continue;
    seen.add(id);
    const a = swapAsset(id);
    if (a) out.push(a);
  }
  return out;
}

/** What a price move does to the debt, in the delivered asset's terms. */
export function debtLine(a: Pick<SwapAsset, "label" | "usd" | "id">): string {
  if (a.usd) return `Your debt stays in USDC. ${a.label} also tracks the dollar, so what you owe in ${a.label} terms barely moves.`;
  const what = a.id === "eurc" ? "the euro against the dollar" : `the price of ${a.label}`;
  return `Your debt stays in USDC; if ${what} moves, what you owe in ${a.label} terms changes.`;
}
