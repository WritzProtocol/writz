import { keccak_256 } from "@noble/hashes/sha3.js";
import type { SwapAsset, SwapAssetId } from "./assets";
import type { ReceiveIntent } from "./intent";
import { DEFAULT_SLIPPAGE_BP } from "./swap";

/**
 * How a borrower receives the loan. The debt is always USDC on Stellar; the
 * option only decides what reaches the borrower: the USDC itself, another
 * asset after a swap on Stellar (EURC, PYUSD, the USDT0 test token or XLM), or
 * USDC on Base Sepolia through Circle CCTP.
 */
export type ReceiveOption = "usdc" | SwapAssetId | "base";

export interface ReceiveChoice {
  id: ReceiveOption;
  label: string;
  /** The network it arrives on, as shown under the label. */
  network: string;
}

const USDC: ReceiveChoice = { id: "usdc", label: "USDC", network: "Stellar testnet" };
const BASE: ReceiveChoice = { id: "base", label: "USDC", network: "Base Sepolia testnet" };

/**
 * The options this build can deliver, in display order. USDC on Stellar is
 * always there, then each swap asset with a configured pool, stablecoins
 * first, then Base Sepolia when its transaction code is wired in (live, or the
 * mock harness).
 */
export function receiveOptions(f: { swap: readonly SwapAsset[]; cctp: boolean }): ReceiveChoice[] {
  const out = [USDC, ...f.swap.map(({ id, label, network }) => ({ id, label, network }))];
  if (f.cctp) out.push(BASE);
  return out;
}

export type EvmParse = { ok: true; address: `0x${string}` } | { ok: false; error: string };

/** EIP-55: a mixed-case address must carry a valid checksum; all lower or all upper case has none to check. */
function checksumOk(hex: string): boolean {
  const lower = hex.toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  for (let i = 0; i < 40; i++) {
    const c = hex[i]!;
    if (!/[a-fA-F]/.test(c)) continue;
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    if ((nibble >= 8) !== (c === c.toUpperCase())) return false;
  }
  return true;
}

/** A Base Sepolia destination: `0x` and 40 hex digits, checksum checked when mixed case, never the zero address. */
export function parseEvmAddress(input: string): EvmParse {
  const v = input.trim();
  if (!v) return { ok: false, error: "Enter the address that receives the USDC on Base Sepolia." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return { ok: false, error: "Enter an address that starts with 0x and has 40 more characters." };
  const hex = v.slice(2);
  if (/^0+$/.test(hex)) return { ok: false, error: "That is the zero address. Funds sent there are lost." };
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (mixed && !checksumOk(hex)) return { ok: false, error: "This address has a typo: its capital letters don't match its checksum." };
  return { ok: true, address: `0x${hex}` };
}

/** What the borrower picked before borrowing; `to` is the Base Sepolia address as typed. */
export interface ReceiveChoiceDraft {
  option: ReceiveOption;
  to: string;
}

export type ChoiceResult = { ok: true; intent: ReceiveIntent } | { ok: false; error: string };

/** The draft as the `ReceiveIntent` the borrow panel's step 2 runs, or why it can't be one yet. */
export function intentFor(d: ReceiveChoiceDraft, slippageBp = DEFAULT_SLIPPAGE_BP): ChoiceResult {
  switch (d.option) {
    case "usdc":
      return { ok: true, intent: { kind: "usdc" } };
    case "base": {
      const r = parseEvmAddress(d.to);
      return r.ok ? { ok: true, intent: { kind: "chain", recipient: r.address } } : { ok: false, error: r.error };
    }
    default:
      return { ok: true, intent: { kind: "swap", asset: d.option, slippageBp } };
  }
}
