import fs from "fs";
import os from "os";
import path from "path";

// cursor-store.ts opens its sqlite file at import time — point it at a
// fresh temp file *before* importing, so this suite doesn't touch the
// real data/watcher.db and each `jest.resetModules()` + re-require below
// genuinely simulates a process restart re-opening the same file.
const TMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "watcher-test-")), "watcher.db");
process.env.WATCHER_SQLITE_PATH = TMP_DB;

// NOTE: this suite deliberately never imports `@stellar/stellar-sdk` (nor
// anything that transitively does at module scope, like `./handler.js`).
// That package's CJS build `require()`s an ESM-only `@noble/hashes` file,
// which crashes under ts-jest's strict CommonJS loader (works fine under
// Bun's own runtime, which the relayer actually ships on). `poller.ts`
// defers all such imports into function bodies for exactly this reason —
// see that file's top-of-file comment. Tests here exercise `runPollCycle`'s
// batch/cursor control flow via an injected `decodeEvent` mock, never the
// real XDR-decoding default.

describe("cursor-store", () => {
  afterEach(() => {
    jest.resetModules();
  });

  test("readCursor returns null before anything has been written", () => {
    const { readCursor } = require("../src/repay-watcher/cursor-store.js");
    expect(readCursor()).toBeNull();
  });

  test("writeCursor then readCursor round-trips", () => {
    const { readCursor, writeCursor } = require("../src/repay-watcher/cursor-store.js");
    writeCursor("cursor-abc-123");
    expect(readCursor()).toBe("cursor-abc-123");
  });

  test("a later writeCursor overwrites the earlier value", () => {
    const { readCursor, writeCursor } = require("../src/repay-watcher/cursor-store.js");
    writeCursor("first");
    writeCursor("second");
    expect(readCursor()).toBe("second");
  });

  test("the cursor survives a simulated process restart (same DB file, fresh module load)", () => {
    {
      const { writeCursor } = require("../src/repay-watcher/cursor-store.js");
      writeCursor("survives-restart");
    }

    // Simulate a restart: drop the module from the cache and re-require it,
    // exactly as a fresh `bun src/index.ts` process would re-open the file.
    jest.resetModules();

    const { readCursor } = require("../src/repay-watcher/cursor-store.js");
    expect(readCursor()).toBe("survives-restart");
  });
});

describe("runPollCycle", () => {
  // Each test gets its own fresh cursor DB — these tests exercise
  // runPollCycle's per-call control flow, not cross-test persistence (that's
  // exclusively what the dedicated "resumes from the persisted cursor"
  // test below covers, which manages its own restart simulation).
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-test-"));
    process.env.WATCHER_SQLITE_PATH = path.join(dir, "watcher.db");
    jest.resetModules();
  });

  // Fixture events carry a plain string tag in `topic[0]` and a hex string
  // in `topic[1]` — not real XDR ScVal objects. `decodeEvent` below (the
  // mock injected into runPollCycle) knows how to read that shape; the real
  // `decodeRepayFullEvent` (which knows how to read genuine ScVal objects
  // via `scValToNative`) is never invoked by these tests.
  function fakeEvent(tag: string, txidHex: string) {
    return { topic: [tag, txidHex] };
  }
  function decodeFake(event: { topic: unknown[] }) {
    const [tag, txidHex] = event.topic as [string, string];
    return { topic0: tag, txid: Buffer.from(txidHex, "hex") };
  }

  test("handles a repay_full event and persists the returned cursor", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");
    const { readCursor } = require("../src/repay-watcher/cursor-store.js");

    const txidHex = "aa".repeat(32);
    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("repay_full", txidHex)],
        cursor: "cursor-after-batch",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    const handle = jest.fn().mockResolvedValue(undefined);

    await runPollCycle({ server, contractId: "CCONTRACT", handle, decodeEvent: decodeFake });

    expect(handle).toHaveBeenCalledTimes(1);
    expect((handle.mock.calls[0][0] as Buffer).toString("hex")).toBe(txidHex);
    expect(readCursor()).toBe("cursor-after-batch");
  });

  test("ignores events whose first topic is not repay_full", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("deposit", "bb".repeat(32))],
        cursor: "cursor-2",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    const handle = jest.fn().mockResolvedValue(undefined);

    await runPollCycle({ server, contractId: "CCONTRACT", handle, decodeEvent: decodeFake });

    expect(handle).not.toHaveBeenCalled();
  });

  test("does NOT persist the cursor if any event in the batch fails, so the batch is retried", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");
    const { readCursor, writeCursor } = require("../src/repay-watcher/cursor-store.js");

    writeCursor("cursor-before-batch");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("repay_full", "cc".repeat(32))],
        cursor: "cursor-after-failed-batch",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    const handle = jest.fn().mockRejectedValue(new Error("esplora unavailable"));

    await runPollCycle({ server, contractId: "CCONTRACT", handle, decodeEvent: decodeFake });

    expect(handle).toHaveBeenCalledTimes(1);
    // Cursor must be unchanged — the failed batch will be re-fetched (and
    // retried) on the next poll, rather than silently skipped.
    expect(readCursor()).toBe("cursor-before-batch");
  });

  test("on first run (no persisted cursor), starts from the current ledger tip rather than a historical backfill", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-3" }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 424242 }),
    };
    const handle = jest.fn();

    await runPollCycle({ server, contractId: "CCONTRACT", handle, decodeEvent: decodeFake });

    expect(server.getLatestLedger).toHaveBeenCalledTimes(1);
    expect(server.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 424242 }),
    );
  });

  test("a batch with zero matching events still persists the new cursor", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");
    const { readCursor } = require("../src/repay-watcher/cursor-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-empty-batch" }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };

    await runPollCycle({
      server,
      contractId: "CCONTRACT",
      handle: jest.fn(),
      decodeEvent: decodeFake,
    });

    expect(readCursor()).toBe("cursor-empty-batch");
  });

  test("resumes from the persisted cursor on the next poll (restart simulation)", async () => {
    const { runPollCycle } = require("../src/repay-watcher/poller.js");
    const { readCursor } = require("../src/repay-watcher/cursor-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-first-run" }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    await runPollCycle({
      server,
      contractId: "CCONTRACT",
      handle: jest.fn(),
      decodeEvent: decodeFake,
    });
    expect(readCursor()).toBe("cursor-first-run");

    // Simulate a full process restart: fresh module graph, fresh mock
    // server instance — the only thing carried over is the sqlite file.
    jest.resetModules();
    const { runPollCycle: runPollCycleAfterRestart } = require("../src/repay-watcher/poller.js");
    const serverAfterRestart = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-second-run" }),
      getLatestLedger: jest.fn(),
    };
    await runPollCycleAfterRestart({
      server: serverAfterRestart,
      contractId: "CCONTRACT",
      handle: jest.fn(),
      decodeEvent: decodeFake,
    });

    // Must resume via `cursor`, not re-derive a startLedger from the tip —
    // proves the restart didn't silently reset to "now".
    expect(serverAfterRestart.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-first-run" }),
    );
    expect(serverAfterRestart.getLatestLedger).not.toHaveBeenCalled();
  });
});
