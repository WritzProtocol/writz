import { describe, expect, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { assertDataDirFree, claimDataDir } from "../src/data-lock";
import type { LendEventsCycleDeps } from "../src/lend-events/poller";
import { openLendEventStore, type LendEventRow } from "../src/lend-events/store";
import { RebuildMismatch, rebuildLendState, type RebuildServer } from "../src/lend-rebuild/rebuild";
import { replay } from "../src/lend-rebuild/replay";
import type { LendChainReader } from "../src/lend-rebuild/verify";
import { openReleaseStore } from "../src/repay-watcher/release-store";

const CONTRACT = "CCONTRACT";
const DEPLOY = 1_000;
const T1 = "11".repeat(32);
const T2 = "22".repeat(32);
const T3 = "33".repeat(32);
const LENDER = "GLENDER";
const cursorN = (n: number) => `00193273${String(n).padStart(11, "0")}-0000000000`;

let nextId = 0;
const row = (name: string, subject: string, data: object = {}): LendEventRow => ({
  id: `e${String(++nextId).padStart(6, "0")}`, contractId: CONTRACT, ledger: 2_000 + nextId, txHash: `h${nextId}`,
  name, subject, data: JSON.stringify(data), rawXdr: "{}",
});
/** A clean history: one open loan, one repaid, one liquidated, one lender. */
const history = () => [
  row("supply", LENDER, { scaled_amount: "1000" }),
  row("withdraw", LENDER, { scaled_amount: "300" }),
  row("deposit", T1), row("borrow", T1),
  row("deposit", T2), row("borrow", T2), row("repay_full", T2),
  row("deposit", T3), row("liquidate", T3),
];
const honestChain = (over: Partial<LendChainReader> = {}): LendChainReader => ({
  positionStatus: async (t) => ({ [T1]: "Active", [T2]: "Closed", [T3]: "Liquidated" })[t] ?? null,
  scaledSupply: async () => 700n,
  totalScaledSupply: async () => 700n,
  hasRelease: async () => true,
  ...over,
});

/** Serves `events` on the first page, then empty pages from `later`. */
function serverWith(events: LendEventRow[], later: LendEventRow[][] = []): RebuildServer {
  const queue = [events, [], ...later.flatMap((page) => [page, []])];
  let call = 0;
  return {
    ledgerRange: async () => ({ oldest: 500, latest: 1_000_000 }),
    getEvents: mock(async () => {
      call++;
      return { events: queue.shift() ?? [], cursor: cursorN(call) };
    }),
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebuild-"));
  return { dir, archivePath: path.join(dir, "lend-events.db"), watcherPath: path.join(dir, "watcher.db") };
}
const run = (server: RebuildServer, chain: LendChainReader, s: ReturnType<typeof setup>, dryRun = false) =>
  rebuildLendState({
    server, chain, contractId: CONTRACT, deployLedger: DEPLOY, archivePath: s.archivePath,
    openReleases: () => openReleaseStore(s.watcherPath),
    decodeEvent: ((e: LendEventRow) => e) as unknown as LendEventsCycleDeps["decodeEvent"],
    dryRun,
  });
const noTemp = (dir: string) => expect(fs.readdirSync(dir).filter((f) => f.includes(".rebuild-"))).toEqual([]);

describe("replay", () => {
  test("derives statuses, scaled balances and repayments", () => {
    const state = replay(history());
    expect(state.positions.get(T1)).toBe("Active");
    expect(state.positions.get(T2)).toBe("Closed");
    expect(state.positions.get(T3)).toBe("Liquidated");
    expect(state.scaledBySupplier.get(LENDER)).toBe(700n);
    expect(state.totalScaled).toBe(700n);
    expect(state.repaidInFull).toEqual([T2]);
  });

  test("a supply event with no scaled amount throws", () => {
    expect(() => replay([row("supply", LENDER)])).toThrow("scaled_amount");
  });
});

describe("rebuildLendState", () => {
  test("a clean replay swaps the archive in and sets the watcher cursor", async () => {
    const s = setup();
    const report = await run(serverWith(history()), honestChain(), s);
    expect(report).toMatchObject({ events: 9, positions: 3, suppliers: 1, totalScaled: 700n, repaidInFull: 1, swapped: true });
    expect(openLendEventStore(s.archivePath).list(CONTRACT)).toHaveLength(9);
    expect(openReleaseStore(s.watcherPath).readCursor()).not.toBeNull();
    noTemp(s.dir);
  });

  test("a missing release is reported and queued", async () => {
    const s = setup();
    const report = await run(serverWith(history()), honestChain({ hasRelease: async () => false }), s);
    expect(report.missingReleases).toEqual([T2]);
    expect(openReleaseStore(s.watcherPath).due(CONTRACT, Date.now()).map((r) => r.txid)).toEqual([T2]);
  });

  test("--dry-run reports and changes nothing", async () => {
    const s = setup();
    const report = await run(serverWith(history()), honestChain({ hasRelease: async () => false }), s, true);
    expect(report).toMatchObject({ swapped: false, missingReleases: [T2] });
    expect(fs.existsSync(s.archivePath)).toBe(false);
    expect(fs.existsSync(s.watcherPath)).toBe(false);
    noTemp(s.dir);
  });

  const failing: [string, () => LendEventRow[], Partial<LendChainReader>, string][] = [
    ["a status mismatch", history, { positionStatus: async () => "Active" }, "replay says Closed"],
    ["a position the chain does not have", history, { positionStatus: async () => null }, "no position"],
    ["a supplier mismatch", history, { scaledSupply: async () => 701n }, "scaled"],
    ["a total mismatch", history, { totalScaledSupply: async () => 701n }, "total scaled supply"],
  ];
  for (const [name, events, chain, message] of failing) {
    test(`${name} fails and leaves the live data alone`, async () => {
      const s = setup();
      const live = openLendEventStore(s.archivePath);
      live.commit([row("supply", "GOLD", { scaled_amount: "5" })], cursorN(99));
      live.close();
      const liveBytes = fs.readFileSync(s.archivePath);
      const failure = await run(serverWith(events()), honestChain(chain), s).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(RebuildMismatch);
      expect((failure as Error).message).toContain(message);
      expect(fs.readFileSync(s.archivePath).equals(liveBytes)).toBe(true);
      expect(fs.existsSync(s.watcherPath)).toBe(false);
      noTemp(s.dir);
    });
  }

  test("a tampered source is rejected by the chain", async () => {
    const s = setup();
    const events = history();
    events[0] = { ...events[0]!, data: JSON.stringify({ scaled_amount: "9999" }) };
    await expect(run(serverWith(events), honestChain(), s)).rejects.toBeInstanceOf(RebuildMismatch);
    expect(fs.existsSync(s.archivePath)).toBe(false);
  });

  test("an event arriving during the checks verifies again against the newer state", async () => {
    const s = setup();
    let verified = 0;
    const chain = honestChain({
      totalScaledSupply: async () => (++verified === 1 ? 700n : 750n),
      scaledSupply: async () => (verified === 0 ? 700n : 750n),
    });
    const late = [row("supply", LENDER, { scaled_amount: "50" })];
    const report = await run(serverWith(history(), [late]), chain, s);
    expect(report.events).toBe(10);
    expect(report.totalScaled).toBe(750n);
  });

  test("a deployment ledger outside retention fails with a clear message", async () => {
    const s = setup();
    const server = { ...serverWith([]), ledgerRange: async () => ({ oldest: DEPLOY + 1, latest: 1_000_000 }) };
    await expect(run(server, honestChain(), s)).rejects.toThrow("outside RPC retention");
    expect(server.getEvents).not.toHaveBeenCalled();
    noTemp(s.dir);
  });

  test("an interrupted run leaves nothing behind and can run again", async () => {
    const s = setup();
    let calls = 0;
    const flaky: RebuildServer = {
      ledgerRange: async () => ({ oldest: 500, latest: 1_000_000 }),
      getEvents: async () => {
        if (++calls === 2) throw new Error("rpc went away");
        return { events: calls === 1 ? history().slice(0, 2) : [], cursor: cursorN(calls) };
      },
    };
    await expect(run(flaky, honestChain(), s)).rejects.toThrow("rpc went away");
    expect(fs.existsSync(s.archivePath)).toBe(false);
    noTemp(s.dir);
    expect((await run(serverWith(history()), honestChain(), s)).swapped).toBe(true);
  });

  test("a rebuild over an existing archive replaces it, with pending releases kept", async () => {
    const s = setup();
    const live = openLendEventStore(s.archivePath);
    live.commit([row("supply", "GOLD", { scaled_amount: "5" })], cursorN(99));
    live.close();
    openReleaseStore(s.watcherPath).recordBatch(CONTRACT, [T1], cursorN(99), 1);
    await run(serverWith(history()), honestChain({ hasRelease: async () => false }), s);
    expect(openLendEventStore(s.archivePath).list(CONTRACT)).toHaveLength(9);
    expect(openReleaseStore(s.watcherPath).summary(CONTRACT).pending).toBe(2);
  });
});

describe("data dir lock", () => {
  const dirWith = (lock: object) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    fs.writeFileSync(path.join(dir, "relayer.lock"), JSON.stringify(lock));
    return dir;
  };

  test("refuses while another live process on this host holds the directory", () => {
    expect(() => assertDataDirFree(dirWith({ host: os.hostname(), pid: process.ppid }))).toThrow("Stop it first");
  });

  test("ignores a marker from another host, a dead process, or itself", () => {
    expect(() => assertDataDirFree(dirWith({ host: "another-container", pid: process.ppid }))).not.toThrow();
    expect(() => assertDataDirFree(dirWith({ host: os.hostname(), pid: 2 ** 22 + 1 }))).not.toThrow();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    claimDataDir(dir);
    expect(() => assertDataDirFree(dir)).not.toThrow();
  });

  test("a directory with no marker is free", () => {
    expect(() => assertDataDirFree(fs.mkdtempSync(path.join(os.tmpdir(), "lock-")))).not.toThrow();
  });
});
