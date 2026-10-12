import { describe, expect, test } from "bun:test";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import type { DerivedStatus, PositionStatus } from "@/lib/status/types";
import { homeHeadline, pickUrgent, sortLoans, type HeadlineFacts, type HomeLoan } from "./model";

const NOW = 1_800_000_000_000;

const derived = (status: PositionStatus, reclaimable = false): DerivedStatus => ({
  status,
  reclaimable,
  timelock: null,
  syncing: false,
});

const loan = (index: number, status: PositionStatus, over: Partial<Position> = {}): HomeLoan => ({
  position: {
    id: String(index),
    owner: "GOWNER",
    txid: "ab".repeat(32),
    collateralSats: "5000000",
    debtStroops: "0",
    index,
    version: 1,
    commitment: "1",
    nullifier: "2",
    status: "active",
    createdAt: NOW - index * 1000,
    ...over,
  },
  derived: derived(status),
});

const pd: PendingDeposit = {
  btcTxid: "cd".repeat(32),
  sats: "5000000",
  p2wsh: "tb1qlock",
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 300_000,
  stellarAddress: "GOWNER",
  positionIndex: 3,
  step: "confirming",
  createdAt: NOW,
  updatedAt: NOW,
};

const healthy: PositionStatus = { kind: "active", ratioBp: 20_000n, band: "healthy" };
const atRisk: PositionStatus = { kind: "at_risk", ratioBp: 12_500n };
const liquidatable: PositionStatus = { kind: "liquidatable", ratioBp: 11_000n };
const repaid: PositionStatus = { kind: "repaid_locked", neverBorrowed: false, missingBtcDetails: false };
const confirming: PositionStatus = { kind: "confirming", n: 0, m: 1, relayerBehind: false };

describe("sortLoans", () => {
  test("puts loans that need the user first and closed loans apart, newest first", () => {
    const { open, closed } = sortLoans([
      loan(0, { kind: "releasing", btcTxid: null }),
      loan(1, healthy),
      loan(2, { kind: "released", btcTxid: "ef".repeat(32) }),
      loan(3, repaid),
      loan(4, atRisk),
      loan(5, liquidatable),
      loan(6, { kind: "liquidated", txHash: "aa".repeat(32) }),
    ]);
    expect(open.map((l) => l.position.index)).toEqual([5, 4, 1, 3, 0]);
    expect(closed.map((l) => l.position.index)).toEqual([2, 6]);
  });

  test("a loan still being checked stays with the open ones", () => {
    const { open, closed } = sortLoans([loan(0, { kind: "checking", missing: ["nullifier"] })]);
    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(0);
  });
});

describe("pickUrgent", () => {
  test("money at risk beats a deposit in progress", () => {
    const u = pickUrgent([loan(0, atRisk)], { pd, derived: derived(confirming) });
    expect(u?.kind).toBe("at_risk");
  });

  test("can be liquidated beats close to liquidation", () => {
    expect(pickUrgent([loan(0, atRisk), loan(1, liquidatable)], null)?.kind).toBe("liquidatable");
  });

  test("a deposit in progress is pinned over a repaid loan", () => {
    const u = pickUrgent([loan(0, repaid)], { pd, derived: derived(confirming) });
    expect(u).toMatchObject({ kind: "deposit", status: confirming });
  });

  test("a deposit whose status is still being read stays pinned", () => {
    const u = pickUrgent([], { pd, derived: derived({ kind: "checking", missing: ["deposit_tx"] }) });
    expect(u).toMatchObject({ kind: "deposit", status: { kind: "checking" } });
  });

  test("a registered loan whose tree insert failed is a deposit to finish", () => {
    const u = pickUrgent([loan(0, { kind: "register_failed" })], null);
    expect(u).toMatchObject({ kind: "deposit", status: { kind: "register_failed" } });
  });

  test("a never-borrowed deposit is not a repaid loan to release", () => {
    expect(pickUrgent([loan(0, { ...repaid, neverBorrowed: true })], null)).toBeNull();
    expect(pickUrgent([loan(0, repaid)], null)?.kind).toBe("repaid");
  });

  test("the exit path beats a repaid loan; changed elsewhere surfaces when nothing else does", () => {
    const reclaim = { ...loan(0, repaid), derived: derived(repaid, true) };
    expect(pickUrgent([reclaim], null)?.kind).toBe("reclaimable");
    expect(pickUrgent([loan(0, { kind: "changed_elsewhere" })], null)?.kind).toBe("changed");
  });

  test("nothing urgent for a healthy loan", () => {
    expect(pickUrgent([loan(0, healthy)], null)).toBeNull();
  });
});

describe("homeHeadline", () => {
  const facts = (over: Partial<HeadlineFacts> = {}): HeadlineFacts => ({
    urgent: null,
    openLoans: 0,
    onlyLoan: null,
    lender: null,
    findingLoans: false,
    ...over,
  });

  test("new users get the product line", () => {
    expect(homeHeadline(facts())).toBe("Lock Bitcoin. Borrow dollars.");
  });

  test("one healthy loan says so", () => {
    expect(homeHeadline(facts({ openLoans: 1, onlyLoan: healthy }))).toBe("Your loan is healthy.");
  });

  test("the urgent item sets the headline", () => {
    const u = pickUrgent([loan(0, atRisk)], null);
    expect(homeHeadline(facts({ urgent: u, openLoans: 1 }))).toBe("Your loan is close to liquidation.");
  });

  test("a releasing loan says the BTC is on its way", () => {
    expect(homeHeadline(facts({ openLoans: 1, onlyLoan: { kind: "releasing", btcTxid: null } }))).toBe("Your BTC is on its way back.");
  });

  test("lenders without loans see their balance headline", () => {
    expect(homeHeadline(facts({ lender: "earn" }))).toBe("Your USDC is earning.");
    expect(homeHeadline(facts({ lender: "lend" }))).toBe("Your USDC is in the borrow pool.");
  });
});
