import { describe, expect, test } from "bun:test";
import { formatBp } from "./format";
import type { SwapAsset, SwapAssetId } from "./assets";
import { intentFor, parseEvmAddress, receiveOptions } from "./options";

const asset = (id: SwapAssetId, label: string, usd: boolean): SwapAsset => ({
  id,
  label,
  network: id === "usdt0" ? "Writz testnet token" : "Stellar testnet",
  token: "C" + id,
  classic: id === "xlm" ? null : { code: label, issuer: "G" + id },
  usd,
});
const SWAP = [asset("eurc", "EURC", false), asset("pyusd", "PYUSD", true), asset("usdt0", "USDT0", true), asset("xlm", "XLM", false)];

describe("receiveOptions", () => {
  test("USDC on Stellar is always offered, the others only when wired", () => {
    expect(receiveOptions({ swap: [], cctp: false }).map((o) => o.id)).toEqual(["usdc"]);
    expect(receiveOptions({ swap: SWAP, cctp: true }).map((o) => o.id)).toEqual(["usdc", "eurc", "pyusd", "usdt0", "xlm", "base"]);
  });

  test("every option names a testnet network", () => {
    for (const o of receiveOptions({ swap: SWAP, cctp: true })) expect(o.network).toMatch(/testnet/);
  });
});
describe("parseEvmAddress", () => {
  test("accepts a valid EIP-55 checksummed address", () => {
    const r = parseEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(r).toEqual({ ok: true, address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" });
  });

  test("accepts all lower or all upper case, which carry no checksum", () => {
    expect(parseEvmAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed").ok).toBe(true);
    expect(parseEvmAddress(" 0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED ").ok).toBe(true);
  });

  test("rejects a mixed-case address with a wrong checksum", () => {
    const r = parseEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/checksum/);
  });

  test("rejects empty, short, non-hex and zero addresses", () => {
    for (const v of ["", "0x123", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xZZaeb6053f3e94c9b9a09f33669435e7ef1beaed"]) {
      expect(parseEvmAddress(v).ok).toBe(false);
    }
    const zero = parseEvmAddress("0x" + "0".repeat(40));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toMatch(/zero address/);
  });
});

describe("intentFor", () => {
  test("USDC and every swap asset need nothing more", () => {
    expect(intentFor({ option: "usdc", to: "" })).toEqual({ ok: true, intent: { kind: "usdc" } });
    for (const a of ["eurc", "pyusd", "usdt0", "xlm"] as const) {
      expect(intentFor({ option: a, to: "" }, 50)).toEqual({ ok: true, intent: { kind: "swap", asset: a, slippageBp: 50 } });
    }
  });

  test("Base Sepolia needs a valid address and carries it as the recipient", () => {
    expect(intentFor({ option: "base", to: " 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed " })).toEqual({
      ok: true,
      intent: { kind: "chain", recipient: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" },
    });
    expect(intentFor({ option: "base", to: "" }).ok).toBe(false);
    expect(intentFor({ option: "base", to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD" }).ok).toBe(false);
  });
});

describe("formatBp", () => {
  test("slippage reads as a percentage", () => {
    expect(formatBp(100)).toBe("1%");
    expect(formatBp(50)).toBe("0.5%");
    expect(formatBp(25)).toBe("0.25%");
  });
});
