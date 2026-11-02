/// <reference types="bun-types" />
/**
 * The repay watcher's durable state: its RPC events cursor and the releases
 * still owed to borrowers who repaid in full.
 *
 * Both live in one database, because they must move together. A `repay_full`
 * is recorded in the same transaction that advances the cursor, so a crash
 * can neither skip a repayment nor lose track of one. Publishing happens
 * afterwards, from the table, so a release that keeps failing holds only its
 * own row and never the cursor. Otherwise one bad position would stop every
 * later repayment, and past RPC retention those would be gone.
 *
 * A row leaves the table only when the contract shows the release.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { assertValidCursor } from "../rpc-cursor.js";

/** First retry delay. It doubles on each attempt, up to `MAX_RETRY_DELAY_MS`. */
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
/** Past this a row stops retrying and shows as stuck. About 20 hours of attempts. */
export const MAX_RELEASE_ATTEMPTS = 24;

export function releaseRetryDelayMs(attempts: number): number {
  const exponent = Math.min(attempts - 1, 20);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

export interface PendingRelease {
  /** Position txid in internal byte order, hex. */
  txid: string;
  firstSeenAt: number;
  attempts: number;
  lastError: string | null;
}

export interface ReleaseSummary {
  pending: number;
  /** Milliseconds since the epoch, or null with nothing pending. */
  oldestPendingAt: number | null;
  /** Rows that used up their attempts and need an operator. */
  stuck: number;
}

export interface ReleaseStore {
  readCursor(): string | null;
  writeCursor(cursor: string): void;
  /** Records `txids` and advances the cursor, atomically. */
  recordBatch(contractId: string, txids: string[], cursor: string, now: number): void;
  /** Rows ready to retry, oldest first. */
  due(contractId: string, now: number, limit?: number): PendingRelease[];
  markFailed(contractId: string, txid: string, error: string, now: number): void;
  remove(contractId: string, txid: string): void;
  summary(contractId: string): ReleaseSummary;
}

export function openReleaseStore(dbPath: string): ReleaseStore {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS watcher_cursor (
      id     INTEGER PRIMARY KEY CHECK (id = 1),
      cursor TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_releases (
      contract_id   TEXT    NOT NULL,
      txid          TEXT    NOT NULL,
      first_seen_at INTEGER NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      next_attempt  INTEGER NOT NULL,
      last_error    TEXT,
      PRIMARY KEY (contract_id, txid)
    )
  `);

  const readCursorQuery = db.query<{ cursor: string }, []>(
    "SELECT cursor FROM watcher_cursor WHERE id = 1",
  );
  const writeCursorStmt = db.prepare<void, [string]>(
    "INSERT INTO watcher_cursor (id, cursor) VALUES (1, ?) " +
      "ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor",
  );
  const insertStmt = db.prepare<void, [string, string, number, number]>(
    `INSERT OR IGNORE INTO pending_releases (contract_id, txid, first_seen_at, next_attempt)
     VALUES (?, ?, ?, ?)`,
  );
  const dueQuery = db.query<PendingRelease, [string, number, number, number]>(
    `SELECT txid, first_seen_at AS firstSeenAt, attempts, last_error AS lastError
     FROM pending_releases
     WHERE contract_id = ? AND next_attempt <= ? AND attempts < ?
     ORDER BY first_seen_at, txid LIMIT ?`,
  );
  const failStmt = db.prepare<void, [string, number, string, string]>(
    `UPDATE pending_releases SET attempts = attempts + 1, last_error = ?, next_attempt = ?
     WHERE contract_id = ? AND txid = ?`,
  );
  const attemptsQuery = db.query<{ attempts: number }, [string, string]>(
    "SELECT attempts FROM pending_releases WHERE contract_id = ? AND txid = ?",
  );
  const removeStmt = db.prepare<void, [string, string]>(
    "DELETE FROM pending_releases WHERE contract_id = ? AND txid = ?",
  );
  const summaryQuery = db.query<
    { pending: number; oldestPendingAt: number | null; stuck: number | null },
    [number, string]
  >(
    `SELECT COUNT(*) AS pending, MIN(first_seen_at) AS oldestPendingAt,
            SUM(attempts >= ?) AS stuck
     FROM pending_releases WHERE contract_id = ?`,
  );

  const writeCursor = (cursor: string) => {
    // Rejected here rather than at the next poll: a malformed cursor stalls
    // the watcher silently, and the RPC's own error message points at ledger
    // ranges instead of at the cursor. See ../rpc-cursor.ts.
    assertValidCursor(cursor);
    writeCursorStmt.run(cursor);
  };
  const recordBatch = db.transaction(
    (contractId: string, txids: string[], cursor: string, now: number) => {
      for (const txid of txids) insertStmt.run(contractId, txid, now, now);
      writeCursor(cursor);
    },
  );

  return {
    readCursor: () => readCursorQuery.get()?.cursor ?? null,
    writeCursor,
    recordBatch: (contractId, txids, cursor, now) => {
      recordBatch(contractId, txids, cursor, now);
    },
    due: (contractId, now, limit = 10) => dueQuery.all(contractId, now, MAX_RELEASE_ATTEMPTS, limit),
    markFailed: (contractId, txid, error, now) => {
      const attempts = (attemptsQuery.get(contractId, txid)?.attempts ?? 0) + 1;
      failStmt.run(error, now + releaseRetryDelayMs(attempts), contractId, txid);
    },
    remove: (contractId, txid) => {
      removeStmt.run(contractId, txid);
    },
    summary: (contractId) => {
      const row = summaryQuery.get(MAX_RELEASE_ATTEMPTS, contractId);
      return {
        pending: row?.pending ?? 0,
        oldestPendingAt: row?.oldestPendingAt ?? null,
        stuck: row?.stuck ?? 0,
      };
    },
  };
}

const DEFAULT_PATH =
  process.env.WATCHER_SQLITE_PATH ?? path.join(process.cwd(), "data", "watcher.db");

let shared: ReleaseStore | undefined;

/** The relayer's store, opened on first use. */
export function releaseStore(): ReleaseStore {
  return (shared ??= openReleaseStore(DEFAULT_PATH));
}
