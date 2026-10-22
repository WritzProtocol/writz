import { describe, expect, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The poller opens the event archive (#264) at import time; keep it out of data/.
process.env.TREE_EVENTS_SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tree-watcher-')), 'tree-events.db');

import { runTreePollCycle, treeSyncStatus, type DecodedTreeEvent } from '../src/tree-watcher/poller';
import { computeRoot } from '../src/merkle';

function harness(initial: bigint[], cursor: string | null = 'c0') {
  const state = { leaves: [...initial], notes: [] as [number, string][], cursor };
  return {
    state,
    store: {
      read: () => [...state.leaves],
      write: (l: bigint[]) => { state.leaves = [...l]; },
      saveNote: (i: number, n: string) => { state.notes.push([i, n]); },
    },
    cursor: { read: () => state.cursor, write: (c: string) => { state.cursor = c; } },
  };
}

/** Events carry their decoded form directly; decodeEvent just unwraps it. */
const server = (decoded: DecodedTreeEvent[], next = 'c1') => ({
  getEvents: async () => ({
    events: decoded.map((d, i) => ({ id: `id${i}`, topic: [], value: d, ledger: 100 + i, ledgerClosedAt: '2026-10-17T00:00:00Z', txHash: `tx${i}` })),
    cursor: next,
  }),
  getLatestLedger: async () => ({ sequence: 1_000_000 }),
});
const unwrap = (raw: { value: unknown }) => raw.value as DecodedTreeEvent;
/** The archive and its XDR encoding are covered in tree-event-archive.test.ts. */
const noArchive = { archive: () => {}, encodeRaw: () => '' };

describe('runTreePollCycle', () => {
  test('applies a deposit insert and a borrow nobody reported via /update-leaf', async () => {
    const h = harness([11n]);
    const afterInsert = [11n, 22n];
    const afterBorrow = [11n, 2222n];
    await runTreePollCycle({
      server: server([
        { kind: 'insert', event: { kind: 'insert', commitment: 22n, leafIndex: 1, newRoot: computeRoot(afterInsert) } },
        { kind: 'borrow', event: { kind: 'update', newCommitment: 2222n, newRoot: computeRoot(afterBorrow) }, encNote: 'abcd' },
      ]) as never,
      contractId: 'CTREE',
      decodeEvent: unwrap,
      store: h.store,
      cursor: h.cursor,
      ...noArchive,
    });
    expect(h.state.leaves).toEqual(afterBorrow);
    expect(h.state.notes).toEqual([[1, 'abcd']]);
    expect(h.state.cursor).toBe('c1');
    expect(treeSyncStatus.ok).toBe(true);
  });

  test("hands a borrow's keeper note to the keeper with the leaf it updated (#212)", async () => {
    const h = harness([11n, 22n]);
    const after = [11n, 2222n];
    const got: [number, bigint, bigint[]][] = [];
    await runTreePollCycle({
      server: server([
        { kind: 'borrow', event: { kind: 'update', newCommitment: 2222n, newRoot: computeRoot(after) }, keeperNote: [1n, 2n, 3n, 4n, 5n] },
      ]) as never,
      contractId: 'CTREE', decodeEvent: unwrap, store: h.store, cursor: h.cursor, ...noArchive,
      keeperNote: (i, c, n) => got.push([i, c, n]),
    });
    expect(got).toEqual([[1, 2222n, [1n, 2n, 3n, 4n, 5n]]]);
  });

  test('replaying a batch changes nothing', async () => {
    const after = [11n, 22n];
    const h = harness(after);
    await runTreePollCycle({
      server: server([{ kind: 'insert', event: { kind: 'insert', commitment: 22n, leafIndex: 1, newRoot: computeRoot(after) } }]) as never,
      contractId: 'CTREE', decodeEvent: unwrap, store: h.store, cursor: h.cursor, ...noArchive,
    });
    expect(h.state.leaves).toEqual(after);
    expect(h.state.cursor).toBe('c1');
  });

  test('an event the store cannot explain holds the cursor and reports the failure', async () => {
    const h = harness([11n]);
    await runTreePollCycle({
      server: server([{ kind: 'borrow', event: { kind: 'update', newCommitment: 9n, newRoot: 123n } }]) as never,
      contractId: 'CTREE', decodeEvent: unwrap, store: h.store, cursor: h.cursor, ...noArchive,
    });
    expect(h.state.cursor).toBe('c0');
    expect(h.state.leaves).toEqual([11n]);
    expect(treeSyncStatus.ok).toBe(false);
    expect(treeSyncStatus.lastError).toMatch(/update at ledger 100/);
  });
});
