import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { openSqliteClaimStore } from "../src/faucet/sqlite-store.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "writz-faucet-")), "faucet.db");
const claim = (n: number, over: Record<string, unknown> = {}) => ({
  address: `tb1q${n}`,
  ipHash: "h1",
  userKey: `u${n}`,
  stellarAddress: `G${n}`,
  txid: `t${n}`,
  amountSat: 20_000,
  createdAt: n * 1_000,
  ...over,
});

describe("sqlite faucet claim store", () => {
  test("answers the one-claim, per-IP and daily-count queries, and survives a reopen", () => {
    const file = tmp();
    const a = openSqliteClaimStore(file);
    a.record(claim(1));
    a.record(claim(5, { ipHash: "h2" }));
    a.record(claim(9));

    // A second handle on the same file stands in for a restarted process.
    const b = openSqliteClaimStore(file);
    expect(b.hasClaimForAddress("tb1q5")).toBe(true);
    expect(b.hasClaimForAddress("tb1qz")).toBe(false);
    expect(b.hasClaimForUser("u1")).toBe(true);
    expect(b.hasClaimForUser("u2")).toBe(false);
    expect(b.hasClaimForStellarAddress("G9")).toBe(true);
    expect(b.hasClaimForStellarAddress("G2")).toBe(false);
    expect(b.ipClaimsSince("h1", 0)).toEqual([1_000, 9_000]);
    expect(b.ipClaimsSince("h1", 1_001)).toEqual([9_000]);
    expect(b.ipClaimsSince("h3", 0)).toEqual([]);
    expect(b.countSince(5_000)).toBe(2);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test("refuses a second claim by an account, a Stellar address or a Signet address", () => {
    const store = openSqliteClaimStore(tmp());
    store.record(claim(1));
    expect(() => store.record(claim(2, { userKey: "u1" }))).toThrow(/UNIQUE/);
    expect(() => store.record(claim(3, { stellarAddress: "G1" }))).toThrow(/UNIQUE/);
    expect(() => store.record(claim(4, { address: "tb1q1" }))).toThrow(/UNIQUE/);
    expect(store.countSince(0)).toBe(1);
  });

  test("migrates a file from before claims needed a login, and its old payouts still count", () => {
    const file = tmp();
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE faucet_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, ip_hash TEXT NOT NULL,
      txid TEXT NOT NULL, amount_sat INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    // The open faucet allowed an address again after its cooldown: duplicates exist.
    old.exec("INSERT INTO faucet_claims (address, ip_hash, txid, amount_sat, created_at) VALUES ('tb1qold', 'h', 'a', 20000, 1)");
    old.exec("INSERT INTO faucet_claims (address, ip_hash, txid, amount_sat, created_at) VALUES ('tb1qold', 'h', 'b', 20000, 2)");
    old.close();

    const store = openSqliteClaimStore(file);
    expect(store.hasClaimForAddress("tb1qold")).toBe(true);
    expect(store.countSince(0)).toBe(2);
    expect(() => store.record(claim(7, { address: "tb1qold" }))).toThrow(/UNIQUE/);
    store.record(claim(8));
    expect(store.hasClaimForUser("u8")).toBe(true);
    // Reopening a migrated file is a no-op.
    expect(openSqliteClaimStore(file).countSince(0)).toBe(3);
  });

  test("counts an IP's claims inside a sliding window, oldest first", () => {
    const store = openSqliteClaimStore(tmp());
    const hour = 3_600_000;
    // Recorded out of order: the store returns them sorted by time.
    for (const [i, at] of [[0, 20 * 60_000], [1, 0], [2, 40 * 60_000]] as const) {
      store.record(claim(i, { ipHash: "venue", createdAt: at }));
    }
    store.record(claim(9, { ipHash: "other", createdAt: 30 * 60_000 }));

    expect(store.ipClaimsSince("venue", 50 * 60_000 - hour + 1)).toEqual([0, 20 * 60_000, 40 * 60_000]);
    expect(store.ipClaimsSince("venue", hour - hour + 1)).toEqual([20 * 60_000, 40 * 60_000]);
    expect(store.ipClaimsSince("venue", 99 * 60_000 - hour + 1)).toEqual([40 * 60_000]);
    expect(store.ipClaimsSince("venue", 100 * 60_000 - hour + 1)).toEqual([]);
    expect(store.ipClaimsSince("other", 0)).toEqual([30 * 60_000]);
  });
});
