/**
 * Pure unit tests for computeTvlSummary - no sqlite, no mocks, just
 * VaultEvent[] in, TvlSummary out.
 */
import { computeTvlSummary } from "../src/vault-watcher/metrics.js";
import type { VaultEvent } from "../src/vault-watcher/event-store.js";

function event(overrides: Partial<VaultEvent>): VaultEvent {
  return {
    cursor: "cursor-1",
    kind: "deposit",
    depositor: "GDEPOSITOR",
    amountStroops: "1000000",
    ledger: 100,
    txHash: "aa".repeat(32),
    ledgerCloseTime: 1_700_000_000,
    ...overrides,
  };
}

describe("computeTvlSummary", () => {
  test("no events: zero TVL, zero depositors", () => {
    expect(computeTvlSummary([])).toEqual({ netDepositedStroops: 0n, uniqueDepositors: 0 });
  });

  test("a single deposit counts toward TVL and the depositor set", () => {
    const summary = computeTvlSummary([event({ amountStroops: "200000000" })]);
    expect(summary).toEqual({ netDepositedStroops: 200000000n, uniqueDepositors: 1 });
  });

  test("a withdrawal subtracts from TVL but is not a depositor", () => {
    const summary = computeTvlSummary([
      event({ depositor: "GA", amountStroops: "200000000", kind: "deposit" }),
      event({ depositor: "GB", amountStroops: "50000000", kind: "withdraw" }),
    ]);
    expect(summary.netDepositedStroops).toBe(150000000n);
    // GB never deposited, so the depositor set is still just {GA}.
    expect(summary.uniqueDepositors).toBe(1);
  });

  test("the same depositor across multiple deposits is counted once", () => {
    const summary = computeTvlSummary([
      event({ depositor: "GA", amountStroops: "100000000" }),
      event({ depositor: "GA", amountStroops: "50000000" }),
    ]);
    expect(summary.uniqueDepositors).toBe(1);
    expect(summary.netDepositedStroops).toBe(150000000n);
  });

  test("different depositors are counted separately", () => {
    const summary = computeTvlSummary([
      event({ depositor: "GA", amountStroops: "100000000" }),
      event({ depositor: "GB", amountStroops: "100000000" }),
    ]);
    expect(summary.uniqueDepositors).toBe(2);
  });

  test("a depositor who fully withdraws still counts as a unique depositor (lifetime metric)", () => {
    const summary = computeTvlSummary([
      event({ depositor: "GA", amountStroops: "100000000", kind: "deposit" }),
      event({ depositor: "GA", amountStroops: "100000000", kind: "withdraw" }),
    ]);
    expect(summary.netDepositedStroops).toBe(0n);
    expect(summary.uniqueDepositors).toBe(1);
  });

  test("amounts beyond Number.MAX_SAFE_INTEGER are handled correctly (bigint, not float)", () => {
    const summary = computeTvlSummary([event({ amountStroops: "9007199254740993" })]);
    expect(summary.netDepositedStroops).toBe(9007199254740993n);
  });
});
