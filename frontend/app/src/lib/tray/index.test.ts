import { describe, expect, test } from "bun:test";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { PendingTx } from "@/lib/flow/pendingTx";
import { createJsonStore } from "@/lib/flow/storage";
import { memoryStorage } from "@/lib/flow/testStorage";
import type { RecentTx } from "@/lib/loan/model";
import { createRecentStore, FINISHED_TTL_MS, trayItems, unsettledCount } from ".";

const NOW = 1_800_000_000_000;

const pd: PendingDeposit = {
  btcTxid: "ab".repeat(32),
  sats: "5000000",
  p2wsh: "tb1qlock",
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 300_000,
  stellarAddress: "GOWNER",
  positionIndex: 1,
  step: "confirming",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
};

const tx: PendingTx = { hash: "cd".repeat(32), kind: "borrow", createdAt: NOW - 30_000 };
const done = (hash: string, at: number): RecentTx => ({ hash, chain: "stellar", label: "Borrowed 200.00 USDC", at });

describe("trayItems", () => {
  test("orders needs attention, then in progress, then done", () => {
    const items = trayItems({
      pendingDeposit: pd,
      depositStatus: { kind: "ready_to_register" },
      pendingTxs: [tx],
      recent: [done("ef".repeat(32), NOW - 1000)],
      now: NOW,
    });
    expect(items.map((i) => i.state)).toEqual(["needs_attention", "in_progress", "done"]);
    expect(items[0]).toMatchObject({ label: "Deposit BTC", loan: "Loan 2", stateLabel: "One signature left", action: "resume" });
  });

  test("a deposit recorded on Stellar but not saved here yet stays in progress", () => {
    const [item] = trayItems({ pendingDeposit: pd, depositStatus: { kind: "registering" }, pendingTxs: [], recent: [], now: NOW });
    expect(item).toMatchObject({ state: "in_progress", action: "resume" });
  });

  test("finished items drop after a day; pending ones stay however old", () => {
    const old = { ...tx, createdAt: NOW - 10 * FINISHED_TTL_MS };
    const items = trayItems({
      pendingDeposit: null,
      depositStatus: null,
      pendingTxs: [old],
      recent: [done("ef".repeat(32), NOW - FINISHED_TTL_MS - 1)],
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual([old.hash]);
  });

  test("the deposit's own Stellar transaction is not listed twice", () => {
    const withHash = { ...pd, stellarTxHash: tx.hash };
    const items = trayItems({ pendingDeposit: withHash, depositStatus: null, pendingTxs: [{ ...tx, kind: "deposit" }], recent: [], now: NOW });
    expect(items).toHaveLength(1);
  });

  test("the count leaves out finished items", () => {
    const items = trayItems({ pendingDeposit: null, depositStatus: null, pendingTxs: [tx], recent: [done("ef".repeat(32), NOW)], now: NOW });
    expect(unsettledCount(items)).toBe(1);
  });
});

describe("recent store", () => {
  test("adding prunes items older than a day and replaces the same hash", () => {
    const storage = memoryStorage();
    const store = createRecentStore(createJsonStore("writz.recent.", () => storage));
    store.add("G", done("aa", NOW - FINISHED_TTL_MS - 5), NOW - FINISHED_TTL_MS - 5);
    store.add("G", done("bb", NOW - 10), NOW - 10);
    store.add("G", done("bb", NOW), NOW);
    expect(store.snapshot("G")?.map((t) => [t.hash, t.at])).toEqual([["bb", NOW]]);
  });
});
