import { describe, expect, test } from "bun:test";
import { confirmationTarget, depositStage } from "./depositStatus";

describe("confirmationTarget", () => {
  test("uses the configured count when nothing is reported", () => {
    expect(confirmationTarget([], 1)).toBe(1);
    expect(confirmationTarget([undefined, null], 6)).toBe(6);
  });

  test("a reported count wins over the configured one, first valid first", () => {
    expect(confirmationTarget([3, 2], 1)).toBe(3);
    expect(confirmationTarget([undefined, 2], 6)).toBe(2);
  });

  test("ignores counts that cannot be a requirement", () => {
    expect(confirmationTarget([0, -1, 1.5, Number.NaN, 1000], 1)).toBe(1);
  });

  test("returns null rather than inventing a count", () => {
    expect(confirmationTarget([], Number.NaN)).toBeNull();
    expect(confirmationTarget([0], 0)).toBeNull();
  });
});

describe("depositStage", () => {
  test("counts confirmations up to the target", () => {
    expect(depositStage({ n: 0, m: 1, stellarTxHash: null })).toEqual({ kind: "confirming", n: 0, m: 1 });
    expect(depositStage({ n: 2, m: 6, stellarTxHash: null })).toEqual({ kind: "confirming", n: 2, m: 6 });
  });

  test("enough confirmations is ready, not verified", () => {
    expect(depositStage({ n: 1, m: 1, stellarTxHash: null })).toEqual({ kind: "ready" });
    expect(depositStage({ n: 9, m: 6, stellarTxHash: null })).toEqual({ kind: "ready" });
  });

  test("verified only with the Stellar transaction", () => {
    expect(depositStage({ n: null, m: null, stellarTxHash: "ab".repeat(32) })).toEqual({ kind: "verified" });
  });

  test("unknown counts give no stage", () => {
    expect(depositStage({ n: null, m: 1, stellarTxHash: null })).toBeNull();
    expect(depositStage({ n: 0, m: null, stellarTxHash: null })).toBeNull();
  });
});
