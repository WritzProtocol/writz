import { describe, expect, it } from "bun:test";
import { minOut, swapDeadline } from "./swap";

describe("minOut", () => {
  it("takes the slippage off the quote and rounds down", () => {
    expect(minOut(9_305_300_000n, 50)).toBe(9_258_773_500n);
    expect(minOut(999n, 50)).toBe(994n);
    expect(minOut(1_000n, 0)).toBe(1_000n);
  });

  it("refuses slippage outside 0 to 5%", () => {
    expect(() => minOut(1_000n, -1)).toThrow();
    expect(() => minOut(1_000n, 501)).toThrow();
    expect(() => minOut(1_000n, 12.5)).toThrow();
  });
});

describe("swapDeadline", () => {
  it("is five minutes of unix seconds after now", () => {
    expect(swapDeadline(1_761_400_000_999)).toBe(1_761_400_300n);
  });
});
