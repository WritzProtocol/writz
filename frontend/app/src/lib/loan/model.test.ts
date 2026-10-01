import { describe, expect, test } from "bun:test";
import type { DerivedStatus, PositionStatus } from "@/lib/status/types";
import {
  REASONS,
  afterState,
  availableToBorrow,
  defaultTab,
  disabledReasons,
  liquidationPriceFor,
  loanActivity,
  loanHref,
  loanTabs,
  parseLoanNumber,
  parsePanel,
  parseUsdcAmount,
  ratioLimitStroops,
  releaseStepOf,
  repayToSafeStroops,
  shortDate,
  toFieldValue,
  type TabFacts,
} from "./model";

const STROOP = 10_000_000n;
const usdc = (n: number) => BigInt(Math.round(n * 100)) * (STROOP / 100n);
const PRICE = 60_000n * STROOP;
const SATS = 5_000_000n; // 0.05 BTC, $3,000 at $60k

const derived = (status: PositionStatus, over: Partial<DerivedStatus> = {}): DerivedStatus => ({
  status,
  reclaimable: false,
  timelock: null,
  syncing: false,
  ...over,
});

const facts = (status: PositionStatus, over: Partial<TabFacts> = {}): TabFacts => ({
  status: derived(status),
  debtStroops: usdc(1500),
  price: { kind: "ok", value: PRICE },
  available: { stroops: usdc(500), limitedByPool: false },
  busy: null,
  otherTx: false,
  catchingUp: false,
  ...over,
});

const healthy: PositionStatus = { kind: "active", ratioBp: 20_000n, band: "healthy" };
const belowLimit: PositionStatus = { kind: "active", ratioBp: 14_000n, band: "below_limit" };
const atRisk: PositionStatus = { kind: "at_risk", ratioBp: 12_500n };
const neverBorrowed: PositionStatus = { kind: "repaid_locked", neverBorrowed: true, missingBtcDetails: false };
const repaid: PositionStatus = { kind: "repaid_locked", neverBorrowed: false, missingBtcDetails: false };

describe("available to borrow", () => {
  test("ratio limit is collateral value over 150%", () => {
    expect(ratioLimitStroops(SATS, PRICE)).toBe(usdc(2000));
  });

  test("headroom under the ratio limit when the pool has more", () => {
    expect(availableToBorrow(SATS, usdc(1500), PRICE, usdc(10_000))).toEqual({ stroops: usdc(500), limitedByPool: false });
  });

  test("pool liquidity caps it when lower", () => {
    expect(availableToBorrow(SATS, 0n, PRICE, usdc(300))).toEqual({ stroops: usdc(300), limitedByPool: true });
  });

  test("never negative above the limit", () => {
    expect(availableToBorrow(SATS, usdc(2400), PRICE, usdc(10_000)).stroops).toBe(0n);
  });

  test("unknown pool falls back to the ratio headroom", () => {
    expect(availableToBorrow(SATS, 0n, PRICE, null)).toEqual({ stroops: usdc(2000), limitedByPool: false });
  });

  test("empty pool is reported as pool-limited", () => {
    expect(availableToBorrow(SATS, 0n, PRICE, 0n)).toEqual({ stroops: 0n, limitedByPool: true });
  });
});

describe("repay to reach 150%", () => {
  test("zero when already at or above the limit", () => {
    expect(repayToSafeStroops(SATS, usdc(2000), PRICE)).toBe(0n);
    expect(repayToSafeStroops(SATS, usdc(100), PRICE)).toBe(0n);
  });

  test("the debt above the limit", () => {
    expect(repayToSafeStroops(SATS, usdc(2400), PRICE)).toBe(usdc(400));
  });

  test("rounds up to the cent so the result reaches 150%", () => {
    const amount = repayToSafeStroops(SATS, usdc(2400) + 1n, PRICE);
    expect(amount).toBe(usdc(400.01));
    const after = afterState(SATS, usdc(2400) + 1n - amount, PRICE);
    expect(after.repaid === false && after.ratioBp >= 15_000n).toBe(true);
  });
});

describe("after-state", () => {
  test("full repay", () => {
    expect(afterState(SATS, 0n, PRICE)).toEqual({ repaid: true });
  });

  test("ratio and liquidation price for the new debt", () => {
    expect(afterState(SATS, usdc(1500), PRICE)).toEqual({ repaid: false, ratioBp: 20_000n, liquidationPrice: 36_000n * STROOP });
  });

  test("liquidation price is 120% of debt per BTC", () => {
    expect(liquidationPriceFor(SATS, usdc(2450))).toBe(58_800n * STROOP);
    expect(liquidationPriceFor(SATS, 0n)).toBeNull();
  });
});

describe("USDC amount parsing", () => {
  test("accepts decimals and thousands commas", () => {
    expect(parseUsdcAmount("200")).toEqual({ ok: true, stroops: usdc(200) });
    expect(parseUsdcAmount("1,000.5")).toEqual({ ok: true, stroops: usdc(1000.5) });
    expect(parseUsdcAmount("12,5")).toEqual({ ok: true, stroops: usdc(12.5) });
  });

  test("rejects exponents, zero and too many decimals", () => {
    expect(parseUsdcAmount("1e3").ok).toBe(false);
    expect(parseUsdcAmount("0").ok).toBe(false);
    expect(parseUsdcAmount("").ok).toBe(false);
    expect(parseUsdcAmount("1.12345678").ok).toBe(false);
  });

  test("field value round-trips to cents", () => {
    expect(toFieldValue(usdc(402.67) + 5n)).toBe("402.67");
  });
});

describe("tabs", () => {
  test("healthy: borrow and repay, release needs repayment", () => {
    const t = loanTabs(facts(healthy));
    expect(t.borrow.enabled && t.repay.enabled).toBe(true);
    expect(t.release).toEqual({ enabled: false, reason: REASONS.repayFirst });
  });

  test("below the borrow limit blocks borrowing with its reason", () => {
    expect(loanTabs(facts(belowLimit)).borrow).toEqual({ enabled: false, reason: REASONS.belowLimit });
    expect(loanTabs(facts(atRisk)).borrow).toEqual({ enabled: false, reason: REASONS.belowLimit });
  });

  test("never borrowed: borrow and release, nothing to repay", () => {
    const t = loanTabs(facts(neverBorrowed, { debtStroops: 0n }));
    expect(t.borrow.enabled && t.release.enabled).toBe(true);
    expect(t.repay).toEqual({ enabled: false, reason: REASONS.nothingToRepay });
  });

  test("repaid: release only", () => {
    const t = loanTabs(facts(repaid, { debtStroops: 0n }));
    expect(t.release.enabled).toBe(true);
    expect(t.borrow).toEqual({ enabled: false, reason: REASONS.repaidClosed });
  });

  test("missing Bitcoin details blocks release", () => {
    const t = loanTabs(facts({ ...repaid, missingBtcDetails: true }, { debtStroops: 0n }));
    expect(t.release).toEqual({ enabled: false, reason: REASONS.missingDetails });
  });

  test("checking disables everything", () => {
    const t = loanTabs(facts({ kind: "checking", missing: ["nullifier"] }));
    expect(disabledReasons(t)).toEqual([REASONS.checking]);
  });

  test("price unavailable or unknown blocks borrow only", () => {
    expect(loanTabs(facts(healthy, { price: { kind: "failed" } })).borrow).toEqual({ enabled: false, reason: REASONS.priceUnavailable });
    expect(loanTabs(facts(healthy, { price: { kind: "checking" } })).borrow).toEqual({ enabled: false, reason: REASONS.priceChecking });
    expect(loanTabs(facts(healthy, { price: { kind: "failed" } })).repay.enabled).toBe(true);
  });

  test("empty pool blocks borrow with the pool reason", () => {
    expect(loanTabs(facts(healthy, { available: { stroops: 0n, limitedByPool: true } })).borrow).toEqual({
      enabled: false,
      reason: REASONS.poolEmpty,
    });
  });

  test("a running transaction keeps its own tab and waits on the others", () => {
    const t = loanTabs(facts(healthy, { busy: "borrow" }));
    expect(t.borrow.enabled).toBe(true);
    expect(t.repay).toEqual({ enabled: false, reason: REASONS.busy });
  });

  test("another tab's transaction and relayer catch-up block every action", () => {
    expect(disabledReasons(loanTabs(facts(healthy, { otherTx: true })))).toEqual([REASONS.otherTx]);
    expect(loanTabs(facts(healthy, { catchingUp: true })).repay).toEqual({ enabled: false, reason: REASONS.catchingUp });
  });

  test("closed loans offer nothing", () => {
    const t = loanTabs(facts({ kind: "liquidated", txHash: "x" }));
    expect(t.borrow.enabled || t.repay.enabled || t.release.enabled).toBe(false);
  });
});

describe("default tab", () => {
  test("at risk opens repay", () => {
    expect(defaultTab(loanTabs(facts(atRisk)), atRisk, null, null)).toBe("repay");
  });

  test("repaid opens release, never borrowed opens borrow", () => {
    expect(defaultTab(loanTabs(facts(repaid, { debtStroops: 0n })), repaid, null, null)).toBe("release");
    expect(defaultTab(loanTabs(facts(neverBorrowed, { debtStroops: 0n })), neverBorrowed, null, null)).toBe("borrow");
  });

  test("the requested panel wins when enabled, the busy one always", () => {
    const t = loanTabs(facts(healthy));
    expect(defaultTab(t, healthy, "repay", null)).toBe("repay");
    expect(defaultTab(t, healthy, "release", null)).toBe("borrow");
    const none = loanTabs(facts(healthy, { catchingUp: true }));
    expect(defaultTab(none, healthy, "borrow", null)).toBeNull();
    expect(defaultTab(t, healthy, "repay", "borrow")).toBe("borrow");
  });
});

describe("routing", () => {
  test("loan numbers are positive integers", () => {
    expect(parseLoanNumber("1")).toBe(1);
    expect(parseLoanNumber("0")).toBeNull();
    expect(parseLoanNumber("01")).toBeNull();
    expect(parseLoanNumber("abc")).toBeNull();
  });

  test("panel query and href", () => {
    expect(parsePanel("repay")).toBe("repay");
    expect(parsePanel("other")).toBeNull();
    expect(loanHref(0, "borrow")).toBe("/loans/1?panel=borrow");
  });
});

describe("release steps", () => {
  test("maps the release flow to its visible step", () => {
    expect(releaseStepOf({ phase: "preparing", step: "building" })).toBe(0);
    expect(releaseStepOf({ phase: "preparing", step: "merkle_path" })).toBe(0);
    expect(releaseStepOf({ phase: "proving" })).toBe(1);
    expect(releaseStepOf({ phase: "preparing", step: "cosign" })).toBe(2);
    expect(releaseStepOf({ phase: "awaiting_signature", wallet: "bitcoin" })).toBe(3);
    expect(releaseStepOf({ phase: "preparing", step: "broadcasting" })).toBe(4);
    expect(releaseStepOf({ phase: "settled" })).toBeNull();
  });
});

describe("loan activity", () => {
  const save = (index: number) => ({ index }) as never;
  test("only this loan's pending txs, then session results, then the loan's own records", () => {
    const items = loanActivity({
      index: 0,
      pending: [
        { hash: "p1", kind: "borrow", createdAt: 5, positionUpdate: { removeId: "a", save: save(0) } },
        { hash: "p2", kind: "repay", createdAt: 6, positionUpdate: { removeId: "b", save: save(1) } },
        { hash: "x", kind: "supply", createdAt: 7 },
      ],
      recent: [
        { hash: "r1", chain: "stellar", label: "Repaid 1.00 USDC", at: 1 },
        { hash: "r2", chain: "stellar", label: "Borrowed 2.00 USDC", at: 2 },
      ],
      stellarTxHash: "dep",
      releaseTxid: "rel",
      createdAt: 0,
    });
    expect(items.map((i) => i.hash)).toEqual(["p1", "r2", "r1", "rel", "dep"]);
    expect(items[0]).toMatchObject({ state: "pending", label: "Borrow" });
    expect(items[3]).toMatchObject({ chain: "bitcoin" });
  });

  test("a hash appears once", () => {
    const items = loanActivity({
      index: 0,
      pending: [{ hash: "h", kind: "borrow", createdAt: 1, positionUpdate: { removeId: "a", save: save(0) } }],
      recent: [{ hash: "h", chain: "stellar", label: "Borrowed", at: 2 }],
    });
    expect(items).toHaveLength(1);
  });
});

describe("dates", () => {
  test("short date is locale independent", () => {
    expect(shortDate(Date.UTC(2026, 8, 24, 12))).toBe("24 Sep 2026");
  });
});
