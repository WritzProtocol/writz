import fs from "fs";
import os from "os";
import path from "path";

// cursor-store.ts / event-store.ts open their sqlite files at import time -
// point both at fresh temp files *before* importing, mirroring
// test/repay-watcher.test.ts's setup so this suite never touches real
// data/vault-watcher.db or data/vault-events.db files, and each
// jest.resetModules() + re-require below genuinely simulates a process
// restart re-opening the same files.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vault-watcher-test-"));
process.env.VAULT_WATCHER_SQLITE_PATH = path.join(TMP_DIR, "vault-watcher.db");
process.env.VAULT_EVENTS_SQLITE_PATH = path.join(TMP_DIR, "vault-events.db");

// NOTE: this suite deliberately never imports `@stellar/stellar-sdk` (nor
// anything that transitively does at module scope). See the top-of-file
// comment in repay-watcher/poller.ts for why - same CJS/ESM interop crash
// under ts-jest. Tests here exercise `runVaultPollCycle`'s batch/cursor
// control flow via an injected `decodeEvent` mock, never the real
// XDR-decoding default.

describe("vault-watcher cursor-store", () => {
  afterEach(() => {
    jest.resetModules();
  });

  test("readCursor returns null before anything has been written", () => {
    const { readCursor } = require("../src/vault-watcher/cursor-store.js");
    expect(readCursor()).toBeNull();
  });

  test("writeCursor then readCursor round-trips", () => {
    const { readCursor, writeCursor } = require("../src/vault-watcher/cursor-store.js");
    writeCursor("cursor-abc-123");
    expect(readCursor()).toBe("cursor-abc-123");
  });
});

describe("vault-watcher event-store", () => {
  afterEach(() => {
    jest.resetModules();
  });

  const fixture = {
    cursor: "cursor-1",
    kind: "deposit" as const,
    depositor: "GDEPOSITOR",
    amountStroops: "1000000000",
    ledger: 100,
    txHash: "aa".repeat(32),
    ledgerCloseTime: 1_700_000_000,
  };

  test("insertVaultEvent then readAllVaultEvents round-trips", () => {
    const { insertVaultEvent, readAllVaultEvents } = require("../src/vault-watcher/event-store.js");
    insertVaultEvent(fixture);
    expect(readAllVaultEvents()).toEqual([fixture]);
  });

  test("re-inserting the same (txHash, depositor, kind, amount) is a no-op", () => {
    const { insertVaultEvent, readAllVaultEvents } = require("../src/vault-watcher/event-store.js");
    insertVaultEvent(fixture);
    insertVaultEvent(fixture);
    expect(readAllVaultEvents()).toHaveLength(1);
  });

  test("events with a different kind for the same tx are both kept", () => {
    const { insertVaultEvent, readAllVaultEvents } = require("../src/vault-watcher/event-store.js");
    insertVaultEvent(fixture);
    insertVaultEvent({ ...fixture, kind: "withdraw" as const });
    expect(readAllVaultEvents()).toHaveLength(2);
  });
});

describe("runVaultPollCycle", () => {
  // Each test gets its own fresh cursor + event DBs.
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-watcher-test-"));
    process.env.VAULT_WATCHER_SQLITE_PATH = path.join(dir, "vault-watcher.db");
    process.env.VAULT_EVENTS_SQLITE_PATH = path.join(dir, "vault-events.db");
    jest.resetModules();
  });

  // Fixture events carry a plain string tag in `topic[0]` and a
  // {depositor, amount} object in `value` - not real XDR ScVal objects.
  // `decodeEvent` below (the mock injected into runVaultPollCycle) knows how
  // to read that shape; the real `decodeVaultEvent` (which knows how to read
  // genuine ScVal objects via `scValToNative`) is never invoked by these
  // tests.
  function fakeEvent(
    tag: string,
    depositor: string,
    amount: string,
    overrides: Partial<{ ledger: number; txHash: string; ledgerClosedAt: string }> = {},
  ) {
    return {
      topic: [tag],
      value: { depositor, amount },
      ledger: overrides.ledger ?? 100,
      txHash: overrides.txHash ?? "aa".repeat(32),
      ledgerClosedAt: overrides.ledgerClosedAt ?? "2026-09-01T00:00:00Z",
    };
  }
  function decodeFake(event: { topic: unknown[]; value: unknown }) {
    const [tag] = event.topic as [string];
    const { depositor, amount } = event.value as { depositor: string; amount: string };
    const kind = tag === "deposit" ? "deposit" : tag === "withdraw" ? "withdraw" : undefined;
    return { kind, depositor: kind ? depositor : undefined, amountStroops: kind ? amount : undefined };
  }

  test("persists a deposit event and the returned cursor", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");
    const { readCursor } = require("../src/vault-watcher/cursor-store.js");
    const { readAllVaultEvents } = require("../src/vault-watcher/event-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("deposit", "GDEPOSITOR", "5000000000")],
        cursor: "cursor-after-batch",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };

    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake });

    expect(readCursor()).toBe("cursor-after-batch");
    const events = readAllVaultEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "deposit",
      depositor: "GDEPOSITOR",
      amountStroops: "5000000000",
    });
  });

  test("persists a withdraw event", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");
    const { readAllVaultEvents } = require("../src/vault-watcher/event-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("withdraw", "GWITHDRAWER", "1000000000")],
        cursor: "cursor-2",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };

    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake });

    expect(readAllVaultEvents()[0]).toMatchObject({ kind: "withdraw", depositor: "GWITHDRAWER" });
  });

  test("ignores events whose topic is neither deposit nor withdraw", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");
    const { readAllVaultEvents } = require("../src/vault-watcher/event-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("unrelated", "GX", "1")],
        cursor: "cursor-3",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };

    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake });

    expect(readAllVaultEvents()).toHaveLength(0);
  });

  test("does NOT persist the cursor if any event in the batch fails to persist, so the batch is retried", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");
    const { readCursor, writeCursor } = require("../src/vault-watcher/cursor-store.js");

    writeCursor("cursor-before-batch");

    const server = {
      getEvents: jest.fn().mockResolvedValue({
        events: [fakeEvent("deposit", "GDEPOSITOR", "1")],
        cursor: "cursor-after-failed-batch",
      }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    const persist = jest.fn(() => {
      throw new Error("disk full");
    });

    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake, persist });

    expect(readCursor()).toBe("cursor-before-batch");
  });

  test("on first run (no persisted cursor), starts from the current ledger tip rather than a historical backfill", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-4" }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 424242 }),
    };

    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake });

    expect(server.getLatestLedger).toHaveBeenCalledTimes(1);
    expect(server.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 424242 }),
    );
  });

  test("resumes from the persisted cursor on the next poll (restart simulation)", async () => {
    const { runVaultPollCycle } = require("../src/vault-watcher/poller.js");
    const { readCursor } = require("../src/vault-watcher/cursor-store.js");

    const server = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-first-run" }),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    };
    await runVaultPollCycle({ server, contractId: "CVAULT", decodeEvent: decodeFake });
    expect(readCursor()).toBe("cursor-first-run");

    jest.resetModules();
    const { runVaultPollCycle: runAfterRestart } = require("../src/vault-watcher/poller.js");
    const serverAfterRestart = {
      getEvents: jest.fn().mockResolvedValue({ events: [], cursor: "cursor-second-run" }),
      getLatestLedger: jest.fn(),
    };
    await runAfterRestart({ server: serverAfterRestart, contractId: "CVAULT", decodeEvent: decodeFake });

    expect(serverAfterRestart.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-first-run" }),
    );
    expect(serverAfterRestart.getLatestLedger).not.toHaveBeenCalled();
  });
});
