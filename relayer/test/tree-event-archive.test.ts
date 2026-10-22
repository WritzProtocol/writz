import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeRoot } from '../src/merkle';
import type { DecodedTreeEvent } from '../src/tree-watcher/decode';

// The archive (#264) opens its file at import time, so each test points it at
// a fresh one and re-requires. resetModules + require again re-opens the same
// file, the way a relayer restart does (the bun:sqlite mock persists to disk).
let dir: string;
function load() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    archive: require('../src/tree-watcher/event-archive') as typeof import('../src/tree-watcher/event-archive'),
    poller: require('../src/tree-watcher/poller') as typeof import('../src/tree-watcher/poller'),
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-events-'));
  process.env.TREE_EVENTS_SQLITE_PATH = path.join(dir, 'tree-events.db');
  jest.resetModules();
});

const insertAfter = [11n, 22n];
// The borrow and repay touch leaf 0, not the leaf the page inserts: replaying
// an insert whose leaf a later event in the same page replaced is refused by
// applyTreeEvent, which is the watcher's concern, not the archive's.
const borrowAfter = [2222n, 22n];
const repayAfter = [3333n, 22n];
const page: DecodedTreeEvent[] = [
  { kind: 'insert', event: { kind: 'insert', commitment: 22n, leafIndex: 1, newRoot: computeRoot(insertAfter) } },
  { kind: 'borrow', event: { kind: 'update', newCommitment: 2222n, newRoot: computeRoot(borrowAfter) }, encNote: 'abcd' },
  { kind: 'repay', event: { kind: 'update', newCommitment: 3333n, newRoot: computeRoot(repayAfter) } },
];
const ids = ['0000000429496729600-0000000000', '0000000429496729600-0000000001', '0000000433791696896-0000000000'];
const serverFor = (page: DecodedTreeEvent[]) => ({
  getEvents: async () => ({
    events: page.map((d, i) => ({ id: ids[i]!, topic: [], value: d, ledger: i < 2 ? 100 : 101, ledgerClosedAt: '', txHash: `tx${i}` })),
    cursor: '0000000433791696896-0000000001',
  }),
  getLatestLedger: async () => ({ sequence: 1_000_000 }),
});

function memory(initial: bigint[], cursor: string | null) {
  const state = { leaves: [...initial], cursor };
  return {
    state,
    store: { read: () => [...state.leaves], write: (l: bigint[]) => { state.leaves = [...l]; }, saveNote: () => {} },
    cursor: { read: () => state.cursor, write: (c: string) => { state.cursor = c; } },
  };
}

function cycle(poller: ReturnType<typeof load>['poller'], m: ReturnType<typeof memory>, cursor = m.cursor, events = page) {
  return poller.runTreePollCycle({
    server: serverFor(events) as never,
    contractId: 'CTREE',
    decodeEvent: (raw) => raw.value as DecodedTreeEvent,
    encodeRaw: (raw) => Buffer.from(JSON.stringify((raw.value as { kind: string }).kind)).toString('base64'),
    store: m.store,
    cursor,
  });
}

describe('tree event archive', () => {
  test('archives each event with its columns, in chain order', async () => {
    const { archive, poller } = load();
    const m = memory([11n], '0000000000000000000-0000000000');
    await cycle(poller, m);
    const rows = archive.listTreeEvents({ limit: 10 });
    expect(rows.map((r) => [r.id, r.kind, r.leafIndex, r.encNote])).toEqual([
      [ids[0], 'insert', 1, null],
      [ids[1], 'borrow', null, 'abcd'],
      [ids[2], 'repay', null, null],
    ]);
    expect(rows[1]).toMatchObject({ ledger: 100, txHash: 'tx1', commitment: '2222', newRoot: computeRoot(borrowAfter).toString() });
    expect(rows[0]!.rawXdr).toBe(Buffer.from('"insert"').toString('base64'));
  });

  test('replaying the same RPC page twice leaves one row per event', async () => {
    const { archive, poller } = load();
    const m = memory([11n], '0000000000000000000-0000000000');
    await cycle(poller, m);
    m.state.cursor = '0000000000000000000-0000000000';
    await cycle(poller, m);
    expect(archive.countTreeEvents()).toBe(3);
    expect(m.state.leaves).toEqual(repayAfter);
    expect(poller.treeSyncStatus.ok).toBe(true);
  });

  test('a crash between the archive write and the cursor write loses and duplicates nothing', async () => {
    const before = '0000000000000000000-0000000000';
    const m = memory([11n], before);
    {
      const { archive, poller } = load();
      const crashing = { read: m.cursor.read, write: () => { throw new Error('killed'); } };
      await expect(cycle(poller, m, crashing)).rejects.toThrow('killed');
      expect(archive.countTreeEvents()).toBe(3);
      expect(m.state.cursor).toBe(before);
    }
    jest.resetModules();
    const { archive, poller } = load();
    await cycle(poller, m);
    expect(archive.listTreeEvents({ limit: 10 }).map((r) => r.id)).toEqual(ids);
    expect(m.state.cursor).toBe('0000000433791696896-0000000001');
    expect(poller.treeSyncStatus.ok).toBe(true);
  });

  test('an event the store cannot explain is not archived, the ones before it are', async () => {
    const { archive, poller } = load();
    const m = memory([11n], '0000000000000000000-0000000000');
    const bogus: DecodedTreeEvent = { kind: 'borrow', event: { kind: 'update', newCommitment: 9n, newRoot: 123n } };
    await cycle(poller, m, m.cursor, [page[0]!, bogus, page[2]!]);
    expect(archive.listTreeEvents({ limit: 10 }).map((r) => r.kind)).toEqual(['insert']);
    expect(poller.treeSyncStatus.ok).toBe(false);
  });

  test('survives a restart, and pages with an exclusive fromId', async () => {
    load().archive.archiveTreeEvents(
      ids.map((id, i) => ({ id, ledger: 100 + i, txHash: `t${i}`, kind: 'insert', newRoot: '1', commitment: '2', leafIndex: i, encNote: null, rawXdr: '' })),
    );
    jest.resetModules();
    const { archive } = load();
    expect(archive.countTreeEvents()).toBe(3);
    const first = archive.listTreeEvents({ limit: 2 });
    expect(first.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(archive.listTreeEvents({ fromId: first[1]!.id, limit: 2 }).map((r) => r.id)).toEqual([ids[2]]);
  });
});
