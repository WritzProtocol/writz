import { describe, expect, it } from "bun:test";
import { burnableStroops, evmAddressToBytes32, fetchAttestation, fetchMinimumFeeBp, maxFeeFor } from "./cctp";

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("evmAddressToBytes32", () => {
  it("left-pads the 20 address bytes to 32", () => {
    const b = evmAddressToBytes32("0x00000000000000000000000000000000000000Ab");
    expect(b.length).toBe(32);
    expect(b.toString("hex")).toBe("00".repeat(31) + "ab");
  });

  it("refuses anything that is not a 0x address", () => {
    expect(() => evmAddressToBytes32("GAXDQFQOZ645ZIZZCBZ6XPVHRDJ46OOIQ5RXU5G5KJNTZQ7AOM4DWP5L")).toThrow();
    expect(() => evmAddressToBytes32("0x1234")).toThrow();
  });
});

describe("burnableStroops", () => {
  it("drops the seventh decimal CCTP cannot carry", () => {
    expect(burnableStroops(1_234_567n)).toBe(1_234_560n);
    expect(burnableStroops(100_000_000n)).toBe(100_000_000n);
    expect(burnableStroops(9n)).toBe(0n);
  });
});

describe("maxFeeFor", () => {
  it("is zero when Circle charges nothing and rounds a fee up", () => {
    expect(maxFeeFor(100_000_000n, 0)).toBe(0n);
    expect(maxFeeFor(100_000_000n, 1)).toBe(10_000n);
    expect(maxFeeFor(1n, 1)).toBe(1n);
  });
});

describe("fetchMinimumFeeBp", () => {
  it("reads the Standard tier", async () => {
    const tiers = [
      { finalityThreshold: 1000, minimumFee: 1 },
      { finalityThreshold: 2000, minimumFee: 0 },
    ];
    expect(await fetchMinimumFeeBp(json(tiers))).toBe(0);
  });
});

describe("fetchAttestation", () => {
  it("is pending while Iris has not seen the burn or not signed it", async () => {
    expect(await fetchAttestation("AB", json({}, 404))).toEqual({ status: "pending" });
    expect(await fetchAttestation("ab", json({ messages: [{ status: "pending_confirmations", message: "0x", attestation: "PENDING" }] }))).toEqual({ status: "pending" });
  });

  it("returns the message and attestation once complete", async () => {
    const m = { status: "complete", message: "0x01", attestation: "0x02" };
    expect(await fetchAttestation("ab", json({ messages: [m] }))).toEqual({ status: "complete", message: "0x01", attestation: "0x02" });
  });
});
