/// <reference types="bun-types" />
/**
 * Append-only archive of commitment-tree events (#264).
 *
 * The tree watcher keeps only the leaf list it derives and its RPC cursor.
 * Soroban RPC drops events after its retention window (the watcher assumes
 * about six days), so without this archive a fresh relayer has no way to
 * replay the tree's history and check each step against its root.
 *
 * One row per `insert_leaf`, `borrow` or `repay` event, keyed by its RPC
 * event id, so a re-polled page never duplicates a row. The watcher writes
 * here in the same tree-lock section where it applies the events and before
 * it advances its cursor: a crash in between replays the page, and the
 * replay is a no-op here.
 *
 * Its own database file, like the other watchers' stores. This is not the
 * relayer's log of its own `insert_commitment` writes - that is separate work.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

export type TreeEventKind = "insert" | "borrow" | "repay";

export interface ArchivedTreeEvent {
  /** Soroban RPC event id. */
  id: string;
  ledger: number;
  txHash: string;
  kind: TreeEventKind;
  /** The root the event published, decimal. */
  newRoot: string;
  /** Inserted commitment (insert) or the leaf's new commitment (borrow/repay), decimal. */
  commitment: string;
  /** Only set for inserts. */
  leafIndex: number | null;
  /** Sealed recovery note, hex; null when the event carried none. */
  encNote: string | null;
  /** The event as received, a base64 `xdr.ContractEvent`. */
  rawXdr: string;
}

const DB_PATH =
  process.env.TREE_EVENTS_SQLITE_PATH ?? path.join(process.cwd(), "data", "tree-events.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS tree_events (
    id         TEXT    PRIMARY KEY,
    ledger     INTEGER NOT NULL,
    tx_hash    TEXT    NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('insert', 'borrow', 'repay')),
    new_root   TEXT    NOT NULL,
    commitment TEXT    NOT NULL,
    leaf_index INTEGER,
    enc_note   TEXT,
    raw_xdr    TEXT    NOT NULL
  )
`);

const _insert = db.prepare<
  void,
  [string, number, string, TreeEventKind, string, string, number | null, string | null, string]
>(
  `INSERT OR IGNORE INTO tree_events
     (id, ledger, tx_hash, kind, new_root, commitment, leaf_index, enc_note, raw_xdr)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const COLUMNS = `id, ledger, tx_hash AS txHash, kind, new_root AS newRoot, commitment,
  leaf_index AS leafIndex, enc_note AS encNote, raw_xdr AS rawXdr`;
const _listAll = db.query<ArchivedTreeEvent, [number]>(
  `SELECT ${COLUMNS} FROM tree_events ORDER BY ledger, id LIMIT ?`,
);
// RPC event ids are a zero-padded TOID (ledger in the high bits) and an
// event index, so `id > ?` is the same order as `(ledger, id)`.
const _listAfter = db.query<ArchivedTreeEvent, [string, number]>(
  `SELECT ${COLUMNS} FROM tree_events WHERE id > ? ORDER BY ledger, id LIMIT ?`,
);
const _count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tree_events");

/** Archives a batch in one transaction. Rows already present are left as they are. */
export function archiveTreeEvents(events: ArchivedTreeEvent[]): void {
  if (events.length === 0) return;
  db.transaction(() => {
    for (const e of events) {
      _insert.run(e.id, e.ledger, e.txHash, e.kind, e.newRoot, e.commitment, e.leafIndex, e.encNote, e.rawXdr);
    }
  })();
}

/**
 * Archived events in chain order, `limit` at a time. `fromId` is exclusive:
 * pass the last id of the previous page to get the next one.
 */
export function listTreeEvents({ fromId, limit }: { fromId?: string; limit: number }): ArchivedTreeEvent[] {
  return fromId === undefined ? _listAll.all(limit) : _listAfter.all(fromId, limit);
}

export function countTreeEvents(): number {
  return _count.get()?.n ?? 0;
}
