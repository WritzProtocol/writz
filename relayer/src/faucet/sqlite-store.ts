/// <reference types="bun-types" />
/**
 * Persisted Signet faucet claims, in their own database file under the
 * relayer's data directory (mount a volume at /app/data, see
 * docs/developers/deploy-targets.md). Same bun:sqlite + WAL pattern as
 * `../leaf-store.ts`. Without a volume the file is lost on redeploy, which
 * resets the one-claim rules, the per-IP allowance and the daily count.
 *
 * Schema history: the first version stored `address, ip_hash, txid,
 * amount_sat, created_at` for claims that needed no login. Opening such a
 * file adds the nullable `user_key` and `stellar_address` columns; its old
 * rows keep NULL there and still count against their Signet address and the
 * daily cap. Every claim recorded from now on carries both, and the unique
 * indexes below make one claim per account, per Stellar address and per
 * Signet address a database rule, not only a check in code.
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
  const columns = new Set(
    db.query<{ name: string }, []>("PRAGMA table_info(faucet_claims)").all().map((c) => c.name),
  );
  if (!columns.has("user_key")) db.exec("ALTER TABLE faucet_claims ADD COLUMN user_key TEXT");
  if (!columns.has("stellar_address")) db.exec("ALTER TABLE faucet_claims ADD COLUMN stellar_address TEXT");

  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_address ON faucet_claims (address, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_ip ON faucet_claims (ip_hash, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS faucet_claims_created ON faucet_claims (created_at)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS faucet_claims_user_once ON faucet_claims (user_key) WHERE user_key IS NOT NULL");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS faucet_claims_stellar_once ON faucet_claims (stellar_address) WHERE stellar_address IS NOT NULL",
  );
  // Rows from before logins were required may repeat an address, so this one
  // covers login claims only; `hasClaimForAddress` also sees the older rows.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS faucet_claims_address_once ON faucet_claims (address) WHERE user_key IS NOT NULL");

  const byAddress = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM faucet_claims WHERE address = ?");
  const byUser = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM faucet_claims WHERE user_key = ?");
  const byStellar = db.query<{ n: number }, [string]>(
    "SELECT COUNT(*) AS n FROM faucet_claims WHERE stellar_address = ?",
  );
  // Served by faucet_claims_ip (ip_hash, created_at): a range scan, already in order.
  const byIpSince = db.query<{ t: number }, [string, number]>(
    "SELECT created_at AS t FROM faucet_claims WHERE ip_hash = ? AND created_at >= ? ORDER BY created_at ASC",
  );
  const since = db.query<{ n: number }, [number]>(
    "SELECT COUNT(*) AS n FROM faucet_claims WHERE created_at >= ?",
  );
  const insert = db.prepare<void, [string, string, string, string, string, number, number]>(
    "INSERT INTO faucet_claims (address, ip_hash, user_key, stellar_address, txid, amount_sat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  return {
    hasClaimForAddress: (address) => (byAddress.get(address)?.n ?? 0) > 0,
    hasClaimForUser: (userKey) => (byUser.get(userKey)?.n ?? 0) > 0,
    hasClaimForStellarAddress: (stellarAddress) => (byStellar.get(stellarAddress)?.n ?? 0) > 0,
    ipClaimsSince: (ipHash, t) => byIpSince.all(ipHash, t).map((r) => r.t),
    countSince: (t) => since.get(t)?.n ?? 0,
    record: (c: ClaimRecord) => {
      if (byAddress.get(c.address)?.n) throw new Error("UNIQUE constraint failed: faucet_claims.address");
      insert.run(c.address, c.ipHash, c.userKey, c.stellarAddress, c.txid, c.amountSat, c.createdAt);
    },
  };
}
