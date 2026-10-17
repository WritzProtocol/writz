import { describe, expect, test } from "bun:test";
import type { Position } from "@/lib/position/types";
import { STELLAR_TX_TTL_MS } from "./pendingDeposit";
import {
  MAX_LEAF_REJECTIONS,
  createActivityStore,
  decideLeafRetry,
  decideReconcile,
  reconcilePendingTxs,
  retryLeafUpdates,
  type LeafOutcome,
  type PendingTx,
  type TxStatus,
} from "./pendingTx";
import { createJsonStore } from "./storage";
import { memoryStorage } from "./testStorage";

const NOW = 1_800_000_000_000;

const position = (id: string, version: number): Position => ({
  id,
  owner: "GOWNER",
  txid: null,
  collateralSats: "1000000",
  debtStroops: String(version * 10),
  index: 0,
  version,
  commitment: id,
  nullifier: "n" + id,
  status: "active",
  createdAt: 0,
  leafIndex: 3,
});

const borrowTx = (hash: string, createdAt = NOW): PendingTx => ({
  hash,
  kind: "borrow",
  createdAt,
  positionUpdate: { removeId: "old", save: position("new", 1) },
  leafUpdate: { leafIndex: 3, newCommitment: "aa".repeat(32), encNote: "beef" },
});

function store() {
  const storage = memoryStorage();
  return createActivityStore(
    createJsonStore<PendingTx[]>("writz.activity.", () => storage),
    createJsonStore("writz.leafSync.", () => storage),
  );
}

describe("decideReconcile", () => {
  test("applies confirmed, drops failed, waits on unknown until the signed tx expires", () => {
    const tx = borrowTx("h", NOW);
    expect(decideReconcile(tx, "SUCCESS", NOW)).toBe("apply");
    expect(decideReconcile(tx, "FAILED", NOW)).toBe("drop");
    expect(decideReconcile(tx, "NOT_FOUND", NOW + 1_000)).toBe("keep");
    expect(decideReconcile(tx, "NOT_FOUND", NOW + STELLAR_TX_TTL_MS + 1)).toBe("drop");
  });
});

describe("reconcilePendingTxs", () => {
  test("a borrow confirmed after the tab closed updates the position and queues its leaf update", async () => {
    const s = store();
    s.addTx("GOWNER", borrowTx("landed"));
    s.addTx("GOWNER", borrowTx("failed"));
    s.addTx("GOWNER", borrowTx("unknown"));
    const statuses: Record<string, TxStatus> = { landed: "SUCCESS", failed: "FAILED", unknown: "NOT_FOUND" };
    const positions = new Map([["old", position("old", 0)]]);

    await reconcilePendingTxs("GOWNER", {
      store: s,
      getStatus: async (h) => statuses[h],
      hasPosition: (id) => positions.has(id),
      replacePosition: (removeId, save) => {
        positions.delete(removeId);
        positions.set(save.id, save);
      },
      now: () => NOW,
    });

    expect([...positions.keys()]).toEqual(["new"]);
    expect(s.pendingTxs("GOWNER").map((t) => t.hash)).toEqual(["unknown"]);
    expect(s.leafUpdates("GOWNER")).toMatchObject([{ leafIndex: 3, attempts: 0 }]);
  });

  test("does not roll a position back when it already moved on", async () => {
    const s = store();
    s.addTx("GOWNER", borrowTx("landed"));
    let replaced = false;
    await reconcilePendingTxs("GOWNER", {
      store: s,
      getStatus: async () => "SUCCESS",
      hasPosition: () => false,
      replacePosition: () => (replaced = true),
      now: () => NOW,
    });
    expect(replaced).toBe(false);
    expect(s.pendingTxs("GOWNER")).toEqual([]);
  });

  test("an RPC error leaves the record for the next load", async () => {
    const s = store();
    s.addTx("GOWNER", borrowTx("h"));
    await reconcilePendingTxs("GOWNER", {
      store: s,
      getStatus: async () => Promise.reject(new Error("rpc down")),
      hasPosition: () => true,
      replacePosition: () => {},
    });
    expect(s.pendingTxs("GOWNER")).toHaveLength(1);
  });
});

describe("leaf update retries", () => {
  test("accepted drops, unreachable keeps, repeated rejections eventually drop", () => {
    const u = { leafIndex: 1, newCommitment: "c", encNote: "e", attempts: 0, createdAt: NOW };
    expect(decideLeafRetry(u, "accepted")).toBe("drop");
    expect(decideLeafRetry(u, "unreachable")).toBe("keep");
    expect(decideLeafRetry(u, "rejected")).toBe("keep");
    expect(decideLeafRetry({ ...u, attempts: MAX_LEAF_REJECTIONS - 1 }, "rejected")).toBe("drop");
  });

  test("retries until the relayer accepts, counting rejections", async () => {
    const s = store();
    s.enqueueLeaf("GOWNER", { leafIndex: 1, newCommitment: "a", encNote: "e" }, NOW);
    s.enqueueLeaf("GOWNER", { leafIndex: 2, newCommitment: "b", encNote: "e" }, NOW);
    s.enqueueLeaf("GOWNER", { leafIndex: 3, newCommitment: "c", encNote: "e" }, NOW);
    const outcomes: Record<number, LeafOutcome> = { 1: "accepted", 2: "rejected", 3: "unreachable" };

    await retryLeafUpdates("GOWNER", { store: s, post: async (u) => outcomes[u.leafIndex] });

    expect(s.leafUpdates("GOWNER").map((u) => [u.leafIndex, u.attempts])).toEqual([
      [2, 1],
      [3, 0],
    ]);
  });

  test("an update queued while retrying is not lost", async () => {
    const s = store();
    s.enqueueLeaf("GOWNER", { leafIndex: 1, newCommitment: "a", encNote: "e" }, NOW);
    await retryLeafUpdates("GOWNER", {
      store: s,
      post: async () => {
        s.enqueueLeaf("GOWNER", { leafIndex: 9, newCommitment: "z", encNote: "e" }, NOW);
        return "accepted";
      },
    });
    expect(s.leafUpdates("GOWNER").map((u) => u.leafIndex)).toEqual([9]);
  });
});
