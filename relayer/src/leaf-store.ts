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

// What the ZK keeper (#212) knows about each leaf with debt: the liquidation
// witness it opened from the latest borrow/repay keeper note. Keyed by leaf
// like `notes`; a later note for the same leaf replaces it.
db.exec(`
  CREATE TABLE IF NOT EXISTS keeper_positions (
    leaf_index  INTEGER PRIMARY KEY,
    commitment  TEXT    NOT NULL,
    liq_key     TEXT    NOT NULL,
    nonce       TEXT    NOT NULL,
    collateral  TEXT    NOT NULL,
    debt        TEXT    NOT NULL,
    timelock    INTEGER NOT NULL,
    liquidated  INTEGER NOT NULL DEFAULT 0
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

export interface StoredKeeperPosition {
  leafIndex: number;
  commitment: bigint;
  liqKey: bigint;
  nonce: bigint;
  collateralSats: bigint;
  debtStroops: bigint;
  timelockHeight: number;
  liquidated: boolean;
}

const _saveKeeper = db.prepare<void, [number, string, string, string, string, string, number]>(
  `INSERT OR REPLACE INTO keeper_positions
     (leaf_index, commitment, liq_key, nonce, collateral, debt, timelock, liquidated)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
);
const _readKeeper = db.query<
  { leafIndex: number; commitment: string; liqKey: string; nonce: string; collateral: string; debt: string; timelock: number; liquidated: number },
  []
>(
  `SELECT leaf_index AS leafIndex, commitment, liq_key AS liqKey, nonce, collateral, debt, timelock, liquidated
   FROM keeper_positions ORDER BY leaf_index`,
);
const _markLiquidated = db.prepare<void, [number, string]>(
  "UPDATE keeper_positions SET liquidated = 1 WHERE leaf_index = ? AND commitment = ?",
);

/** Records (or replaces) the keeper's view of a leaf (#212). */
export function saveKeeperPosition(p: Omit<StoredKeeperPosition, "liquidated">): void {
  _saveKeeper.run(
    p.leafIndex,
    p.commitment.toString(),
    p.liqKey.toString(),
    p.nonce.toString(),
    p.collateralSats.toString(),
    p.debtStroops.toString(),
    p.timelockHeight,
  );
}

export function readKeeperPositions(): StoredKeeperPosition[] {
  return _readKeeper.all().map((r) => ({
    leafIndex: r.leafIndex,
    commitment: BigInt(r.commitment),
    liqKey: BigInt(r.liqKey),
    nonce: BigInt(r.nonce),
    collateralSats: BigInt(r.collateral),
    debtStroops: BigInt(r.debt),
    timelockHeight: r.timelock,
    liquidated: r.liquidated === 1,
  }));
}

/** Marks a leaf's position liquidated, only if it still holds `commitment`. */
export function markKeeperLiquidated(leafIndex: number, commitment: bigint): void {
  _markLiquidated.run(leafIndex, commitment.toString());
}
