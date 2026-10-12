import { describe, expect, test } from "bun:test";
import { checkAmount, withdrawable } from "./model";

const usdc = (n: number) => BigInt(n) * 10_000_000n;
const over = (max: bigint) => `max ${max}`;

describe("withdrawable", () => {
  test("is the whole balance when the pool has enough", () => {
    expect(withdrawable(usdc(100), usdc(500))).toEqual({ stroops: usdc(100), limitedByPool: false });
  });

  test("is capped by pool liquidity when borrowers use the rest", () => {
    expect(withdrawable(usdc(100), usdc(40))).toEqual({ stroops: usdc(40), limitedByPool: true });
  });

  test("is zero when everything is lent out", () => {
    expect(withdrawable(usdc(100), 0n)).toEqual({ stroops: 0n, limitedByPool: true });
  });

  test("an unknown pool leaves the balance as the cap", () => {
    expect(withdrawable(usdc(100), null)).toEqual({ stroops: usdc(100), limitedByPool: false });
  });
});

describe("checkAmount", () => {
  test("accepts an amount within the cap", () => {
    expect(checkAmount("1,000.50", usdc(2000), over)).toEqual({ ok: true, stroops: usdc(1000) + 5_000_000n });
  });

  test("rejects more than the cap with the side's message", () => {
    expect(checkAmount("101", usdc(100), over)).toEqual({ ok: false, error: `max ${usdc(100)}` });
  });

  test("an unknown cap does not block", () => {
    expect(checkAmount("101", null, over).ok).toBe(true);
  });

  test("bad input keeps the parser's message", () => {
    expect(checkAmount("1e3", usdc(5000), over)).toEqual({ ok: false, error: "Enter a number, like 200." });
  });
});
