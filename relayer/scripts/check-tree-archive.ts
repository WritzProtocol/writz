/**
 * Compares the tree event archive (#264) with Soroban RPC: every
 * `insert_leaf`, `borrow` and `repay` the tree contract emitted since the
 * archive's first row must be in the archive exactly once, and nothing else.
 *
 *   TREE_EVENTS_SQLITE_PATH=/app/data/tree-events.db COMMITMENT_TREE_ID=C... \
 *     bun scripts/check-tree-archive.ts
 *
 * Only meaningful while the archive's first ledger is still inside RPC's
 * event retention. Run it against a stopped relayer's file, or expect the
 * newest events to show up as missing until the watcher's next poll.
 */
import { rpc } from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { cursorForLedger } from "../src/rpc-cursor.js";
import { decodeTreeEvent } from "../src/tree-watcher/decode.js";
import { listTreeEvents } from "../src/tree-watcher/event-archive.js";

async function main(): Promise<number> {
  const archived: string[] = [];
  let firstLedger: number | undefined;
  for (let page = listTreeEvents({ limit: 1000 }); page.length > 0; page = listTreeEvents({ fromId: archived.at(-1), limit: 1000 })) {
    firstLedger ??= page[0]!.ledger;
    archived.push(...page.map((e) => e.id));
  }
  if (firstLedger === undefined) {
    console.log("archive is empty");
    return 0;
  }

  const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
  const filters = [{ type: "contract" as const, contractIds: [config.commitmentTreeId] }];
  const onChain: string[] = [];
  let cursor = cursorForLedger(firstLedger);
  for (;;) {
    const res = await server.getEvents({ filters, cursor, limit: 1000 });
    for (const e of res.events) if (decodeTreeEvent(e).event) onChain.push(e.id);
    if (res.events.length === 0) break;
    cursor = res.cursor;
  }

  const inArchive = new Set(archived);
  const inRpc = new Set(onChain);
  const missing = onChain.filter((id) => !inArchive.has(id));
  const extra = archived.filter((id) => !inRpc.has(id));
  console.log(`from ledger ${firstLedger}: archive ${archived.length} rows, RPC ${onChain.length} tree events`);
  if (missing.length) console.log(`missing from archive: ${missing.join(", ")}`);
  if (extra.length) console.log(`in archive but not on RPC: ${extra.join(", ")}`);
  return missing.length || extra.length || archived.length !== inArchive.size ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(1);
});
