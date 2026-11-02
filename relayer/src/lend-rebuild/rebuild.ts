/**
 * Rebuilds the relayer's `writz-lend` state from the chain.
 *
 * Positions and balances live in the contract, so losing the relayer's data
 * loses no funds. What it loses is its place in the event stream, and with it
 * the record of which repayments still need a release. This replays every
 * event into a temporary database, checks the result against the contract, and
 * only then swaps it in. A source of events is untrusted by design: it is
 * either proven by the chain or rejected, and a failure changes nothing.
 *
 * Contract views can only be simulated at the current ledger, so they cannot
 * be pinned to the replay's last ledger. Instead the replay is read again after
 * the views: if no new event arrived in between, the views and the replay
 * describe the same state. If one did, it verifies again.
 */
import fs from "fs";
import path from "path";
import { runLendEventsCycle, type LendEventsCycleDeps, type LendEventsServer } from "../lend-events/poller.js";
import { openLendEventStore } from "../lend-events/store.js";
import type { ReleaseStore } from "../repay-watcher/release-store.js";
import { replay } from "./replay.js";
import { verifyAgainstChain, type LendChainReader } from "./verify.js";

/** Attempts to find a quiet window before giving up on a busy contract. */
const MAX_VERIFY_ROUNDS = 5;
/** Enough for 20,000 pages, far past what RPC retention can hold. */
const MAX_CYCLES = 1_000;

export interface RebuildServer extends LendEventsServer {
  oldestLedger(): Promise<number>;
}

export interface RebuildDeps {
  server: RebuildServer;
  chain: LendChainReader;
  contractId: string;
  deployLedger: number;
  /** The live archive, replaced when the checks pass. */
  archivePath: string;
  /** Opened only when the checks pass, so a failed rebuild touches nothing. */
  openReleases: () => ReleaseStore;
  decodeEvent: LendEventsCycleDeps["decodeEvent"];
  dryRun: boolean;
  now?: () => number;
}

export interface RebuildReport {
  events: number;
  positions: number;
  suppliers: number;
  totalScaled: bigint;
  repaidInFull: number;
  missingReleases: string[];
  swapped: boolean;
}

/** Thrown when the chain disagrees. The live data has not been touched. */
export class RebuildMismatch extends Error {}

export async function rebuildLendState(deps: RebuildDeps): Promise<RebuildReport> {
  const { server, chain, contractId, deployLedger, archivePath, decodeEvent, dryRun } = deps;
  const now = deps.now ?? Date.now;

  const oldest = await server.oldestLedger();
  if (deployLedger < oldest) {
    throw new Error(
      `the deployment ledger ${deployLedger} is outside RPC retention (oldest ledger ${oldest}), so RPC cannot replay it`,
    );
  }

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  // Beside the archive, so the final rename stays on one filesystem.
  const workDir = fs.mkdtempSync(`${archivePath}.rebuild-`);
  const tempPath = path.join(workDir, "lend-events.db");
  const temp = openLendEventStore(tempPath);
  try {
    const catchUp = async () => {
      for (let i = 0; i < MAX_CYCLES; i++) {
        if (await runLendEventsCycle({ server, contractId, store: temp, deployLedger, decodeEvent })) return;
      }
      throw new Error("the replay did not reach the chain tip");
    };

    await catchUp();
    for (let round = 1; ; round++) {
      const before = temp.list(contractId).length;
      const state = replay(temp.list(contractId));
      const { mismatch, missingReleases } = await verifyAgainstChain(state, chain);
      await catchUp();
      const rows = temp.list(contractId);
      if (rows.length !== before) {
        if (round === MAX_VERIFY_ROUNDS) {
          throw new Error(`events kept arriving through ${MAX_VERIFY_ROUNDS} checks, try again in a quieter moment`);
        }
        continue;
      }
      if (mismatch) throw new RebuildMismatch(mismatch);

      const report: RebuildReport = {
        events: rows.length,
        positions: state.positions.size,
        suppliers: state.scaledBySupplier.size,
        totalScaled: state.totalScaled,
        repaidInFull: state.repaidInFull.length,
        missingReleases,
        swapped: !dryRun,
      };
      if (dryRun) return report;

      const cursor = temp.readCursor();
      if (!cursor) throw new Error("the replay finished with no cursor");
      const finished = path.join(workDir, "finished.db");
      temp.exportTo(finished);
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(archivePath + suffix, { force: true });
      fs.renameSync(finished, archivePath);
      deps.openReleases().recordBatch(contractId, missingReleases, cursor, now());
      return report;
    }
  } finally {
    temp.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
