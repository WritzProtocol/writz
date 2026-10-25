import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import { openSqliteRelayStore } from "../src/cctp/sqlite-store.js";
import { lookupCctpRelay, type RelayRecord } from "../src/cctp/store.js";

const hash = (c: string) => c.repeat(64);

describe("sqlite CCTP relay store", () => {
  test("keeps every field of a record across a reopen, and replaces it on update", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-cctp-relay-"));
    const file = path.join(dir, "cctp-relay.db");
    const a = openSqliteRelayStore(file);
    const full: RelayRecord = {
      burnHash: hash("a"),
      state: "submitted",
      nonce: `0x${"1".repeat(64)}`,
      recipient: "0xc766579fe25474e41f612dd345772a61325878d2",
      amount: "10000000",
      feeExecuted: "0",
      message: "0x0001",
      attestation: "0x0002",
      mintHash: `0x${"b".repeat(64)}`,
      mintedBy: "relay",
      retryable: false,
      createdAt: 1_000,
      updatedAt: 2_000,
      submittedAt: 2_000,
    };
    a.put(full);
    a.put({ burnHash: hash("c"), state: "sent", retryable: false, createdAt: 500, updatedAt: 500 });

    // A second handle on the same file stands in for a restarted process.
    const b = openSqliteRelayStore(file);
    expect(b.get(hash("a"))).toEqual(full);
    expect(b.get(hash("c"))).toEqual({ burnHash: hash("c"), state: "sent", retryable: false, createdAt: 500, updatedAt: 500 });
    expect(b.get(hash("d"))).toBeUndefined();
    expect(b.listOpen().map((r) => r.burnHash)).toEqual([hash("c"), hash("a")]);

    b.put({ ...full, state: "failed", failure: "the relay is out of Base Sepolia gas", retryable: true, updatedAt: 3_000 });
    expect(b.get(hash("a"))).toMatchObject({ state: "failed", retryable: true, failure: "the relay is out of Base Sepolia gas" });
    expect(b.listOpen().map((r) => r.burnHash)).toEqual([hash("c")]);
    expect(b.countSubmittedSince(2_000)).toBe(1);
    expect(b.countSubmittedSince(2_001)).toBe(0);
    expect(lookupCctpRelay(b, hash("a").toUpperCase())).toMatchObject({ kind: "failed", reason: "the relay is out of Base Sepolia gas" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("keeps the retry fields and lists records whose retry is due, earliest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-cctp-relay-"));
    const file = path.join(dir, "cctp-relay.db");
    const a = openSqliteRelayStore(file);
    const retrying: RelayRecord = {
      burnHash: hash("a"),
      state: "failed",
      failure: "Base Sepolia could not be reached",
      failureCode: "rpc",
      retryable: true,
      retryAt: 5_000,
      attempts: 2,
      retryingSince: 1_000,
      createdAt: 1_000,
      updatedAt: 3_000,
    };
    a.put(retrying);
    a.put({ burnHash: hash("b"), state: "arrived", mintedBy: "other", retryable: false, retryAt: 4_000, attempts: 1, createdAt: 900, updatedAt: 900 });
    a.put({ burnHash: hash("c"), state: "failed", failureCode: "refused", retryable: false, createdAt: 800, updatedAt: 800 });

    const b = openSqliteRelayStore(file);
    expect(b.get(hash("a"))).toEqual(retrying);
    expect(b.listDue(3_999)).toEqual([]);
    expect(b.listDue(4_000).map((r) => r.burnHash)).toEqual([hash("b")]);
    expect(b.listDue(10_000).map((r) => r.burnHash)).toEqual([hash("b"), hash("a")]);
    expect(lookupCctpRelay(b, hash("a"))).toMatchObject({ kind: "confirming", retrying: true, nextRetryAt: new Date(5_000).toISOString() });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("adds the retry columns to a database written before they existed, keeping its records", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-cctp-relay-"));
    const file = path.join(dir, "cctp-relay.db");
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE cctp_relays (
      burn_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT, recipient TEXT, amount TEXT, fee_executed TEXT,
      message TEXT, attestation TEXT, mint_hash TEXT, minted_by TEXT, failure TEXT,
      retryable INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, submitted_at INTEGER)`);
    old.exec(`INSERT INTO cctp_relays (burn_hash, state, failure, retryable, created_at, updated_at)
      VALUES ('${hash("d")}', 'failed', 'the relay is out of Base Sepolia gas', 1, 100, 200)`);
    old.close();

    const s = openSqliteRelayStore(file);
    expect(s.get(hash("d"))).toEqual({
      burnHash: hash("d"), state: "failed", failure: "the relay is out of Base Sepolia gas", retryable: true, createdAt: 100, updatedAt: 200,
    });
    // A failure from before automatic retries has no schedule: it waits for a new POST, as it did then.
    expect(s.listDue(Number.MAX_SAFE_INTEGER)).toEqual([]);
    s.put({ ...s.get(hash("d"))!, retryAt: 300, attempts: 1, retryingSince: 200, failureCode: "out_of_gas" });
    expect(openSqliteRelayStore(file).get(hash("d"))).toMatchObject({ retryAt: 300, failureCode: "out_of_gas" });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
