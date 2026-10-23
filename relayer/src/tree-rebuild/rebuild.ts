/**
 * Rebuilds the leaf store and notes from the commitment tree's events (#265).
 *
 * The contract stores only the Merkle root, so the leaf store is the only
 * copy of the tree (GHSA-vwvv-3255-783f). The tree watcher keeps a running
 * relayer in step; this builds a correct store from nothing - after data
 * loss, on a new host, or for a third party running their own relayer.
 *
 * Events are replayed from an empty tree with the watcher's own
 * `applyTreeEvent`, in `(ledger, id)` order, from RPC or from the #264
 * archive, and then from RPC up to the ledger the tree's head was read at.
 * Every step must apply: a mismatch, an event that does not move the tree, or
 * an out-of-order id aborts with that event. The result must then reproduce
 * the on-chain root and leaf count at that same ledger. Nothing touches the
 * live store until all of that holds, and no option skips it.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */
import { computeRoot } from "../merkle.js";
import { cursorForLedger } from "../rpc-cursor.js";
import { applyTreeEvent } from "../tree-watcher/apply.js";
import { decodeTreeEvent, type DecodedTreeEvent } from "../tree-watcher/decode.js";
import type { TreeHead } from "./chain.js";

export type RebuildSource = "rpc" | "archive";

export interface RebuildEvent {
  id: string;
  ledger: number;
  txHash: string;
  decoded: DecodedTreeEvent;
}

interface RawEvent {
  id: string;
  ledger: number;
  txHash: string;
  topic: unknown[];
  value: unknown;
}

export interface RebuildServer {
  getEvents(request: {
    filters: { type: "contract"; contractIds: string[] }[];
    cursor: string;
    limit: number;
  }): Promise<{ events: RawEvent[]; cursor: string; latestLedger: number }>;
  getHealth(): Promise<{ oldestLedger: number; latestLedger: number }>;
}

export interface RebuiltTree {
  leaves: bigint[];
  /** Latest sealed note per leaf index, hex. */
  notes: Map<number, string>;
  /** Where the tree watcher continues from: just after the last applied event. */
  cursor: string;
}

export interface RebuildDeps {
  server: RebuildServer;
  contractId: string;
  readHead(): Promise<TreeHead>;
  /** Archived events in `(ledger, id)` order; required for `source: "archive"`. */
  archiveEvents?: () => Iterable<RebuildEvent>;
  decodeEvent?: (raw: { topic: unknown[]; value: unknown }) => DecodedTreeEvent;
  /** Replaces the live store and the watcher's cursor. Only called once every check passed. */
  swap(tree: RebuiltTree): Promise<void> | void;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface RebuildOptions {
  source: RebuildSource;
  /** Ledger to replay RPC from, normally the contract's deployment ledger. */
  fromLedger?: number;
  dryRun?: boolean;
}

export interface RebuildSummary {
  source: RebuildSource;
  eventsApplied: number;
  /** Applied from RPC after the archive (or all of them, for `rpc`). */
  eventsFromRpc: number;
  leaves: number;
  root: string;
  ledger: number;
  cursor: string;
  durationMs: number;
  swapped: boolean;
}

/** A check failed. Carries the event when one is to blame. */
export class RebuildError extends Error {
  constructor(
    message: string,
    readonly event?: { id: string; ledger: number; txHash: string },
  ) {
    super(event ? `${message} (event ${event.id}, ledger ${event.ledger}, tx ${event.txHash})` : message);
    this.name = "RebuildError";
  }
}

const PAGE_LIMIT = 1000;
/** How long to wait for RPC's event index to reach the ledger the head was read at. */
const CATCH_UP_ATTEMPTS = 10;

const hex = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

export async function rebuildTree(deps: RebuildDeps, opts: RebuildOptions): Promise<RebuildSummary> {
  const started = Date.now();
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const decode = deps.decodeEvent ?? decodeTreeEvent;

  let leaves: bigint[] = [];
  const notes = new Map<number, string>();
  let lastId: string | undefined;
  let applied = 0;

  const apply = (ev: RebuildEvent) => {
    if (lastId !== undefined && ev.id <= lastId) {
      throw new RebuildError(`event is out of order: it does not come after ${lastId}`, ev);
    }
    lastId = ev.id;
    const { decoded } = ev;
    if (!decoded.event) return;
    const result = applyTreeEvent(leaves, decoded.event);
    if (result.status === "mismatch") throw new RebuildError(`${decoded.kind} does not apply: ${result.reason}`, ev);
    // From an empty tree every real event moves it; one that does not is a
    // repeat of an event already replayed.
    if (result.status === "already-applied") throw new RebuildError(`${decoded.kind} does not change the tree`, ev);
    leaves = result.leaves;
    if (decoded.encNote) notes.set(result.leafIndex, decoded.encNote);
    applied++;
  };

  const health = await deps.server.getHealth();
  let cursor: string;

  if (opts.source === "archive") {
    if (!deps.archiveEvents) throw new RebuildError("no archive to read events from");
    for (const ev of deps.archiveEvents()) apply(ev);
    if (lastId === undefined) throw new RebuildError("the archive has no events");
    log(`archive: ${applied} events, ${leaves.length} leaves, up to event ${lastId}`);
    cursor = lastId;
    // RPC cannot page from a cursor older than its retention. Start at the
    // oldest ledger it has; an event lost in between makes the final checks fail.
    const resumeLedger = Number(BigInt(lastId.split("-")[0]!) >> 32n);
    if (resumeLedger < health.oldestLedger) {
      log(`archive ends at ledger ${resumeLedger}, RPC retains from ${health.oldestLedger}: continuing from there`);
      cursor = cursorForLedger(health.oldestLedger);
    }
  } else {
    const from = opts.fromLedger ?? health.oldestLedger;
    if (from < health.oldestLedger) {
      throw new RebuildError(
        `ledger ${from} is outside RPC's event retention (oldest ledger ${health.oldestLedger}). ` +
          `Rebuild from an archive instead: --source archive`,
      );
    }
    if (opts.fromLedger === undefined) log(`no --from-ledger: replaying from RPC's oldest ledger, ${from}`);
    cursor = cursorForLedger(from);
  }

  const fromArchive = applied;
  const filters = [{ type: "contract" as const, contractIds: [deps.contractId] }];
  const head = await deps.readHead();

  // Everything RPC has up to the head's ledger. Later events are left for the
  // watcher, which continues from the cursor set below.
  let caughtUp = false;
  for (let attempt = 0; !caughtUp; attempt++) {
    let reachedLedger = 0;
    let pastHead = false;
    for (;;) {
      const page = await deps.server.getEvents({ filters, cursor, limit: PAGE_LIMIT });
      reachedLedger = page.latestLedger;
      for (const raw of page.events) {
        if (raw.ledger > head.ledger) {
          pastHead = true;
          break;
        }
        apply({ id: raw.id, ledger: raw.ledger, txHash: raw.txHash, decoded: decode(raw) });
      }
      if (pastHead || page.events.length === 0) break;
      cursor = page.cursor;
    }
    // A page's cursor is never before its last event, so this is the later of
    // the two: just after the last applied event, or the end of what RPC scanned.
    if (lastId !== undefined && lastId > cursor) cursor = lastId;
    caughtUp = pastHead || reachedLedger >= head.ledger;
    if (!caughtUp) {
      if (attempt + 1 >= CATCH_UP_ATTEMPTS) {
        throw new RebuildError(`RPC's events stop at ledger ${reachedLedger}, behind the head read at ${head.ledger}`);
      }
      await sleep(1000);
    }
  }

  const root = computeRoot(leaves);
  if (root !== head.root) {
    throw new RebuildError(
      `computed root ${hex(root)} does not match the on-chain root ${hex(head.root)} at ledger ${head.ledger}`,
    );
  }
  if (leaves.length !== head.nextLeafIndex) {
    throw new RebuildError(
      `${leaves.length} leaves rebuilt, but the contract's next leaf index is ${head.nextLeafIndex} at ledger ${head.ledger}`,
    );
  }

  // Nothing after `cursor` was applied, and everything before it up to the
  // head was, so the watcher continues from it without skipping or repeating.
  const watcherCursor = cursor;
  if (!opts.dryRun) await deps.swap({ leaves, notes, cursor: watcherCursor });

  return {
    source: opts.source,
    eventsApplied: applied,
    eventsFromRpc: applied - fromArchive,
    leaves: leaves.length,
    root: hex(root),
    ledger: head.ledger,
    cursor: watcherCursor,
    durationMs: Date.now() - started,
    swapped: !opts.dryRun,
  };
}
