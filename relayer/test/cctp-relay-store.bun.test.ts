import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
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
});
