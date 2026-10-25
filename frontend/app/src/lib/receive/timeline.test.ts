import { describe, expect, test } from "bun:test";
import { clientTimeline } from "./clientTimeline";
import { orderTimeline, timelineRows, type TimelineEvent } from "./timeline";
import type { Position } from "@/lib/position/types";

const ev = (kind: TimelineEvent["kind"], hash: string, at: number | null, chain: TimelineEvent["chain"] = "stellar"): TimelineEvent => ({ kind, chain, hash, at });

describe("orderTimeline", () => {
  test("lock and verification first, release last, whatever the input order", () => {
    const out = orderTimeline([ev("released", "r", 900, "bitcoin"), ev("borrowed", "b", 200), ev("verified", "v", 100), ev("btc_lock", "l", null, "bitcoin")]);
    expect(out.map((e) => e.kind)).toEqual(["btc_lock", "verified", "borrowed", "released"]);
  });

  test("repeated borrows and repays interleave by time", () => {
    const out = orderTimeline([ev("repaid", "r2", 400), ev("borrowed", "b1", 100), ev("repaid", "r1", 200), ev("borrowed", "b2", 300)]);
    expect(out.map((e) => e.hash)).toEqual(["b1", "r1", "b2", "r2"]);
  });

  test("an unknown time goes after known ones, then cycle order", () => {
    const out = orderTimeline([ev("repaid", "r", null), ev("received", "x", null), ev("borrowed", "b", 100)]);
    expect(out.map((e) => e.kind)).toEqual(["borrowed", "received", "repaid"]);
  });

  test("the same transaction twice shows once", () => {
    expect(orderTimeline([ev("verified", "v", 1), ev("verified", "v", 1)])).toHaveLength(1);
  });
});

describe("timelineRows", () => {
  test("adds the steps not reached yet, without transactions", () => {
    const rows = timelineRows([ev("btc_lock", "l", null, "bitcoin"), ev("verified", "v", 1)]);
    expect(rows.every((r) => !r.passed)).toBe(true);
    expect(rows.map((r) => [r.kind, r.event?.hash ?? null])).toEqual([
      ["btc_lock", "l"],
      ["verified", "v"],
      ["borrowed", null],
      ["received", null],
      ["repaid", null],
      ["released", null],
    ]);
  });

  test("a USDC borrow needs no separate receive step", () => {
    const rows = timelineRows([ev("btc_lock", "l", null, "bitcoin"), ev("verified", "v", 1), ev("borrowed", "b", 2)]);
    expect(rows.map((r) => r.kind)).toEqual(["btc_lock", "verified", "borrowed", "repaid", "released"]);
  });

  test("steps without a transaction before a later one are marked passed, in cycle order", () => {
    const rows = timelineRows([ev("btc_lock", "l", null, "bitcoin"), ev("verified", "v", 1), ev("released", "z", null, "bitcoin")]);
    expect(rows.map((r) => [r.kind, r.passed])).toEqual([
      ["btc_lock", false],
      ["verified", false],
      ["borrowed", true],
      ["received", true],
      ["repaid", true],
      ["released", false],
    ]);
  });

  test("a full cycle has no placeholders", () => {
    const rows = timelineRows([
      ev("btc_lock", "l", null, "bitcoin"),
      ev("verified", "v", 1),
      ev("borrowed", "b", 2),
      ev("received", "x", 3),
      ev("repaid", "r", 4),
      ev("released", "z", null, "bitcoin"),
    ]);
    expect(rows.every((r) => r.event)).toBe(true);
  });
});

describe("clientTimeline", () => {
  const position: Position = {
    id: "t",
    owner: "G",
    txid: "t",
    collateralSats: "5000000",
    debtStroops: "0",
    index: 0,
    status: "active",
    createdAt: 10,
    stellarTxHash: "s",
  };

  test("builds the cycle from the loan record, settled activity and received legs", () => {
    const events = clientTimeline(
      { ...position, releaseTxid: "z" },
      [
        { hash: "b", chain: "stellar", label: "Borrowed 10.00 USDC", state: "done", at: 20 },
        { hash: "p", chain: "stellar", label: "Repay", state: "pending", at: 30 },
        { hash: "s", chain: "stellar", label: "Deposit registered on Stellar", state: "done", at: 10 },
      ],
      [{ kind: "received", chain: "stellar", hash: "x", at: 21, label: "Received as XLM" }],
    );
    expect(orderTimeline(events).map((e) => [e.kind, e.hash])).toEqual([
      ["btc_lock", "t"],
      ["verified", "s"],
      ["borrowed", "b"],
      ["received", "x"],
      ["released", "z"],
    ]);
  });
});

