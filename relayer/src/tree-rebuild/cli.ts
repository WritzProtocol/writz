/**
 * `bun run rebuild-tree` (#265): rebuilds the leaf store and notes from the
 * commitment tree's events, checks the result against the chain, and swaps
 * it in. See ./rebuild.ts for what is checked.
 *
 *   bun run rebuild-tree [--source rpc|archive] [--from-ledger N]
 *                        [--archive-db PATH] [--dry-run]
 *
 *   --source rpc       Replay RPC events from --from-ledger (default
 *                      COMMITMENT_TREE_DEPLOY_LEDGER, else RPC's oldest
 *                      ledger). Refused when that ledger is outside RPC's
 *                      event retention.
 *   --source archive   Replay the #264 archive (--archive-db, default
 *                      TREE_EVENTS_SQLITE_PATH), then RPC after it.
 *   --dry-run          Run every check, swap nothing.
 *
 * The swap holds the tree lock of this process only. Stop the relayer, or
 * run this where its tree watcher is not running, before a swap: a watcher
 * cycle in another process can still write the store it read before it.
 *
 * Exits 0 when the rebuild was verified (and swapped, unless --dry-run),
 * 1 when any check failed (nothing swapped), 2 on bad arguments.
 */
import path from "path";
import { rpc } from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { replaceTree } from "../leaf-store.js";
import { withTreeLock } from "../tree-lock.js";
import { writeCursor } from "../tree-watcher/cursor-store.js";
import { decodeTreeEvent } from "../tree-watcher/decode.js";
import { archiveEventsFrom } from "./archive-source.js";
import { readTreeHead } from "./chain.js";
import { rebuildTree, RebuildError, type RebuildSource } from "./rebuild.js";

function usage(message: string): never {
  console.error(`rebuild-tree: ${message}`);
  console.error("usage: bun run rebuild-tree [--source rpc|archive] [--from-ledger N] [--archive-db PATH] [--dry-run]");
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const opts: { source: RebuildSource; fromLedger?: number; archiveDb?: string; dryRun: boolean } = {
    source: "rpc",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => argv[++i] ?? usage(`${arg} needs a value`);
    if (arg === "--source") {
      const v = value();
      if (v !== "rpc" && v !== "archive") usage(`unknown source "${v}"`);
      opts.source = v;
    } else if (arg === "--from-ledger") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) usage("--from-ledger must be a positive integer");
      opts.fromLedger = n;
    } else if (arg === "--archive-db") opts.archiveDb = value();
    else if (arg === "--dry-run") opts.dryRun = true;
    else usage(`unknown argument "${arg}"`);
  }
  const deployLedger = process.env.COMMITMENT_TREE_DEPLOY_LEDGER;
  if (opts.fromLedger === undefined && deployLedger) opts.fromLedger = Number(deployLedger);
  return opts;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (!config.commitmentTreeId) usage("COMMITMENT_TREE_ID is not set");
  const contractId = config.commitmentTreeId;
  const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
  const archiveDb =
    opts.archiveDb ?? process.env.TREE_EVENTS_SQLITE_PATH ?? path.join(process.cwd(), "data", "tree-events.db");

  console.log(`rebuild-tree: ${contractId} on ${config.stellarRpcUrl}, source ${opts.source}${opts.dryRun ? ", dry run" : ""}`);
  try {
    const summary = await rebuildTree(
      {
        server: server as never,
        contractId,
        readHead: () => readTreeHead(server, contractId),
        archiveEvents: archiveEventsFrom(archiveDb, contractId, decodeTreeEvent),
        swap: (tree) =>
          withTreeLock(() => {
            replaceTree(tree.leaves, tree.notes);
            writeCursor(tree.cursor);
          }),
        log: (m) => console.log(`  ${m}`),
      },
      opts,
    );
    console.log(
      [
        `  source:          ${summary.source}${summary.source === "archive" ? ` (${archiveDb})` : ""}`,
        `  events applied:  ${summary.eventsApplied} (${summary.eventsFromRpc} from RPC)`,
        `  leaves:          ${summary.leaves}`,
        `  root:            ${summary.root} (matches the chain at ledger ${summary.ledger})`,
        `  watcher cursor:  ${summary.cursor}`,
        `  duration:        ${(summary.durationMs / 1000).toFixed(1)} s`,
        summary.swapped ? "  swapped into the live leaf store" : "  dry run: live leaf store untouched",
      ].join("\n"),
    );
    return 0;
  } catch (e) {
    if (!(e instanceof RebuildError)) throw e;
    console.error(`rebuild-tree: FAILED - ${e.message}\n  live leaf store untouched`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("rebuild-tree:", e instanceof Error ? e.message : e);
    console.error("  live leaf store untouched");
    process.exit(1);
  },
);
