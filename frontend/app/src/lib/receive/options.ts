import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * How a borrower receives the loan. The debt is always USDC on Stellar; the
 * option only decides what reaches the borrower: the USDC itself, XLM after a
 * swap on Stellar, or USDC on Base Sepolia through Circle CCTP.
 */
export type ReceiveOption = "usdc" | "xlm" | "base" | "eurc";

export interface ReceiveChoice {
  id: ReceiveOption;
  label: string;
  /** The network it arrives on, as shown under the label. */
  network: string;
}

const CHOICES: Record<ReceiveOption, ReceiveChoice> = {
  usdc: { id: "usdc", label: "USDC", network: "Stellar testnet" },
  xlm: { id: "xlm", label: "XLM", network: "Stellar testnet" },
  base: { id: "base", label: "USDC", network: "Base Sepolia testnet" },
  eurc: { id: "eurc", label: "EURC", network: "Stellar testnet" },
};

/**
 * The options this build can deliver, in display order. USDC on Stellar is
 * always there. XLM and Base Sepolia appear only when their transaction code
 * is wired in (live, or the mock harness); EURC only behind its flag, since
 * it has no usable testnet liquidity.
 */
export function receiveOptions(f: { swap: boolean; cctp: boolean; eurc: boolean }): ReceiveChoice[] {
  const out = [CHOICES.usdc];
  if (f.swap) out.push(CHOICES.xlm);
  if (f.cctp) out.push(CHOICES.base);
  if (f.eurc) out.push(CHOICES.eurc);
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
