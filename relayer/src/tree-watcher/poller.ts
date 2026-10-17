/**
 * Tree watcher: keeps the relayer's leaf store in step with the
 * commitment-tree contract by replaying its events (GHSA-vwvv-3255-783f).
 *
 * Follows `insert_leaf`, `borrow` and `repay` from a persisted cursor, with
 * the same at-least-once semantics as the vault watcher: the cursor only
 * advances once every event in the batch has been applied or recognised as
 * already applied. A client's `/update-leaf` call is now just a faster path
 * to the same state, not the only one.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */
import { readLeaves, saveNote, writeLeaves } from "../leaf-store.js";
import { withTreeLock } from "../tree-lock.js";
import { applyTreeEvent } from "./apply.js";
import { decodeTreeEvent, type DecodedTreeEvent } from "./decode.js";
import { readCursor, writeCursor } from "./cursor-store.js";
import type { EventsServer } from "../vault-watcher/poller.js";
import type { KeeperNoteSink } from "../zk-keeper/runner.js";

export { decodeTreeEvent, type DecodedTreeEvent } from "./decode.js";

/** How far back a first-ever run looks, in ledgers (about six days). Kept
 * inside RPC's event retention so the request is not refused. */
const FIRST_RUN_LOOKBACK_LEDGERS = 6 * 17_280;

export interface TreeStore {
  read(): bigint[];
  write(leaves: bigint[]): void;
  saveNote(leafIndex: number, encNoteHex: string): void;
}

const sqliteStore: TreeStore = { read: readLeaves, write: writeLeaves, saveNote };

export interface TreePollDeps {
  server: EventsServer;
  contractId: string;
  decodeEvent?: (raw: { topic: unknown[]; value: unknown }) => DecodedTreeEvent;
  store?: TreeStore;
  cursor?: { read(): string | null; write(cursor: string): void };
  /** Receives each borrow/repay keeper note with the leaf it updated (#212). */
  keeperNote?: KeeperNoteSink;
}

/** Last outcome, reported on /health so a stuck tree is visible. */
export const treeSyncStatus: { ok: boolean; lastError: string | null; lastSyncedAt: string | null } = {
  ok: true,
  lastError: null,
  lastSyncedAt: null,
};

export async function runTreePollCycle(deps: TreePollDeps): Promise<void> {
  const decode = deps.decodeEvent ?? decodeTreeEvent;
  const store = deps.store ?? sqliteStore;
  const cursor = deps.cursor ?? { read: readCursor, write: writeCursor };
  const filters = [{ type: "contract" as const, contractIds: [deps.contractId] }];

  const persisted = cursor.read();
  const response = persisted
    ? await deps.server.getEvents({ filters, cursor: persisted })
    : await deps.server.getEvents({
        filters,
        startLedger: Math.max(1, (await deps.server.getLatestLedger()).sequence - FIRST_RUN_LOOKBACK_LEDGERS),
      });

  let failure: string | null = null;
  await withTreeLock(() => {
    let leaves = store.read();
    for (const raw of response.events) {
      const { event, encNote, keeperNote } = decode(raw);
      if (!event) continue;
      const result = applyTreeEvent(leaves, event);
      if (result.status === "mismatch") {
        failure = `${event.kind} at ledger ${raw.ledger} (tx ${raw.txHash}): ${result.reason}`;
        break;
      }
      if (result.status === "applied") {
        leaves = result.leaves;
        store.write(leaves);
      }
      const leafIndex = result.leafIndex;
      if (encNote && leafIndex !== undefined) store.saveNote(leafIndex, encNote);
      if (keeperNote && leafIndex !== undefined && event.kind === "update" && deps.keeperNote) {
        deps.keeperNote(leafIndex, event.newCommitment, keeperNote);
      }
    }
  });

  if (failure) {
    treeSyncStatus.ok = false;
    treeSyncStatus.lastError = failure;
    console.error(`[tree-watcher] ${failure} - cursor held; the leaf store needs a rebuild`);
    return;
  }
  cursor.write(response.cursor);
  treeSyncStatus.ok = true;
  treeSyncStatus.lastError = null;
  treeSyncStatus.lastSyncedAt = new Date().toISOString();
}

export function startTreeWatcher(): { stop: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("../config.js") as typeof import("../config.js");
  if (!config.commitmentTreeId) {
    console.warn("[tree-watcher] COMMITMENT_TREE_ID not configured - tree watcher disabled");
    return { stop: () => {} };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { keeperNoteSink } = require("../zk-keeper/runner.js") as typeof import("../zk-keeper/runner.js");
  const keeperNote = keeperNoteSink(config.keeperBabyjubSecret);
  let stopped = false;
  void (async () => {
    while (!stopped) {
      try {
        await runTreePollCycle({ server, contractId: config.commitmentTreeId, keeperNote });
      } catch (e) {
        console.error("[tree-watcher] poll failed:", e instanceof Error ? e.message : e);
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, config.vaultWatcherPollIntervalMs));
    }
  })();
  return { stop: () => { stopped = true; } };
}
