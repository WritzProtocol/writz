/// <reference types="bun-types" />
/**
 * Persisted DeFindex vault deposit/withdraw events.
 *
 * Separate database file from `cursor-store.ts`'s (mirrors the split
 * `../leaf-store.ts` and `../repay-watcher/cursor-store.ts` already use) so
 * this watcher's event history is independent of its own cursor's lifecycle
 * and of every other watcher's storage.
 *
 * This table is the source of truth #115 (TVL + unique depositors) and #116
 * (30-day retention cohorts) read from - it stores one row per deposit or
 * withdraw event, not an aggregate, so both endpoints can be recomputed from
 * scratch at any time without re-polling the chain.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

export type VaultEventKind = "deposit" | "withdraw";

export interface VaultEvent {
  /** Soroban RPC events cursor this event was read at - kept alongside the
   * event (not just in cursor-store.ts) so a given row's provenance is
   * self-contained for debugging/replay. */
  cursor: string;
  kind: VaultEventKind;
  /** Stellar G-address of the depositor/withdrawer. */
  depositor: string;
  /** Amount in the vault's underlying asset (USDC, 7-decimal stroops), as
   * a decimal string - stored as text to avoid float precision loss for
   * values that can exceed JS's safe integer range. */
  amountStroops: string;
  ledger: number;
  txHash: string;
  /** Ledger close time, Unix seconds - what #116's cohort bucketing keys
   * off, rather than wall-clock time of ingestion. */
  ledgerCloseTime: number;
}

const DB_PATH =
  process.env.VAULT_EVENTS_SQLITE_PATH ?? path.join(process.cwd(), "data", "vault-events.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS vault_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cursor            TEXT    NOT NULL,
    kind              TEXT    NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
    depositor         TEXT    NOT NULL,
    amount_stroops    TEXT    NOT NULL,
    ledger            INTEGER NOT NULL,
    tx_hash           TEXT    NOT NULL,
    ledger_close_time INTEGER NOT NULL,
    UNIQUE (tx_hash, depositor, kind, amount_stroops)
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_vault_events_depositor ON vault_events (depositor)");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_vault_events_close_time ON vault_events (ledger_close_time)",
);

const _insert = db.prepare<void, [string, string, string, string, number, string, number]>(
  `INSERT OR IGNORE INTO vault_events
     (cursor, kind, depositor, amount_stroops, ledger, tx_hash, ledger_close_time)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const _readAll = db.query<
  {
    cursor: string;
    kind: VaultEventKind;
    depositor: string;
    amountStroops: string;
    ledger: number;
    txHash: string;
    ledgerCloseTime: number;
  },
  []
>(
  `SELECT cursor, kind, depositor, amount_stroops AS amountStroops, ledger,
          tx_hash AS txHash, ledger_close_time AS ledgerCloseTime
   FROM vault_events ORDER BY ledger_close_time`,
);

/**
 * Records a vault event. Idempotent - re-inserting the same
 * (tx_hash, depositor, kind, amount) is a no-op, so a retried batch (see
 * `runVaultPollCycle`'s at-least-once delivery) never double-counts.
 */
export function insertVaultEvent(event: VaultEvent): void {
  _insert.run(
    event.cursor,
    event.kind,
    event.depositor,
    event.amountStroops,
    event.ledger,
    event.txHash,
    event.ledgerCloseTime,
  );
}

/** Returns every persisted vault event, oldest first. #115/#116 build their
 * aggregates from this rather than maintaining separate running totals, so
 * a bug in an aggregate can always be fixed by recomputing from raw events. */
export function readAllVaultEvents(): VaultEvent[] {
  return _readAll.all();
}
