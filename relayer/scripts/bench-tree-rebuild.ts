/**
 * Times `rebuildTree` (#265) on a synthetic history: N deposits, then M
 * borrows/repays on random leaves, replayed from a fake RPC through the
 * same code path as `bun run rebuild-tree`, final checks included.
 *
 *   bun scripts/bench-tree-rebuild.ts [leaves=1000] [updates=1000]
 *
 * The fixture's roots come from an incremental tree (O(depth) per event), so
 * generating it is cheap and the time reported is the replay's own.
 */
import { poseidon2 } from "poseidon-lite";
import { TREE_DEPTH, zeros } from "../src/merkle.js";
import { rebuildTree, type RebuildServer } from "../src/tree-rebuild/rebuild.js";
import type { DecodedTreeEvent } from "../src/tree-watcher/decode.js";

const LEAVES = Number(process.argv[2] ?? 1000);
const UPDATES = Number(process.argv[3] ?? 1000);

/** A sparse Merkle tree that updates one path per write. */
function incrementalTree(depth = TREE_DEPTH) {
  const z = zeros(depth);
  const nodes: Map<number, bigint>[] = Array.from({ length: depth + 1 }, () => new Map());
  return {
    set(index: number, leaf: bigint): bigint {
      nodes[0]!.set(index, leaf);
      let idx = index;
      for (let d = 0; d < depth; d++) {
        const left = nodes[d]!.get(idx & ~1) ?? z[d]!;
        const right = nodes[d]!.get(idx | 1) ?? z[d]!;
        idx >>= 1;
        nodes[d + 1]!.set(idx, poseidon2([left, right]));
      }
      return nodes[depth]!.get(0)!;
    },
  };
}

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const tree = incrementalTree();
const events: { id: string; ledger: number; txHash: string; decoded: DecodedTreeEvent }[] = [];
let root = 0n;
const push = (decoded: DecodedTreeEvent) => {
  const ledger = 1000 + events.length;
  events.push({ id: `${((BigInt(ledger) << 32n) | 4096n).toString().padStart(19, "0")}-0000000000`, ledger, txHash: `t${events.length}`, decoded });
};
const t0 = performance.now();
for (let i = 0; i < LEAVES; i++) {
  const c = BigInt(i + 1);
  root = tree.set(i, c);
  push({ kind: "insert", event: { kind: "insert", commitment: c, leafIndex: i, newRoot: root } });
}
for (let u = 0; u < UPDATES; u++) {
  const c = 10n ** 12n + BigInt(u);
  root = tree.set(Math.floor(rand() * LEAVES), c);
  push({ kind: u % 2 ? "repay" : "borrow", event: { kind: "update", newCommitment: c, newRoot: root } });
}
const fixtureMs = performance.now() - t0;
const last = events[events.length - 1]!;

const server: RebuildServer = {
  getHealth: async () => ({ oldestLedger: 1, latestLedger: last.ledger }),
  getEvents: async ({ cursor, limit }) => {
    const page = events.filter((e) => e.id > cursor).slice(0, limit);
    return {
      events: page.map((e) => ({ id: e.id, ledger: e.ledger, txHash: e.txHash, topic: [], value: e.decoded })),
      cursor: page.length ? page[page.length - 1]!.id : cursor,
      latestLedger: last.ledger,
    };
  },
};

const summary = await rebuildTree(
  {
    server,
    contractId: "CBENCH",
    readHead: async () => ({ root, nextLeafIndex: LEAVES, ledger: last.ledger }),
    decodeEvent: (raw) => raw.value as DecodedTreeEvent,
    swap: () => {},
  },
  { source: "rpc", fromLedger: 1, dryRun: true },
);
console.log(
  `${LEAVES} leaves, ${UPDATES} updates: rebuilt and verified in ${(summary.durationMs / 1000).toFixed(1)} s ` +
    `(fixture ${(fixtureMs / 1000).toFixed(1)} s)`,
);
