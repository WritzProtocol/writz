import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { openSqliteClaimStore } from "../src/faucet/sqlite-store.js";

describe("sqlite faucet claim store", () => {
  test("answers cooldown, per-IP and daily-count queries, and survives a reopen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-faucet-"));
    const file = path.join(dir, "faucet.db");
    const a = openSqliteClaimStore(file);
    a.record({ address: "tb1qa", ipHash: "h1", txid: "t1", amountSat: 20_000, createdAt: 1_000 });
    a.record({ address: "tb1qa", ipHash: "h2", txid: "t2", amountSat: 20_000, createdAt: 5_000 });
    a.record({ address: "tb1qb", ipHash: "h1", txid: "t3", amountSat: 20_000, createdAt: 9_000 });

    // A second handle on the same file stands in for a restarted process.
    const b = openSqliteClaimStore(file);
    expect(b.lastClaimForAddress("tb1qa")).toBe(5_000);
    expect(b.ipClaimsSince("h1", 0)).toEqual([1_000, 9_000]);
    expect(b.ipClaimsSince("h1", 1_001)).toEqual([9_000]);
    expect(b.ipClaimsSince("h3", 0)).toEqual([]);
    expect(b.lastClaimForAddress("tb1qz")).toBeUndefined();
    expect(b.countSince(5_000)).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("counts an IP's claims inside a sliding window, oldest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-faucet-"));
    const store = openSqliteClaimStore(path.join(dir, "faucet.db"));
    const hour = 3_600_000;
    // Recorded out of order: the store returns them sorted by time.
    for (const [i, at] of [[0, 20 * 60_000], [1, 0], [2, 40 * 60_000]] as const) {
      store.record({ address: `tb1q${i}`, ipHash: "venue", txid: `t${i}`, amountSat: 20_000, createdAt: at });
    }
    store.record({ address: "tb1qx", ipHash: "other", txid: "tx", amountSat: 20_000, createdAt: 30 * 60_000 });

    // At 50 min, a one-hour window holds all three venue claims.
    expect(store.ipClaimsSince("venue", 50 * 60_000 - hour + 1)).toEqual([0, 20 * 60_000, 40 * 60_000]);
    // At exactly 60 min the claim made at 0 has left the window.
    expect(store.ipClaimsSince("venue", hour - hour + 1)).toEqual([20 * 60_000, 40 * 60_000]);
    // At 99 min only the claim made at 40 min is left; at 100 min it is gone too.
    expect(store.ipClaimsSince("venue", 99 * 60_000 - hour + 1)).toEqual([40 * 60_000]);
    expect(store.ipClaimsSince("venue", 100 * 60_000 - hour + 1)).toEqual([]);
    expect(store.ipClaimsSince("other", 0)).toEqual([30 * 60_000]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
