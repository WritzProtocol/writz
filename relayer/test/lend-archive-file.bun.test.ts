import { describe, expect, mock, test } from "bun:test";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { ArchiveRejected, archiveLines, parseArchive } from "../src/lend-events/archive-file";
import { decodeLendEvent } from "../src/lend-events/decode";
import type { LendEventsCycleDeps } from "../src/lend-events/poller";
import { openLendEventStore, type LendEventRow } from "../src/lend-events/store";
import { RebuildMismatch, rebuildLendState, type ArchiveSource, type RebuildServer } from "../src/lend-rebuild/rebuild";
import type { LendChainReader } from "../src/lend-rebuild/verify";
import { openReleaseStore } from "../src/repay-watcher/release-store";
import { createLendEventsRouter } from "../src/routes/lend-events";
import { cursorForLedger } from "../src/rpc-cursor";

const CONTRACT = "CCONTRACT";
const PASSPHRASE = "Test SDF Network ; September 2015";
const TARGET = { contractId: CONTRACT, networkPassphrase: PASSPHRASE };
const FIRST_LEDGER = 4_400_000;
const LENDER = Keypair.random().publicKey();
const T1 = "11".repeat(32);
const T2 = "22".repeat(32);

/** An RPC event ID in `ledger`, the `index`-th event of that ledger. */
const eventId = (ledger: number, index: number) => cursorForLedger(ledger).replace(/-\d{10}$/, `-${String(index).padStart(10, "0")}`);

/** A real `writz-lend` event, encoded and decoded the way the archive stores it. */
function event(ledger: number, name: string, subject: string, value: Record<string, bigint> = {}): LendEventRow {
  const subjectVal = subject.startsWith("G") ? new Address(subject).toScVal() : nativeToScVal(Buffer.from(subject, "hex"));
  const types = Object.fromEntries(Object.keys(value).map((k) => [k, ["symbol", "i128"]]));
  const row = decodeLendEvent(
    {
      id: eventId(ledger, 1),
      ledger,
      txHash: `${ledger}`.padStart(64, "0"),
      topic: [nativeToScVal(name, { type: "symbol" }), subjectVal],
      value: Object.keys(value).length ? nativeToScVal(value, { type: types }) : xdr.ScVal.scvVoid(),
    },
    CONTRACT,
  );
  if (!row) throw new Error(`${name} is not archived`);
  return row;
}

/** One lender, one open loan, one repaid loan. */
const history = () => {
  let l = FIRST_LEDGER;
  return [
    event(++l, "supply", LENDER, { scaled_amount: 1_000n }),
    event(++l, "withdraw", LENDER, { scaled_amount: 300n }),
    event(++l, "deposit", T1), event(++l, "borrow", T1, { amount: 50n }),
    event(++l, "deposit", T2), event(++l, "borrow", T2, { amount: 20n }), event(++l, "repay_full", T2),
  ];
};
const chain = (over: Partial<LendChainReader> = {}): LendChainReader => ({
  positionStatus: async (t) => ({ [T1]: "Active", [T2]: "Closed" })[t] ?? null,
  scaledSupply: async () => 700n,
  totalScaledSupply: async () => 700n,
  hasRelease: async () => false,
  ...over,
});

/** Serves `events` on the first page, then empty pages, inside `range`. */
function server(events: LendEventRow[], range = { oldest: 4_000_000, latest: 5_000_000 }): RebuildServer {
  const queue = [events, []];
  let page = 0;
  return {
    ledgerRange: async () => range,
    getEvents: mock(async () => {
      page++;
      const served = queue.shift() ?? [];
      const last = served[served.length - 1];
      return { events: served, cursor: last ? last.id : cursorForLedger(4_500_000 + page) };
    }),
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-"));
  return { dir, archivePath: path.join(dir, "lend-events.db"), watcherPath: path.join(dir, "watcher.db") };
}
const rebuild = (s: ReturnType<typeof setup>, srv: RebuildServer, reader: LendChainReader, archive?: ArchiveSource) =>
  rebuildLendState({
    server: srv, chain: reader, contractId: CONTRACT, deployLedger: FIRST_LEDGER, archivePath: s.archivePath,
    openReleases: () => openReleaseStore(s.watcherPath),
    decodeEvent: ((e: LendEventRow) => e) as unknown as LendEventsCycleDeps["decodeEvent"],
    ...(archive ? { archive } : {}),
    dryRun: false,
  });
const fileOf = (rows: LendEventRow[], cursor: string) => [...archiveLines({ rows, cursor }, TARGET)].join("\n") + "\n";
const asSource = (text: string): ArchiveSource => {
  const { header, rows } = parseArchive(text, TARGET);
  return { rows, cursor: header.cursor };
};
/** Rewrites one line of a file with `edit`, leaving the rest as it was. */
const editLine = (text: string, n: number, edit: (o: Record<string, unknown>) => void) => {
  const lines = text.trimEnd().split("\n");
  const o = JSON.parse(lines[n]!) as Record<string, unknown>;
  edit(o);
  lines[n] = JSON.stringify(o);
  return lines.join("\n") + "\n";
};

describe("archive file", () => {
  test("round-trips the rows and the cursor", () => {
    const rows = history();
    const cursor = cursorForLedger(4_500_000);
    const { header, rows: parsed } = parseArchive(fileOf(rows, cursor), TARGET);
    expect(parsed).toEqual(rows);
    expect(header).toMatchObject({ events: 7, firstLedger: FIRST_LEDGER + 1, lastLedger: FIRST_LEDGER + 7, cursor });
  });

  test("an empty archive still carries its cursor", () => {
    const { header, rows } = parseArchive(fileOf([], cursorForLedger(4_500_000)), TARGET);
    expect(rows).toEqual([]);
    expect(header).toMatchObject({ events: 0, firstLedger: null, lastLedger: null });
  });

  test("an archive that never read the chain cannot be exported", () => {
    expect(() => [...archiveLines({ rows: [], cursor: null }, TARGET)]).toThrow("nothing to export");
  });

  const text = () => fileOf(history(), cursorForLedger(4_500_000));
  const rejected: [string, () => string, string][] = [
    ["another network", () => text().replace(PASSPHRASE, "Public Global Stellar Network ; September 2015"), "for network"],
    ["another contract", () => editLine(text(), 0, (h) => { h["contractId"] = "COTHER"; }), "for contract"],
    ["an edited column", () => editLine(text(), 1, (r) => { r["data"] = JSON.stringify({ scaled_amount: "9000" }); }), "do not match its rawXdr"],
    ["an edited name", () => editLine(text(), 7, (r) => { r["name"] = "repay"; }), "do not match its rawXdr"],
    ["a rawXdr that does not decode", () => editLine(text(), 3, (r) => { r["rawXdr"] = "{}"; }), "does not decode"],
    ["a ledger that is not the event's", () => editLine(text(), 2, (r) => { r["ledger"] = 1; }), "does not match event"],
    ["events out of order", () => { const l = text().trimEnd().split("\n"); [l[1], l[2]] = [l[2]!, l[1]!]; return l.join("\n"); }, "out of order"],
    ["a repeated event", () => { const l = text().trimEnd().split("\n"); l.splice(2, 0, l[1]!); return l.join("\n"); }, "out of order"],
    ["a removed line", () => { const l = text().trimEnd().split("\n"); l.splice(4, 1); return l.join("\n"); }, "the header says 7 events"],
    ["an event past the cursor", () => editLine(text(), 0, (h) => { h["cursor"] = cursorForLedger(FIRST_LEDGER + 2); }), "past the header's cursor"],
    ["a header from another format", () => editLine(text(), 0, (h) => { h["version"] = 2; }), "header"],
    ["a line that is not JSON", () => text() + "not json\n", "line 9 is not a JSON object"],
    ["an empty file", () => "\n", "empty"],
  ];
  for (const [name, file, message] of rejected) {
    test(`${name} is rejected`, () => {
      expect(() => parseArchive(file(), TARGET)).toThrow(ArchiveRejected);
      expect(() => parseArchive(file(), TARGET)).toThrow(message);
    });
  }
});

describe("rebuild from an archive file", () => {
  test("gives the same result as a rebuild from RPC", async () => {
    const fromRpc = setup();
    const rpcReport = await rebuild(fromRpc, server(history()), chain());
    const live = openLendEventStore(fromRpc.archivePath);
    const exported = [...archiveLines(live.snapshot(CONTRACT), TARGET)].join("\n");
    const rpcRows = live.list(CONTRACT);
    live.close();

    // Past retention for the deployment ledger, inside it for the file's cursor.
    const fromFile = setup();
    const resume = rpcRows[rpcRows.length - 1]!.ledger;
    const srv = server([], { oldest: resume, latest: 5_000_000 });
    const fileReport = await rebuild(fromFile, srv, chain(), asSource(exported));

    expect(fileReport).toEqual(rpcReport);
    expect(openLendEventStore(fromFile.archivePath).list(CONTRACT)).toEqual(rpcRows);
    expect(openReleaseStore(fromFile.watcherPath).due(CONTRACT, Date.now()).map((r) => r.txid)).toEqual([T2]);
    // Continued on RPC from the file's cursor, never from the deployment ledger.
    expect((srv.getEvents as ReturnType<typeof mock>).mock.calls[0]![0]).toMatchObject({ cursor: expect.any(String) });
  });

  test("continues on RPC with the events after the file", async () => {
    const all = history();
    const s = setup();
    const report = await rebuild(s, server(all.slice(4)), chain(), asSource(fileOf(all.slice(0, 4), all[3]!.id)));
    expect(report).toMatchObject({ events: 7, positions: 2, repaidInFull: 1, missingReleases: [T2], swapped: true });
  });

  test("a consistently edited file fails the chain checks and leaves the live data alone", async () => {
    const s = setup();
    const live = openLendEventStore(s.archivePath);
    const before = event(FIRST_LEDGER - 10, "supply", LENDER, { scaled_amount: 5n });
    live.commit([before], before.id);
    live.close();

    // The withdraw is gone and the header agrees: only the chain can tell.
    const rows = history().filter((r) => r.name !== "withdraw");
    await expect(rebuild(s, server([]), chain(), asSource(fileOf(rows, cursorForLedger(4_500_000))))).rejects.toThrow(RebuildMismatch);

    expect(openLendEventStore(s.archivePath).list(CONTRACT)).toEqual([before]);
    expect(fs.existsSync(s.watcherPath)).toBe(false);
  });

  test("a file that stops before RPC retention is refused before reading anything", async () => {
    const s = setup();
    const srv = server([], { oldest: 4_600_000, latest: 5_000_000 });
    await expect(rebuild(s, srv, chain(), asSource(fileOf(history(), cursorForLedger(4_500_000))))).rejects.toThrow("before RPC retention");
    expect(srv.getEvents).not.toHaveBeenCalled();
    expect(fs.existsSync(s.archivePath)).toBe(false);
  });

  test("a cursor past the chain tip is refused", async () => {
    const s = setup();
    const srv = server([], { oldest: 4_000_000, latest: 4_400_100 });
    await expect(rebuild(s, srv, chain(), asSource(fileOf(history(), cursorForLedger(4_500_000))))).rejects.toThrow("past the chain tip");
    expect(srv.getEvents).not.toHaveBeenCalled();
  });

  test("10,000 events: parse and rebuild time", async () => {
    const rows: LendEventRow[] = [];
    let ledger = FIRST_LEDGER;
    let scaled = 0n;
    for (let i = 0; rows.length < 10_000; i++) {
      const txid = (i + 1).toString(16).padStart(64, "0");
      rows.push(event(++ledger, "supply", LENDER, { scaled_amount: 10n }), event(++ledger, "deposit", txid));
      scaled += 10n;
      if (i % 2 === 0) rows.push(event(++ledger, "repay_full", txid));
    }
    rows.length = 10_000;
    const statuses = new Map<string, string>();
    scaled = 0n;
    for (const r of rows) {
      if (r.name === "supply") scaled += 10n;
      else statuses.set(r.subject, r.name === "deposit" ? "Active" : "Closed");
    }
    const text = fileOf(rows, cursorForLedger(4_500_000));

    const start = performance.now();
    const source = asSource(text);
    const parsed = performance.now();
    const report = await rebuild(setup(), server([]), chain({
      positionStatus: async (t) => statuses.get(t) ?? null,
      scaledSupply: async () => scaled,
      totalScaledSupply: async () => scaled,
      hasRelease: async () => true,
    }), source);
    const done = performance.now();

    expect(report.events).toBe(10_000);
    console.log(
      `10,000 events (${(text.length / 1e6).toFixed(1)} MB): parse ${Math.round(parsed - start)} ms, ` +
        `replay, checks and swap ${Math.round(done - parsed)} ms with the chain stubbed, ` +
        `${report.positions + report.suppliers + 1 + report.repaidInFull} chain reads`,
    );
  });
});

describe("GET /lend-events/export", () => {
  const app = (snapshot: () => { rows: LendEventRow[]; cursor: string | null }, target = TARGET) => {
    const a = express();
    a.use("/lend-events", createLendEventsRouter({ target, snapshot }));
    return a;
  };

  test("streams the archive as a file the rebuild accepts", async () => {
    const rows = history();
    const cursor = cursorForLedger(4_500_000);
    const res = await request(app(() => ({ rows, cursor }))).get("/lend-events/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(parseArchive(res.text, TARGET).rows).toEqual(rows);
  });

  test("answers 503 before the archive has read the chain, or without a contract", async () => {
    expect((await request(app(() => ({ rows: [], cursor: null }))).get("/lend-events/export")).body.error).toBe("archive_empty");
    const unconfigured = app(() => ({ rows: [], cursor: null }), { contractId: "", networkPassphrase: PASSPHRASE });
    expect((await request(unconfigured).get("/lend-events/export")).body.error).toBe("lending_not_configured");
  });

  test("is rate limited per address", async () => {
    const a = app(() => ({ rows: [], cursor: cursorForLedger(4_500_000) }));
    for (let i = 0; i < 6; i++) expect((await request(a).get("/lend-events/export")).status).toBe(200);
    const res = await request(a).get("/lend-events/export");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
