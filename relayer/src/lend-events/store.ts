/// <reference types="bun-types" />
/**
 * Append-only archive of `writz-lend` events.
 *
 * RPC keeps events for days, so without this the relayer could not say what
 * happened on the contract a week ago. Rows and the cursor are written in one
 * transaction, so a crash can leave neither a gap nor a double read, and the
 * RPC event ID is the primary key, so reading an event twice changes nothing.
 *
 * `raw_xdr` keeps the event as the chain returned it. The decoded columns are
 * a convenience; anything that must be certain re-decodes it.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { assertValidCursor } from "../rpc-cursor.js";

export interface LendEventRow {
  /** RPC event ID, unique and ordered across the chain. */
  id: string;
  contractId: string;
  ledger: number;
  txHash: string;
  name: string;
  /** Position txid (internal byte order, hex), or the supplier's address. */
  subject: string;
  /** Decoded fields as JSON, with amounts as decimal strings. */
  data: string;
  rawXdr: string;
}

export interface LendEventStore {
  readCursor(): string | null;
  /** Writes `rows` and advances the cursor, atomically. */
  commit(rows: LendEventRow[], cursor: string): void;
  list(contractId: string): LendEventRow[];
  lastLedger(contractId: string): number | null;
}

export function openLendEventStore(dbPath: string): LendEventStore {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lend_events (
      id          TEXT    PRIMARY KEY,
      contract_id TEXT    NOT NULL,
      ledger      INTEGER NOT NULL,
      tx_hash     TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      subject     TEXT    NOT NULL,
      data        TEXT    NOT NULL,
      raw_xdr     TEXT    NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_lend_events_contract ON lend_events (contract_id, ledger)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lend_events_cursor (
      id     INTEGER PRIMARY KEY CHECK (id = 1),
      cursor TEXT NOT NULL
    )
  `);

  const readCursorQuery = db.query<{ cursor: string }, []>(
    "SELECT cursor FROM lend_events_cursor WHERE id = 1",
  );
  const writeCursorStmt = db.prepare<void, [string]>(
    "INSERT INTO lend_events_cursor (id, cursor) VALUES (1, ?) " +
      "ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor",
  );
  const insertStmt = db.prepare<void, [string, string, number, string, string, string, string, string]>(
    `INSERT OR IGNORE INTO lend_events (id, contract_id, ledger, tx_hash, name, subject, data, raw_xdr)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const listQuery = db.query<LendEventRow, [string]>(
    `SELECT id, contract_id AS contractId, ledger, tx_hash AS txHash, name, subject, data,
            raw_xdr AS rawXdr
     FROM lend_events WHERE contract_id = ? ORDER BY id`,
  );
  const lastLedgerQuery = db.query<{ ledger: number | null }, [string]>(
    "SELECT MAX(ledger) AS ledger FROM lend_events WHERE contract_id = ?",
  );

  const commit = db.transaction((rows: LendEventRow[], cursor: string) => {
    for (const r of rows) {
      insertStmt.run(r.id, r.contractId, r.ledger, r.txHash, r.name, r.subject, r.data, r.rawXdr);
    }
    assertValidCursor(cursor);
    writeCursorStmt.run(cursor);
  });

  return {
    readCursor: () => readCursorQuery.get()?.cursor ?? null,
    commit: (rows, cursor) => {
      commit(rows, cursor);
    },
    list: (contractId) => listQuery.all(contractId),
    lastLedger: (contractId) => lastLedgerQuery.get(contractId)?.ledger ?? null,
  };
}

const DEFAULT_PATH =
  process.env.LEND_EVENTS_SQLITE_PATH ?? path.join(process.cwd(), "data", "lend-events.db");

let shared: LendEventStore | undefined;

/** The relayer's archive, opened on first use. */
export function lendEventStore(): LendEventStore {
  return (shared ??= openLendEventStore(DEFAULT_PATH));
}
