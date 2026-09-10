/**
 * Soroban RPC events cursor format, shared by both watchers.
 *
 * A cursor is not "ledger-index". It is a 19-digit zero-padded TOID followed
 * by a 10-digit zero-padded event index, e.g.
 * `0019652868403363840-0000000000`, where the TOID packs the ledger sequence
 * into the high 32 bits.
 *
 * This module exists because getting that wrong is silent. `getEvents` with a
 * malformed cursor is rejected, the poller catches the failure and retries the
 * same stored cursor forever, and the watcher stops indexing with nothing in
 * the database and no error anywhere a person would look. Worse, the RPC's
 * complaint is `startLedger must be within the ledger range`, which sends
 * whoever reads it to look at ledger ranges rather than at the cursor.
 *
 * That is not hypothetical: it happened while backfilling the vault watcher,
 * from a hand-written `4575790-0`.
 */

/** `<19-digit TOID>-<10-digit event index>`. */
const CURSOR_FORMAT = /^\d{19}-\d{10}$/;

export function isValidCursor(cursor: string): boolean {
  return CURSOR_FORMAT.test(cursor);
}

/**
 * The cursor positioned immediately before the first event of `ledger`.
 *
 * Cursors are exclusive - `getEvents` returns what comes *after* one - so this
 * is what to use when a backfill should include `ledger` itself rather than
 * start after it.
 */
export function cursorForLedger(ledger: number): string {
  if (!Number.isInteger(ledger) || ledger < 0) {
    throw new Error(`Ledger sequence must be a non-negative integer, got: ${ledger}`);
  }
  // TOID packs the ledger sequence into the high 32 bits. BigInt because the
  // result exceeds Number.MAX_SAFE_INTEGER for any real ledger.
  const toid = BigInt(ledger) << 32n;
  return `${toid.toString().padStart(19, "0")}-${"0".repeat(10)}`;
}

/** Throws with the format and a worked example, rather than storing a cursor that will stall the watcher. */
export function assertValidCursor(cursor: string): void {
  if (!isValidCursor(cursor)) {
    throw new Error(
      `Invalid Soroban RPC events cursor: "${cursor}". ` +
        `Expected <19-digit TOID>-<10-digit index>, e.g. "0019652868403363840-0000000000". ` +
        `To build one for a ledger, use cursorForLedger(ledger) from src/rpc-cursor.ts.`,
    );
  }
}
