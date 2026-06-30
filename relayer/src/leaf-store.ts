/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "merkle.db");

// Ensure the data directory exists before opening the database.
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH, { create: true });

// WAL mode: readers don't block writers and writers don't block readers.
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS leaves (
    idx        INTEGER PRIMARY KEY,
    commitment TEXT    NOT NULL
  )
`);

const _readAll = db.query<{ commitment: string }, []>(
  "SELECT commitment FROM leaves ORDER BY idx",
);
const _deleteAll = db.query<void, []>("DELETE FROM leaves");
const _insert = db.prepare<void, [number, string]>(
  "INSERT OR REPLACE INTO leaves (idx, commitment) VALUES (?, ?)",
);

/** Returns all Merkle leaves in insertion order. */
export function readLeaves(): bigint[] {
  return _readAll.all().map((r) => BigInt(r.commitment));
}

/** Replaces the entire leaf list atomically. */
export function writeLeaves(leaves: bigint[]): void {
  db.transaction(() => {
    _deleteAll.run();
    for (let i = 0; i < leaves.length; i++) {
      _insert.run(i, leaves[i].toString());
    }
  })();
}
