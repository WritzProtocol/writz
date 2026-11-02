/**
 * The archive as a portable file, for a rebuild past RPC retention.
 *
 * NDJSON: a header line, then one event per line in RPC order. The header
 * names the network and the contract, so a file can only be replayed against
 * the deployment it came from, and carries the archive's cursor, from which
 * the rebuild continues on RPC.
 *
 * A file is untrusted wherever it came from. Parsing rejects anything that is
 * not internally consistent: each `rawXdr` is decoded again and must give the
 * row's columns, so an edit to the columns alone fails, and each ID must name
 * the row's ledger and come after the previous one. What parsing cannot see,
 * a consistent edit to the events themselves, the rebuild's chain checks do.
 *
 * `./decode.js` is loaded lazily, for the reason at the top of
 * ../repay-watcher/poller.ts: the relayer's index serves the export route.
 */
import type { LendEventRow } from "./store.js";
import { isValidCursor, ledgerOfCursor } from "../rpc-cursor.js";

export const ARCHIVE_FORMAT = "writz-lend-events";
export const ARCHIVE_VERSION = 1;

export interface ArchiveHeader {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  networkPassphrase: string;
  contractId: string;
  /** Ledgers of the first and last event, null when there are none. */
  firstLedger: number | null;
  lastLedger: number | null;
  events: number;
  /** Where the archive stopped reading; the rebuild continues after it. */
  cursor: string;
}

export interface ArchiveTarget {
  contractId: string;
  networkPassphrase: string;
}

export interface ParsedArchive {
  header: ArchiveHeader;
  rows: LendEventRow[];
}

/** The file is malformed, edited, or for another deployment. */
export class ArchiveRejected extends Error {}

/** Decodes a stored `rawXdr` to the columns it must match. */
export type DecodeRaw = (rawXdr: string) => { name: string; subject: string; data: string };

/** The file's lines, header first, without trailing newlines. */
export function* archiveLines(
  snapshot: { rows: LendEventRow[]; cursor: string | null },
  target: ArchiveTarget,
): Generator<string> {
  const { rows, cursor } = snapshot;
  if (!cursor) throw new Error("the archive has not read the chain yet, there is nothing to export");
  const header: ArchiveHeader = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    networkPassphrase: target.networkPassphrase,
    contractId: target.contractId,
    firstLedger: rows[0]?.ledger ?? null,
    lastLedger: rows[rows.length - 1]?.ledger ?? null,
    events: rows.length,
    cursor,
  };
  yield JSON.stringify(header);
  for (const r of rows) {
    yield JSON.stringify({
      id: r.id, ledger: r.ledger, txHash: r.txHash, name: r.name, subject: r.subject, data: r.data, rawXdr: r.rawXdr,
    });
  }
}

function parseLine(line: string, n: number): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Reported below with the line number.
  }
  throw new ArchiveRejected(`line ${n} is not a JSON object`);
}

function str(o: Record<string, unknown>, key: string, n: number): string {
  const v = o[key];
  if (typeof v !== "string") throw new ArchiveRejected(`line ${n}: ${key} is missing or not a string`);
  return v;
}

function ledgerOrNull(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  throw new ArchiveRejected(`line 1: ${key} is not a ledger`);
}

export function parseArchive(
  text: string,
  expected: ArchiveTarget,
  decodeRaw?: DecodeRaw,
): ParsedArchive {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment
  const decode = decodeRaw ?? (require("./decode.js") as typeof import("./decode.js")).decodeRawXdr;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new ArchiveRejected("the file is empty");

  const h = parseLine(lines[0]!, 1);
  if (h["format"] !== ARCHIVE_FORMAT || h["version"] !== ARCHIVE_VERSION) {
    throw new ArchiveRejected(`line 1 is not a ${ARCHIVE_FORMAT} v${ARCHIVE_VERSION} header`);
  }
  const header: ArchiveHeader = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    networkPassphrase: str(h, "networkPassphrase", 1),
    contractId: str(h, "contractId", 1),
    firstLedger: ledgerOrNull(h, "firstLedger"),
    lastLedger: ledgerOrNull(h, "lastLedger"),
    events: typeof h["events"] === "number" ? h["events"] : -1,
    cursor: str(h, "cursor", 1),
  };
  if (header.networkPassphrase !== expected.networkPassphrase) {
    throw new ArchiveRejected(`the file is for network "${header.networkPassphrase}", not "${expected.networkPassphrase}"`);
  }
  if (header.contractId !== expected.contractId) {
    throw new ArchiveRejected(`the file is for contract ${header.contractId}, not ${expected.contractId}`);
  }
  if (!isValidCursor(header.cursor)) throw new ArchiveRejected("line 1: cursor is not an RPC events cursor");

  const rows: LendEventRow[] = [];
  let previous = "";
  for (let i = 1; i < lines.length; i++) {
    const n = i + 1;
    const o = parseLine(lines[i]!, n);
    const id = str(o, "id", n);
    if (!isValidCursor(id)) throw new ArchiveRejected(`line ${n}: ${id} is not an RPC event ID`);
    if (id <= previous) throw new ArchiveRejected(`line ${n}: event ${id} is out of order or repeated`);
    if (id > header.cursor) throw new ArchiveRejected(`line ${n}: event ${id} is past the header's cursor`);
    previous = id;
    const ledger = o["ledger"];
    if (ledger !== ledgerOfCursor(id)) throw new ArchiveRejected(`line ${n}: ledger ${String(ledger)} does not match event ${id}`);
    const row: LendEventRow = {
      id,
      contractId: header.contractId,
      ledger,
      txHash: str(o, "txHash", n),
      name: str(o, "name", n),
      subject: str(o, "subject", n),
      data: str(o, "data", n),
      rawXdr: str(o, "rawXdr", n),
    };
    let decoded: ReturnType<DecodeRaw>;
    try {
      decoded = decode(row.rawXdr);
    } catch (e) {
      throw new ArchiveRejected(`line ${n}: rawXdr does not decode (${e instanceof Error ? e.message : String(e)})`);
    }
    if (decoded.name !== row.name || decoded.subject !== row.subject || decoded.data !== row.data) {
      throw new ArchiveRejected(`line ${n}: the columns of event ${id} do not match its rawXdr`);
    }
    rows.push(row);
  }

  if (rows.length !== header.events) {
    throw new ArchiveRejected(`the header says ${header.events} events, the file has ${rows.length}`);
  }
  if ((rows[0]?.ledger ?? null) !== header.firstLedger || (rows[rows.length - 1]?.ledger ?? null) !== header.lastLedger) {
    throw new ArchiveRejected("the header's first or last ledger does not match the events");
  }
  return { header, rows };
}
