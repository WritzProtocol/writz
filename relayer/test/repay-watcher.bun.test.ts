import { describe, expect, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { MAX_RELEASE_ATTEMPTS, openReleaseStore, releaseRetryDelayMs } from "../src/repay-watcher/release-store";
import { runPollCycle, runReleaseSweep } from "../src/repay-watcher/poller";

const CONTRACT = "CCONTRACT";
const DEPLOY_LEDGER = 5_516_974;
const AA = "aa".repeat(32);
const BB = "bb".repeat(32);
const CC = "cc".repeat(32);
const cursorN = (n: number) => `00193273${String(n).padStart(11, "0")}-0000000000`;

const dbFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "releases-")), "watcher.db");
const fresh = () => openReleaseStore(dbFile());

const fakeEvent = (tag: string, txidHex: string) => ({ topic: [tag, txidHex] });
const decodeEvent = (event: { topic: unknown[] }) => {
  const [tag, hex] = event.topic as [string, string];
  return { topic0: tag, txid: Buffer.from(hex, "hex") };
};
const serverWith = (events: { topic: unknown[] }[], cursor: string) => ({
  getEvents: mock(async () => ({ events, cursor })),
  getLatestLedger: mock(async () => ({ sequence: 9_999_999 })),
});
const poll = (store: ReturnType<typeof fresh>, server: ReturnType<typeof serverWith>, deployLedger: number | undefined = DEPLOY_LEDGER) =>
  runPollCycle({ server, contractId: CONTRACT, store, deployLedger, decodeEvent });

describe("runPollCycle", () => {
  test("records a repay_full and advances the cursor without publishing anything", async () => {
    const store = fresh();
    await poll(store, serverWith([fakeEvent("repay_full", AA)], cursorN(1)));
    expect(store.readCursor()).toBe(cursorN(1));
    expect(store.due(CONTRACT, Date.now()).map((r) => r.txid)).toEqual([AA]);
  });

  test("ignores events that are not repay_full, and still advances", async () => {
    const store = fresh();
    await poll(store, serverWith([fakeEvent("deposit", AA)], cursorN(2)));
    expect(store.readCursor()).toBe(cursorN(2));
    expect(store.summary(CONTRACT).pending).toBe(0);
  });

  test("a fresh database starts from the deployment ledger, never from the tip", async () => {
    const server = serverWith([], cursorN(3));
    await poll(fresh(), server);
    expect(server.getLatestLedger).not.toHaveBeenCalled();
    expect(server.getEvents.mock.calls[0]).toEqual([
      expect.objectContaining({ startLedger: DEPLOY_LEDGER }),
    ]);
  });

  test("with no cursor and no deployment ledger it fails instead of guessing", async () => {
    const store = fresh();
    const server = serverWith([], cursorN(4));
    await expect(
      runPollCycle({ server, contractId: CONTRACT, store, deployLedger: undefined, decodeEvent }),
    ).rejects.toThrow("WRITZ_LEND_DEPLOY_LEDGER");
    expect(server.getEvents).not.toHaveBeenCalled();
    expect(store.readCursor()).toBeNull();
  });

  test("a stored cursor does not need the deployment ledger", async () => {
    const store = fresh();
    store.writeCursor(cursorN(5));
    const server = serverWith([], cursorN(6));
    await poll(store, server, undefined);
    expect(server.getEvents.mock.calls[0]).toEqual([expect.objectContaining({ cursor: cursorN(5) })]);
  });

  test("an RPC failure leaves the cursor where it was", async () => {
    const store = fresh();
    store.writeCursor(cursorN(7));
    const server = serverWith([], cursorN(8));
    server.getEvents.mockImplementation(async () => {
      throw new Error("startLedger must be within the ledger range");
    });
    await expect(poll(store, server)).rejects.toThrow("ledger range");
    expect(store.readCursor()).toBe(cursorN(7));
  });

  test("a batch that cannot be written leaves neither rows nor a new cursor", async () => {
    const store = fresh();
    store.writeCursor(cursorN(9));
    await expect(poll(store, serverWith([fakeEvent("repay_full", AA)], "not-a-cursor"))).rejects.toThrow("Invalid");
    expect(store.readCursor()).toBe(cursorN(9));
    expect(store.summary(CONTRACT).pending).toBe(0);
  });

  test("reading the same event twice keeps one row", async () => {
    const store = fresh();
    await poll(store, serverWith([fakeEvent("repay_full", AA)], cursorN(10)));
    await poll(store, serverWith([fakeEvent("repay_full", AA)], cursorN(11)));
    expect(store.summary(CONTRACT).pending).toBe(1);
  });

  test("pending rows and the cursor survive a restart", async () => {
    const file = dbFile();
    await poll(openReleaseStore(file), serverWith([fakeEvent("repay_full", AA)], cursorN(12)));
    const reopened = openReleaseStore(file);
    expect(reopened.readCursor()).toBe(cursorN(12));
    expect(reopened.due(CONTRACT, Date.now()).map((r) => r.txid)).toEqual([AA]);
  });
});

describe("runReleaseSweep", () => {
  const NOW = 1_800_000_000_000;
  const sweep = (
    store: ReturnType<typeof fresh>,
    publish: (txid: Buffer) => Promise<void>,
    isPublished: (txid: Buffer) => Promise<boolean> = async () => true,
    now = NOW,
  ) => runReleaseSweep({ store, contractId: CONTRACT, publish, isPublished, now: () => now });
  const pendingWith = (...txids: string[]) => {
    const store = fresh();
    store.recordBatch(CONTRACT, txids, cursorN(20), NOW);
    return store;
  };

  test("a published release leaves the table", async () => {
    const store = pendingWith(AA);
    const publish = mock(async () => {});
    await sweep(store, publish);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.summary(CONTRACT).pending).toBe(0);
  });

  test("a row stays until get_release_psbt returns a value", async () => {
    const store = pendingWith(AA);
    await sweep(store, async () => {}, async () => false);
    const [row] = store.due(CONTRACT, NOW + releaseRetryDelayMs(1));
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("not visible");
  });

  test("a transient failure clears on a later sweep", async () => {
    const store = pendingWith(AA);
    let calls = 0;
    const publish = async () => {
      if (++calls === 1) throw new Error("esplora unavailable");
    };
    await sweep(store, publish);
    expect(store.summary(CONTRACT).pending).toBe(1);
    await sweep(store, publish, undefined, NOW + releaseRetryDelayMs(1));
    expect(store.summary(CONTRACT).pending).toBe(0);
  });

  test("a failing release waits for its backoff and does not block the next one", async () => {
    const store = pendingWith(AA, BB);
    const published: string[] = [];
    const publish = async (txid: Buffer) => {
      if (txid.toString("hex") === AA) throw new Error("script mismatch");
      published.push(txid.toString("hex"));
    };
    await sweep(store, publish);
    expect(published).toEqual([BB]);
    expect(store.due(CONTRACT, NOW + releaseRetryDelayMs(1) - 1)).toEqual([]);
    expect(store.due(CONTRACT, NOW + releaseRetryDelayMs(1)).map((r) => r.txid)).toEqual([AA]);
  });

  test("the backoff doubles and is capped", () => {
    expect(releaseRetryDelayMs(2)).toBe(2 * releaseRetryDelayMs(1));
    expect(releaseRetryDelayMs(50)).toBe(releaseRetryDelayMs(40));
  });

  test("a permanent failure stops retrying, is never dropped, and shows as stuck", async () => {
    const store = pendingWith(AA);
    const errors = mock(() => {});
    const original = console.error;
    console.error = errors;
    try {
      let now = NOW;
      for (let i = 1; i <= MAX_RELEASE_ATTEMPTS; i++) {
        await sweep(store, async () => { throw new Error("refusing to co-sign"); }, undefined, now);
        now += releaseRetryDelayMs(i);
      }
      const publish = mock(async () => {});
      await sweep(store, publish, undefined, now + 1);
      expect(publish).not.toHaveBeenCalled();
      expect(store.summary(CONTRACT)).toMatchObject({ pending: 1, stuck: 1 });
      expect(errors).toHaveBeenCalled();
    } finally {
      console.error = original;
    }
  });

  test("rows of another contract are left alone", async () => {
    const store = fresh();
    store.recordBatch("COLD", [CC], cursorN(21), NOW);
    const publish = mock(async () => {});
    await sweep(store, publish);
    expect(publish).not.toHaveBeenCalled();
    expect(store.summary(CONTRACT).pending).toBe(0);
    expect(store.summary("COLD").pending).toBe(1);
  });

  test("summary reports the oldest pending row", () => {
    const store = fresh();
    store.recordBatch(CONTRACT, [AA], cursorN(22), NOW);
    store.recordBatch(CONTRACT, [BB], cursorN(23), NOW + 5);
    expect(store.summary(CONTRACT)).toMatchObject({ pending: 2, oldestPendingAt: NOW, stuck: 0 });
  });
});
