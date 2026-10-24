/// <reference types="bun-types" />
/**
 * Persisted Signet faucet claims, in their own database file under the
 * relayer's data directory (mount a volume at /app/data, see
 * docs/developers/deploy-targets.md). Same bun:sqlite + WAL pattern as
 * `../leaf-store.ts`. Without a volume the file is lost on redeploy, which
 * resets the cooldowns and the daily count, nothing else.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import type { ClaimRecord, ClaimStore } from "./store.js";

export function openSqliteClaimStore(
  dbPath: string = process.env.FAUCET_SQLITE_PATH ?? path.join(process.cwd(), "data", "faucet.db"),
): ClaimStore {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS faucet_claims (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      address    TEXT    NOT NULL,
      ip_hash    TEXT    NOT NULL,
      txid       TEXT    NOT NULL,
      amount_sat INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_address ON faucet_claims (address, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_ip ON faucet_claims (ip_hash, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_created ON faucet_claims (created_at)");

  const byAddress = db.query<{ t: number | null }, [string]>(
    "SELECT MAX(created_at) AS t FROM faucet_claims WHERE address = ?",
  );
  const byIp = db.query<{ t: number | null }, [string]>(
    "SELECT MAX(created_at) AS t FROM faucet_claims WHERE ip_hash = ?",
  );
  const since = db.query<{ n: number }, [number]>(
    "SELECT COUNT(*) AS n FROM faucet_claims WHERE created_at >= ?",
  );
  const insert = db.prepare<void, [string, string, string, number, number]>(
    "INSERT INTO faucet_claims (address, ip_hash, txid, amount_sat, created_at) VALUES (?, ?, ?, ?, ?)",
  );

  return {
    lastClaimForAddress: (address) => byAddress.get(address)?.t ?? undefined,
    lastClaimForIp: (ipHash) => byIp.get(ipHash)?.t ?? undefined,
    countSince: (t) => since.get(t)?.n ?? 0,
    record: (c: ClaimRecord) => {
      insert.run(c.address, c.ipHash, c.txid, c.amountSat, c.createdAt);
    },
  };
}
