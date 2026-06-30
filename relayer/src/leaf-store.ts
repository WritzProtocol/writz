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

// Sealed recovery notes, one per leaf index (latest state for that position).
// Independent of `leaves` so a writeLeaves() replace never drops notes; a note
// is the encrypted {index, version, collateral, debt} a client trial-decrypts
// with its viewing key to rebuild positions on a fresh device (#18).
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    leaf_index INTEGER PRIMARY KEY,
    enc_note   TEXT    NOT NULL
  )
`);

const _readAll = db.query<{ commitment: string }, []>(
  "SELECT commitment FROM leaves ORDER BY idx",
);
const _deleteAll = db.query<void, []>("DELETE FROM leaves");
const _insert = db.prepare<void, [number, string]>(
  "INSERT OR REPLACE INTO leaves (idx, commitment) VALUES (?, ?)",
);
const _saveNote = db.prepare<void, [number, string]>(
  "INSERT OR REPLACE INTO notes (leaf_index, enc_note) VALUES (?, ?)",
);
const _readNotes = db.query<{ leafIndex: number; encNote: string }, []>(
  "SELECT leaf_index AS leafIndex, enc_note AS encNote FROM notes ORDER BY leaf_index",
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

/** Stores (or replaces) the sealed recovery note for a leaf index. */
export function saveNote(leafIndex: number, encNoteHex: string): void {
  _saveNote.run(leafIndex, encNoteHex);
}

/** Returns all sealed recovery notes with their leaf index. */
export function readNotes(): { leafIndex: number; encNote: string }[] {
  return _readNotes.all();
}
