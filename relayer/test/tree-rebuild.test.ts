import { describe, expect, jest, test } from '@jest/globals';
import { computeRoot } from '../src/merkle';
import { cursorForLedger } from '../src/rpc-cursor';
import type { DecodedTreeEvent } from '../src/tree-watcher/decode';
import { rebuildTree, RebuildError, type RebuildDeps, type RebuildEvent, type RebuiltTree } from '../src/tree-rebuild/rebuild';

/**
 * An RPC event id: the operation's TOID (ledger in the high 32 bits, then the
 * transaction's 1-based order) and the event's index. Never equal to
 * cursorForLedger(ledger), which sits before the ledger's first transaction.
 */
const id = (ledger: number, tx: number) =>
  `${((BigInt(ledger) << 32n) | (BigInt(tx + 1) << 12n)).toString().padStart(19, '0')}-0000000000`;

const insert = (commitment: bigint, leafIndex: number, leaves: bigint[]): DecodedTreeEvent => ({
  kind: 'insert',
  event: { kind: 'insert', commitment, leafIndex, newRoot: computeRoot(leaves) },
});
const update = (kind: 'borrow' | 'repay', newCommitment: bigint, leaves: bigint[], encNote?: string): DecodedTreeEvent => ({
  kind,
  event: { kind: 'update', newCommitment, newRoot: computeRoot(leaves) },
  ...(encNote ? { encNote } : {}),
});

/**
 * A recorded history: three deposits, a borrow and a repay on leaf 0, a borrow
 * on leaf 2, and an unrelated contract event in between.
 */
function history(): RebuildEvent[] {
  const evs: [number, DecodedTreeEvent][] = [
    [100, insert(11n, 0, [11n])],
    [100, { event: undefined }],
    [101, insert(22n, 1, [11n, 22n])],
    [102, update('borrow', 111n, [111n, 22n], 'aa')],
    [103, insert(33n, 2, [111n, 22n, 33n])],
    [104, update('repay', 1111n, [1111n, 22n, 33n], 'bb')],
    [105, update('borrow', 333n, [1111n, 22n, 333n], 'cc')],
  ];
  return evs.map(([ledger, decoded], i) => ({ id: id(ledger, i), ledger, txHash: `tx${i}`, decoded }));
}
const FINAL = [1111n, 22n, 333n];

function harness(opts: { events?: RebuildEvent[]; archive?: RebuildEvent[]; oldest?: number; head?: Partial<{ root: bigint; nextLeafIndex: number; ledger: number }>; lagBehind?: number } = {}) {
  const events = opts.events ?? history();
  const swapped: RebuiltTree[] = [];
  let lag = opts.lagBehind ?? 0;
  const deps: RebuildDeps = {
    contractId: 'CTREE',
    server: {
      getHealth: async () => ({ oldestLedger: opts.oldest ?? 50, latestLedger: 200 }),
      // Pages of two; events carry their decoded form in `value`.
      getEvents: async ({ cursor, limit }) => {
        const latestLedger = 110 - (lag > 0 ? (lag--, 20) : 0);
        const page = events.filter((e) => e.id > cursor && e.ledger >= (opts.oldest ?? 50) && e.ledger <= latestLedger).slice(0, Math.min(limit, 2));
        return {
          events: page.map((e) => ({ id: e.id, ledger: e.ledger, txHash: e.txHash, topic: [], value: e.decoded })),
          cursor: page.length ? page[page.length - 1]!.id : cursor,
          latestLedger,
        };
      },
    },
    readHead: async () => ({ root: computeRoot(FINAL), nextLeafIndex: FINAL.length, ledger: 110, ...opts.head }),
    decodeEvent: (raw) => raw.value as DecodedTreeEvent,
    archiveEvents: opts.archive ? () => opts.archive! : undefined,
    swap: (tree) => { swapped.push(tree); },
    sleep: async () => {},
  };
  return { deps, swapped };
}

async function failure(p: Promise<unknown>): Promise<RebuildError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RebuildError) return e;
    throw e;
  }
  throw new Error('rebuild did not fail');
}

describe('rebuildTree from RPC', () => {
  test('reproduces the known root, notes and leaf count, and swaps them in with the watcher cursor', async () => {
    const h = harness();
    const s = await rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 });
    expect(s).toMatchObject({ eventsApplied: 6, eventsFromRpc: 6, leaves: 3, ledger: 110, swapped: true });
    expect(s.root).toBe('0x' + computeRoot(FINAL).toString(16).padStart(64, '0'));
    expect(h.swapped).toHaveLength(1);
    expect(h.swapped[0]!.leaves).toEqual(FINAL);
    expect([...h.swapped[0]!.notes]).toEqual([[0, 'bb'], [2, 'cc']]);
    expect(h.swapped[0]!.cursor).toBe(history()[6]!.id);
  });

  test('--dry-run checks everything and swaps nothing', async () => {
    const h = harness();
    const s = await rebuildTree(h.deps, { source: 'rpc', fromLedger: 100, dryRun: true });
    expect(s.swapped).toBe(false);
    expect(h.swapped).toHaveLength(0);
  });

  test('a start ledger outside RPC retention is refused with a pointer to the archive', async () => {
    const h = harness({ oldest: 150 });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.message).toMatch(/ledger 100 is outside RPC's event retention \(oldest ledger 150\).*--source archive/);
    expect(h.swapped).toHaveLength(0);
  });

  test('a tampered commitment aborts at that event and leaves the live store alone', async () => {
    const events = history();
    events[3] = { ...events[3]!, decoded: update('borrow', 999n, [111n, 22n]) };
    const h = harness({ events });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.event?.id).toBe(events[3]!.id);
    expect(e.message).toMatch(/borrow does not apply.*ledger 102, tx tx3/);
    expect(h.swapped).toHaveLength(0);
  });

  test('events in the wrong order abort with the event that broke the order', async () => {
    const events = history();
    // The repay's leaf change replayed before the insert it follows.
    [events[4], events[5]] = [{ ...events[5]!, id: events[4]!.id }, { ...events[4]!, id: events[5]!.id }];
    const h = harness({ events });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.event?.id).toBe(events[4]!.id);
    expect(h.swapped).toHaveLength(0);
  });

  test('a missing event aborts at the next one it breaks', async () => {
    const events = history().filter((_, i) => i !== 3);
    const h = harness({ events });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.event?.id).toBe(history()[4]!.id);
    expect(h.swapped).toHaveLength(0);
  });

  test('a missing last event fails the final root check', async () => {
    const h = harness({ events: history().slice(0, 6) });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.message).toMatch(/computed root 0x[0-9a-f]{64} does not match the on-chain root 0x[0-9a-f]{64} at ledger 110/);
    expect(h.swapped).toHaveLength(0);
  });

  test('a repeated event aborts', async () => {
    const events = history();
    events.splice(4, 0, { ...events[3]!, id: id(102, 99) });
    const h = harness({ events });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.message).toMatch(/borrow does not change the tree/);
    expect(e.event?.id).toBe(id(102, 99));
  });

  test('a leaf count that differs from the contract fails even when the root matches', async () => {
    const h = harness({ head: { nextLeafIndex: 4 } });
    const e = await failure(rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 }));
    expect(e.message).toMatch(/3 leaves rebuilt, but the contract's next leaf index is 4 at ledger 110/);
  });

  test('stops at the ledger the head was read at and leaves later events to the watcher', async () => {
    const events = history();
    const head = { root: computeRoot([111n, 22n]), nextLeafIndex: 2, ledger: 102 };
    const h = harness({ events, head });
    const s = await rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 });
    expect(s.leaves).toBe(2);
    expect(h.swapped[0]!.cursor).toBe(events[3]!.id);
  });

  test('waits for RPC events to reach the head ledger', async () => {
    const h = harness({ lagBehind: 2 });
    const s = await rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 });
    expect(s.leaves).toBe(3);
  });

  test('an empty tree rebuilds to the empty root', async () => {
    const h = harness({ events: [], head: { root: computeRoot([]), nextLeafIndex: 0 } });
    const s = await rebuildTree(h.deps, { source: 'rpc', fromLedger: 100 });
    expect(s.leaves).toBe(0);
    expect(h.swapped[0]!.cursor).toBe(cursorForLedger(100));
  });
});

describe('rebuildTree from the archive', () => {
  test('replays the archive, then RPC for what came after it', async () => {
    const events = history();
    const h = harness({ events, archive: events.slice(0, 4) });
    const s = await rebuildTree(h.deps, { source: 'archive' });
    expect(s).toMatchObject({ eventsApplied: 6, eventsFromRpc: 3, leaves: 3 });
    expect(h.swapped[0]!.leaves).toEqual(FINAL);
  });

  test('an archive ending before RPC retention continues from the oldest ledger, and the root check decides', async () => {
    const events = history();
    // Everything after the archive is still in RPC: verified.
    const ok = harness({ events, archive: events.slice(0, 4), oldest: 103 });
    expect((await rebuildTree(ok.deps, { source: 'archive' })).leaves).toBe(3);
    // The insert at ledger 103 fell out of retention: refused.
    const gap = harness({ events, archive: events.slice(0, 4), oldest: 104 });
    await failure(rebuildTree(gap.deps, { source: 'archive' }));
    expect(gap.swapped).toHaveLength(0);
  });

  test('an archive that does not start at the first leaf is refused', async () => {
    const events = history();
    const h = harness({ events, archive: events.slice(2) });
    const e = await failure(rebuildTree(h.deps, { source: 'archive' }));
    expect(e.event?.id).toBe(events[2]!.id);
    expect(e.message).toMatch(/insert at leaf 1, but the store has only 0/);
  });

  test('an empty archive is refused', async () => {
    const h = harness({ archive: [] });
    await expect(rebuildTree(h.deps, { source: 'archive' })).rejects.toThrow('the archive has no events');
  });
});

describe('replaceTree', () => {
  test('replaces the leaves and every note', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-')), 'merkle.db');
    jest.resetModules();
    const store = require('../src/leaf-store') as typeof import('../src/leaf-store');
    /* eslint-enable @typescript-eslint/no-require-imports */
    store.writeLeaves([1n, 2n, 3n]);
    store.saveNote(2, 'stale');
    store.replaceTree([7n, 8n], new Map([[0, 'fresh']]));
    expect(store.readLeaves()).toEqual([7n, 8n]);
    expect(store.readNotes()).toEqual([{ leafIndex: 0, encNote: 'fresh' }]);
  });
});
