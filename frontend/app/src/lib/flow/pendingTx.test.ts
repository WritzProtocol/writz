import { describe, expect, test } from "bun:test";
import type { Position } from "@/lib/position/types";
import { STELLAR_TX_TTL_MS } from "./pendingDeposit";
import { createActivityStore, decideReconcile, reconcilePendingTxs, type PendingTx, type TxStatus } from "./pendingTx";
import { createJsonStore } from "./storage";
import { memoryStorage } from "./testStorage";

const NOW = 1_800_000_000_000;

const TXID = "ab".repeat(32);

const position = (debt: number): Position => ({
  id: TXID,
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "1000000",
  debtStroops: String(debt),
  index: 0,
  status: "active",
  createdAt: 0,
});

const borrowTx = (hash: string, createdAt = NOW): PendingTx => ({
  hash,
  kind: "borrow",
  createdAt,
  positionUpdate: { removeId: TXID, save: position(10) },
});

function store() {
  const storage = memoryStorage();
  return createActivityStore(createJsonStore<PendingTx[]>("writz.activity.", () => storage));
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
  test("a borrow confirmed after the tab closed updates the position", async () => {
    const s = store();
    s.addTx("GOWNER", borrowTx("landed"));
    s.addTx("GOWNER", borrowTx("failed"));
    s.addTx("GOWNER", borrowTx("unknown"));
    const statuses: Record<string, TxStatus> = { landed: "SUCCESS", failed: "FAILED", unknown: "NOT_FOUND" };
    const positions = new Map([[TXID, position(0)]]);

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

    expect(positions.get(TXID)?.debtStroops).toBe("10");
    expect(s.pendingTxs("GOWNER").map((t) => t.hash)).toEqual(["unknown"]);
  });

  test("does not recreate a position this device no longer has", async () => {
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
