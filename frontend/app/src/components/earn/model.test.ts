import { describe, expect, test } from "bun:test";
import { earnSides } from "./model";

const USDC = 10_000_000n;

describe("earn sides", () => {
  test("the submit label carries the amount like Lend does", () => {
    const sides = earnSides({ kind: "ok", value: 5_000n * USDC }, { kind: "ok", value: 2_000n * USDC }, false);
    expect(sides.in.action?.(1_240n * USDC)).toBe("Deposit 1,240.00 USDC");
    expect(sides.out.action?.(12_345n * USDC + 6_700_000n)).toBe("Withdraw 12,345.67 USDC");
  });
});
