/// <reference types="bun-types" />
/**
 * The onboarding funnel in its own database file under the relayer's data
 * directory, next to `faucet.db` (same bun:sqlite + WAL pattern as
 * `../faucet/sqlite-store.ts`). Without a volume the file is lost on
 * redeploy, which resets the funnel and its subject secret.
 *
 * The subject secret is generated the first time the file is created and
 * stored in it, so the same address maps to the same subject across restarts
 * while nothing outside this file can link a subject back to an address.
 */
import { Database } from "bun:sqlite";
import { randomBytes } from "crypto";
import path from "path";
import fs from "fs";
import type { FunnelRow, FunnelStore } from "./store.js";

export function openSqliteFunnelStore(
  dbPath: string = process.env.ONBOARDING_SQLITE_PATH ?? path.join(process.cwd(), "data", "onboarding.db"),
): FunnelStore {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS funnel_events (
      subject    TEXT    NOT NULL,
      step       TEXT    NOT NULL,
      outcome    TEXT    NOT NULL,
      channel    TEXT    NOT NULL,
      verified   INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (subject, step, outcome)
    )
  `);
  db.exec("CREATE TABLE IF NOT EXISTS funnel_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS funnel_events_created ON funnel_events (created_at)");

  const readSecret = db.query<{ value: string }, [string]>("SELECT value FROM funnel_meta WHERE key = ?");
  let secret = readSecret.get("subject_secret")?.value;
  if (!secret) {
    db.prepare<void, [string, string]>("INSERT OR IGNORE INTO funnel_meta (key, value) VALUES (?, ?)").run(
      "subject_secret",
      randomBytes(32).toString("hex"),
    );
    secret = readSecret.get("subject_secret")!.value;
  }

  const insert = db.prepare<{ changes: number }, [string, string, string, string, number, number]>(
    "INSERT OR IGNORE INTO funnel_events (subject, step, outcome, channel, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const all = db.query<
    { subject: string; step: string; outcome: string; channel: string; verified: number; created_at: number },
    []
  >("SELECT subject, step, outcome, channel, verified, created_at FROM funnel_events ORDER BY created_at ASC");

  const key = secret;
  return {
    record(row: FunnelRow) {
      const res = insert.run(row.subject, row.step, row.outcome, row.channel, row.verified ? 1 : 0, row.createdAt) as unknown as {
        changes: number;
      };
      return res.changes > 0;
    },
    rows: () =>
      all.all().map((r) => ({
        subject: r.subject,
        step: r.step,
        outcome: r.outcome,
        channel: r.channel,
        verified: r.verified === 1,
        createdAt: r.created_at,
      })),
    secret: () => key,
  };
}
