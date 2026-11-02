/**
 * bun run export-lend-events --out <file>
 *
 * Writes the event archive as NDJSON (see archive-file.ts), for a rebuild past
 * RPC retention: `bun run rebuild-lend-state --source archive --file <file>`.
 * Safe while the relayer runs: the rows and the cursor are read in one
 * transaction, and the file appears only once it is complete.
 *
 *   WRITZ_LEND_ID               the contract
 *   STELLAR_NETWORK_PASSPHRASE  defaults to testnet
 *   LEND_EVENTS_SQLITE_PATH     the archive, defaults to data/lend-events.db
 */
import fs from "fs";
import { Networks } from "@stellar/stellar-sdk";
import { archiveLines } from "./archive-file.js";
import { lendEventsDbPath, openLendEventStore } from "./store.js";

function main(): void {
  const i = process.argv.indexOf("--out");
  const out = i === -1 ? undefined : process.argv[i + 1];
  if (!out) throw new Error("--out <file> is required");
  const contractId = process.env["WRITZ_LEND_ID"]?.trim();
  if (!contractId) throw new Error("WRITZ_LEND_ID is not set");
  const networkPassphrase = process.env["STELLAR_NETWORK_PASSPHRASE"] ?? Networks.TESTNET;
  const dbPath = lendEventsDbPath();
  // Opening a missing path would create an empty archive and export nothing.
  if (!fs.existsSync(dbPath)) throw new Error(`no archive at ${dbPath}`);

  const store = openLendEventStore(dbPath);
  try {
    const snapshot = store.snapshot(contractId);
    const tmp = `${out}.partial`;
    const fd = fs.openSync(tmp, "w");
    try {
      for (const line of archiveLines(snapshot, { contractId, networkPassphrase })) fs.writeSync(fd, line + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, out);
    const { rows } = snapshot;
    console.log(`Exported ${rows.length} events (ledgers ${rows[0]?.ledger ?? "-"} to ${rows[rows.length - 1]?.ledger ?? "-"}) to ${out}`);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (e) {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
