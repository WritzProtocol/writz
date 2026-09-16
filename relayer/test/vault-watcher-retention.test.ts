/**
 * Pure unit tests for computeRetentionCohorts - no sqlite, no mocks, just
 * VaultEvent[] + an injected `now` in, CohortRetention[] out.
 */
import { computeRetentionCohorts } from "../src/vault-watcher/retention.js";
import type { VaultEvent } from "../src/vault-watcher/event-store.js";

const DAY = 24 * 60 * 60;

// 2026-09-01T00:00:00Z, an arbitrary fixed anchor so test dates are legible.
const T0 = Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000);

function event(overrides: Partial<VaultEvent>): VaultEvent {
  return {
    cursor: "c",
    kind: "deposit",
    depositor: "GDEPOSITOR",
    amountStroops: "1000000",
    ledger: 100,
    txHash: "aa".repeat(32),
    ledgerCloseTime: T0,
    ...overrides,
  };
}

describe("computeRetentionCohorts", () => {
  test("no events: no cohorts", () => {
    expect(computeRetentionCohorts([], new Date((T0 + DAY) * 1000))).toEqual([]);
  });

  test("a cohort younger than 30 days is not yet eligible or retained", () => {
    const cohorts = computeRetentionCohorts(
      [event({ ledgerCloseTime: T0 })],
      new Date((T0 + 10 * DAY) * 1000),
    );
    expect(cohorts).toEqual([
      { cohort: "2026-09-01", depositors: 1, eligible: 0, retained: 0 },
    ]);
  });

  test("a depositor who never withdrew is retained once 30 days pass", () => {
    const cohorts = computeRetentionCohorts(
      [event({ ledgerCloseTime: T0, amountStroops: "1000000" })],
      new Date((T0 + 31 * DAY) * 1000),
    );
    expect(cohorts).toEqual([
      { cohort: "2026-09-01", depositors: 1, eligible: 1, retained: 1 },
    ]);
  });

  test("a depositor who fully withdrew before their 30-day mark is not retained", () => {
    const cohorts = computeRetentionCohorts(
      [
        event({ depositor: "GA", kind: "deposit", amountStroops: "1000000", ledgerCloseTime: T0 }),
        event({ depositor: "GA", kind: "withdraw", amountStroops: "1000000", ledgerCloseTime: T0 + 5 * DAY }),
      ],
      new Date((T0 + 31 * DAY) * 1000),
    );
    expect(cohorts).toEqual([
      { cohort: "2026-09-01", depositors: 1, eligible: 1, retained: 0 },
    ]);
  });

  test("a withdrawal that happens AFTER the 30-day cutoff doesn't count against retention at that cutoff", () => {
    const cohorts = computeRetentionCohorts(
      [
        event({ depositor: "GA", kind: "deposit", amountStroops: "1000000", ledgerCloseTime: T0 }),
        // Withdraws on day 40 - after GA's own day-30 mark, so this must not
        // be included when computing GA's balance AT day 30.
        event({ depositor: "GA", kind: "withdraw", amountStroops: "1000000", ledgerCloseTime: T0 + 40 * DAY }),
      ],
      new Date((T0 + 31 * DAY) * 1000),
    );
    expect(cohorts).toEqual([
      { cohort: "2026-09-01", depositors: 1, eligible: 1, retained: 1 },
    ]);
  });

  test("a partial withdrawal leaving a positive balance still counts as retained", () => {
    const cohorts = computeRetentionCohorts(
      [
        event({ depositor: "GA", kind: "deposit", amountStroops: "1000000", ledgerCloseTime: T0 }),
        event({ depositor: "GA", kind: "withdraw", amountStroops: "400000", ledgerCloseTime: T0 + 5 * DAY }),
      ],
      new Date((T0 + 31 * DAY) * 1000),
    );
    expect(cohorts[0]).toMatchObject({ retained: 1 });
  });

  test("depositors are grouped by the UTC day of their OWN first deposit, not a later one", () => {
    const cohorts = computeRetentionCohorts(
      [
        event({ depositor: "GA", ledgerCloseTime: T0 }),
        event({ depositor: "GA", ledgerCloseTime: T0 + 2 * DAY }), // GA's second deposit - doesn't move their cohort
        event({ depositor: "GB", ledgerCloseTime: T0 + 2 * DAY }),
      ],
      new Date((T0 + 60 * DAY) * 1000),
    );
    expect(cohorts.map((c) => [c.cohort, c.depositors])).toEqual([
      ["2026-09-01", 1],
      ["2026-09-03", 1],
    ]);
  });

  test("a withdraw-only anomaly (no deposit event ever recorded for that address) is excluded, not miscounted", () => {
    const cohorts = computeRetentionCohorts(
      [event({ depositor: "GHOST", kind: "withdraw", ledgerCloseTime: T0 })],
      new Date((T0 + 60 * DAY) * 1000),
    );
    expect(cohorts).toEqual([]);
  });

  test("cohorts are sorted chronologically", () => {
    const cohorts = computeRetentionCohorts(
      [
        event({ depositor: "GB", ledgerCloseTime: T0 + 5 * DAY }),
        event({ depositor: "GA", ledgerCloseTime: T0 }),
      ],
      new Date((T0 + 60 * DAY) * 1000),
    );
    expect(cohorts.map((c) => c.cohort)).toEqual(["2026-09-01", "2026-09-06"]);
  });
});
