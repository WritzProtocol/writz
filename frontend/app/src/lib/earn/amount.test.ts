import { describe, expect, it } from "bun:test";
import { fmtUsdc, toStroops } from "./amount";

describe("toStroops", () => {
  it("scales whole and fractional amounts exactly", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.5")).toBe(5_000_000n);
    expect(toStroops("12.3456789")).toBe(123_456_789n);
    expect(toStroops(".5")).toBe(5_000_000n);
    expect(toStroops("5.")).toBe(50_000_000n);
  });

  it("keeps precision where a float would lose it", () => {
    // Number("12345678.1234567") * 1e7 is off by a stroop.
    expect(toStroops("12345678.1234567")).toBe(123_456_781_234_567n);
    expect(toStroops("99999999999.9999999")).toBe(999_999_999_999_999_999n);
  });

  it("accepts the grouped output of fmtUsdc, so Max round-trips", () => {
    const balance = 1_234_567_890_123n;
    expect(toStroops(fmtUsdc(balance))).toBe(balance);
  });

  it("rejects amounts USDC cannot represent", () => {
    expect(toStroops("1.12345678")).toBeNull(); // 8 decimals
  });

  it("rejects non-amounts and zero", () => {
    for (const bad of ["", " ", ".", "abc", "-1", "1e7", "1.2.3", "0", "0.0", "0.0000000"]) {
      expect(toStroops(bad)).toBeNull();
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(toStroops("  2.5  ")).toBe(25_000_000n);
  });
});

describe("fmtUsdc", () => {
  it("trims trailing zeros and groups thousands", () => {
    expect(fmtUsdc(10_000_000n)).toBe("1");
    expect(fmtUsdc(5_000_000n)).toBe("0.5");
    expect(fmtUsdc(123_456_789n)).toBe("12.3456789");
    expect(fmtUsdc(12_345_678_900_000n)).toBe("1,234,567.89");
    expect(fmtUsdc(0n)).toBe("0");
  });

  it("keeps the sign on negatives", () => {
    expect(fmtUsdc(-5_000_000n)).toBe("-0.5");
  });
});
