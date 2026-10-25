import { describe, expect, test } from "bun:test";
import { guideLoan, guideProgress, type GuideFacts, type GuideLoan } from "./guide";

const TX = "ab".repeat(32);
const base: GuideFacts = { claim: { kind: "checking" }, balanceSats: null, depositPending: false, loan: null, milestones: {} };
const loan = (over: Partial<GuideLoan> = {}): GuideLoan => ({ index: 0, txid: TX, status: "active", debtStroops: 0n, ...over });
const states = (f: Partial<GuideFacts>) => {
  const p = guideProgress({ ...base, ...f });
  return { current: p.current, list: (["fund", "deposit", "borrow", "repay", "release"] as const).map((id) => p.state(id)) };
};

describe("guideProgress", () => {
  test("starts at funding while the claim runs", () => {
    expect(states({})).toEqual({ current: "fund", list: ["now", "next", "next", "next", "next"] });
    expect(states({ claim: { kind: "failed", failure: { code: "faucet_empty", title: "", message: "", retryable: true, publicFaucets: [] } } }).current).toBe("fund");
  });

  test("funded by the payout, by a balance, or by a deposit already on its way", () => {
    expect(states({ claim: { kind: "sent", txid: TX, explorerUrl: "", amountSats: 20_000 } }).current).toBe("deposit");
    expect(states({ balanceSats: 1n }).current).toBe("deposit");
    expect(states({ depositPending: true }).current).toBe("deposit");
  });

  test("a registered loan moves on to borrow, its debt to repay", () => {
    expect(states({ loan: loan() }).current).toBe("borrow");
    expect(states({ loan: loan({ debtStroops: 5n }) }).current).toBe("repay");
  });

  test("a loan closed after a borrow moves on to release", () => {
    expect(states({ loan: loan({ status: "closed" }), milestones: { borrow: 1 } }).current).toBe("release");
    expect(states({ loan: loan({ status: "closed" }), milestones: { repay: 1 } }).current).toBe("release");
  });

  test("a loan closed without a borrow still asks for one", () => {
    expect(states({ loan: loan({ status: "closed" }) }).current).toBe("borrow");
  });

  test("released means done, and fills every step before it", () => {
    expect(states({ loan: loan({ status: "released" }) })).toEqual({ current: null, list: ["done", "done", "done", "done", "done"] });
    expect(states({ milestones: { release: 1 } }).current).toBeNull();
  });
});

test("guideLoan follows the newest loan", () => {
  const a = { position: { index: 0 } };
  const b = { position: { index: 2 } };
  expect(guideLoan([a, b])).toBe(b);
  expect(guideLoan([])).toBeNull();
});
