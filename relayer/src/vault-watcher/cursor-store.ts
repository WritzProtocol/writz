/// <reference types="bun-types" />
/**
 * Persisted Soroban RPC events cursor for the vault watcher.
 *
 * Exact copy of the pattern in `../repay-watcher/cursor-store.ts`, in its
 * own database file so this watcher's cursor is independent of the repay
 * watcher's and of `../vault-watcher/event-store.ts`'s lifecycle.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.VAULT_WATCHER_SQLITE_PATH ?? path.join(process.cwd(), "data", "vault-watcher.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS watcher_cursor (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    cursor TEXT NOT NULL
  )
`);

const _read = db.query<{ cursor: string }, []>(
  "SELECT cursor FROM watcher_cursor WHERE id = 1",
);
const _write = db.prepare<void, [string]>(
  "INSERT INTO watcher_cursor (id, cursor) VALUES (1, ?) " +
    "ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor",
);

/** Returns the last persisted RPC events cursor, or `null` if the watcher
 * has never successfully polled before (first run). */
export function readCursor(): string | null {
  return _read.get()?.cursor ?? null;
}

/** Persists the RPC events cursor. Call this after every poll - even one
 * that found no matching events - so a restart never re-scans from "now". */
export function writeCursor(cursor: string): void {
  _write.run(cursor);
}
