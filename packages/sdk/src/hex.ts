const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

/** Hex string to bytes. Throws on odd length or a non-hex character. */
export function hexToBytes(hex: string): Uint8Array {
  if (!HEX_RE.test(hex)) throw new TypeError(`not a hex string: ${hex.slice(0, 16)}...`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Reverses the byte order of a hex hash. Converts a txid or block hash
 * between display order (explorers, the relayer's `txid` input) and internal
 * order (`bitcoin-spv` arguments and results). Its own inverse.
 */
export function reverseHex(hex: string): string {
  return bytesToHex(hexToBytes(hex).reverse());
}

/** 64 hex characters. */
export function isHash(hex: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(hex);
}
