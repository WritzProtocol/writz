import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { openSqliteClaimStore } from "../src/faucet/sqlite-store.js";

describe("sqlite faucet claim store", () => {
  test("answers cooldown and daily-count queries, and survives a reopen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-faucet-"));
    const file = path.join(dir, "faucet.db");
    const a = openSqliteClaimStore(file);
    a.record({ address: "tb1qa", ipHash: "h1", txid: "t1", amountSat: 20_000, createdAt: 1_000 });
    a.record({ address: "tb1qa", ipHash: "h2", txid: "t2", amountSat: 20_000, createdAt: 5_000 });
    a.record({ address: "tb1qb", ipHash: "h1", txid: "t3", amountSat: 20_000, createdAt: 9_000 });

    // A second handle on the same file stands in for a restarted process.
    const b = openSqliteClaimStore(file);
    expect(b.lastClaimForAddress("tb1qa")).toBe(5_000);
    expect(b.lastClaimForIp("h1")).toBe(9_000);
    expect(b.lastClaimForAddress("tb1qz")).toBeUndefined();
    expect(b.countSince(5_000)).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
