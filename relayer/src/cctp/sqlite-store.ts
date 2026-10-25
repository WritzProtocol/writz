/// <reference types="bun-types" />
/**
 * Persisted relay records, in their own database file under the relayer's
 * data directory (mount a volume at /app/data, see
 * docs/developers/deploy-targets.md). Same bun:sqlite + WAL pattern as
 * `../faucet/sqlite-store.ts`. Without a volume a redeploy forgets past
 * transfers: the app then reads 404 for an old burn, and a new request for
 * it finds the nonce already spent on Base Sepolia rather than minting twice.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import type { RelayRecord, RelayState, RelayStore } from "./store.js";

interface Row {
  burn_hash: string;
  state: string;
  nonce: string | null;
  recipient: string | null;
  amount: string | null;
  fee_executed: string | null;
  message: string | null;
  attestation: string | null;
  mint_hash: string | null;
  minted_by: string | null;
  failure: string | null;
  retryable: number;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
}

function fromRow(r: Row): RelayRecord {
  return {
    burnHash: r.burn_hash,
    state: r.state as RelayState,
    ...(r.nonce !== null ? { nonce: r.nonce } : {}),
    ...(r.recipient !== null ? { recipient: r.recipient } : {}),
    ...(r.amount !== null ? { amount: r.amount } : {}),
    ...(r.fee_executed !== null ? { feeExecuted: r.fee_executed } : {}),
    ...(r.message !== null ? { message: r.message } : {}),
    ...(r.attestation !== null ? { attestation: r.attestation } : {}),
    ...(r.mint_hash !== null ? { mintHash: r.mint_hash } : {}),
    ...(r.minted_by !== null ? { mintedBy: r.minted_by as "relay" | "other" } : {}),
    ...(r.failure !== null ? { failure: r.failure } : {}),
    retryable: r.retryable === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.submitted_at !== null ? { submittedAt: r.submitted_at } : {}),
  };
}

export function openSqliteRelayStore(
  dbPath: string = process.env.CCTP_RELAY_SQLITE_PATH ?? path.join(process.cwd(), "data", "cctp-relay.db"),
): RelayStore {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cctp_relays (
      burn_hash    TEXT    PRIMARY KEY,
      state        TEXT    NOT NULL,
      nonce        TEXT,
      recipient    TEXT,
      amount       TEXT,
      fee_executed TEXT,
      message      TEXT,
      attestation  TEXT,
      mint_hash    TEXT,
      minted_by    TEXT,
      failure      TEXT,
      retryable    INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      submitted_at INTEGER
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS cctp_relays_state ON cctp_relays (state, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS cctp_relays_submitted ON cctp_relays (submitted_at)");

  const byHash = db.query<Row, [string]>("SELECT * FROM cctp_relays WHERE burn_hash = ?");
  const open = db.query<Row, []>(
    "SELECT * FROM cctp_relays WHERE state NOT IN ('arrived', 'failed') ORDER BY created_at ASC",
  );
  const submittedSince = db.query<{ n: number }, [number]>(
    "SELECT COUNT(*) AS n FROM cctp_relays WHERE submitted_at >= ?",
  );
  const upsert = db.prepare<
    void,
    [
      string, string, string | null, string | null, string | null, string | null, string | null, string | null,
      string | null, string | null, string | null, number, number, number, number | null,
    ]
  >(
    `INSERT OR REPLACE INTO cctp_relays
       (burn_hash, state, nonce, recipient, amount, fee_executed, message, attestation,
        mint_hash, minted_by, failure, retryable, created_at, updated_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    get: (burnHash) => {
      const row = byHash.get(burnHash);
      return row ? fromRow(row) : undefined;
    },
    put: (r) => {
      upsert.run(
        r.burnHash, r.state, r.nonce ?? null, r.recipient ?? null, r.amount ?? null, r.feeExecuted ?? null,
        r.message ?? null, r.attestation ?? null, r.mintHash ?? null, r.mintedBy ?? null, r.failure ?? null,
        r.retryable ? 1 : 0, r.createdAt, r.updatedAt, r.submittedAt ?? null,
      );
    },
    countSubmittedSince: (since) => submittedSince.get(since)?.n ?? 0,
    listOpen: () => open.all().map(fromRow),
  };
}
