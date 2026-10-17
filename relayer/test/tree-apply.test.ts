import { describe, expect, test } from '@jest/globals';
import { applyTreeEvent, findReplacedLeaf } from '../src/tree-watcher/apply';
import { computeRoot } from '../src/merkle';

const leaves = [11n, 22n, 33n, 44n, 55n];

describe('applyTreeEvent - insert', () => {
  test('appends at the next index when it reproduces the root', () => {
    const r = applyTreeEvent(leaves, { kind: 'insert', commitment: 66n, leafIndex: 5, newRoot: computeRoot([...leaves, 66n]) });
    expect(r).toEqual({ status: 'applied', leaves: [...leaves, 66n], leafIndex: 5 });
  });

  test('is idempotent when the insert was already recorded by /insert-commitment', () => {
    expect(applyTreeEvent(leaves, { kind: 'insert', commitment: 33n, leafIndex: 2, newRoot: 0n })).toEqual({ status: 'already-applied', leafIndex: 2 });
  });

  test('refuses an insert past the end, a conflicting leaf, or a wrong root', () => {
    expect(applyTreeEvent(leaves, { kind: 'insert', commitment: 66n, leafIndex: 7, newRoot: 0n }).status).toBe('mismatch');
    expect(applyTreeEvent(leaves, { kind: 'insert', commitment: 99n, leafIndex: 2, newRoot: 0n }).status).toBe('mismatch');
    expect(applyTreeEvent(leaves, { kind: 'insert', commitment: 66n, leafIndex: 5, newRoot: 1n }).status).toBe('mismatch');
  });
});

describe('applyTreeEvent - update (borrow / repay)', () => {
  test('finds the replaced leaf from the root alone and applies it', () => {
    const next = [...leaves];
    next[3] = 4444n;
    const r = applyTreeEvent(leaves, { kind: 'update', newCommitment: 4444n, newRoot: computeRoot(next) });
    expect(r).toEqual({ status: 'applied', leaves: next, leafIndex: 3 });
  });

  test('is idempotent when /update-leaf already applied it', () => {
    const next = [...leaves];
    next[1] = 2222n;
    expect(applyTreeEvent(next, { kind: 'update', newCommitment: 2222n, newRoot: computeRoot(next) })).toEqual({ status: 'already-applied', leafIndex: 1 });
  });

  test('refuses an update no single leaf replacement explains', () => {
    expect(applyTreeEvent(leaves, { kind: 'update', newCommitment: 4444n, newRoot: 123n }).status).toBe('mismatch');
  });

  test('a skipped /update-leaf no longer strands the store: replaying the events catches up', () => {
    // The GHSA-vwvv scenario: borrow on leaf 0 (client never calls
    // /update-leaf), then someone else repays on leaf 4.
    const afterBorrow = [...leaves];
    afterBorrow[0] = 1111n;
    const afterRepay = [...afterBorrow];
    afterRepay[4] = 5555n;
    let store = leaves;
    for (const e of [
      { kind: 'update' as const, newCommitment: 1111n, newRoot: computeRoot(afterBorrow) },
      { kind: 'update' as const, newCommitment: 5555n, newRoot: computeRoot(afterRepay) },
    ]) {
      const r = applyTreeEvent(store, e);
      expect(r.status).toBe('applied');
      if (r.status === 'applied') store = r.leaves;
    }
    expect(store).toEqual(afterRepay);
  });
});

describe('findReplacedLeaf', () => {
  test('returns -1 when nothing matches', () => {
    expect(findReplacedLeaf(leaves, 9n, 0n)).toBe(-1);
  });
});
