/**
 * Applies commitment-tree events to the relayer's leaf list (GHSA-vwvv-3255-783f).
 *
 * The contract stores only the Merkle root, so the relayer's leaf store is
 * the only copy of the tree. It used to advance only when a client called
 * `/update-leaf` after a borrow or repay, so one missing call - a closed tab,
 * or a borrower who never sends it - left the store behind the chain and
 * every `/merkle-path` answered 409 for everyone. These pure functions let
 * the tree watcher follow the chain instead: every event carries the new
 * root, so each step is checked against it before it is accepted.
 */
import { poseidon2 } from "poseidon-lite";
import { computeRoot, TREE_DEPTH, zeros } from "../merkle.js";

export type TreeEvent =
  | { kind: "insert"; commitment: bigint; leafIndex: number; newRoot: bigint }
  /** A borrow or repay replaced one leaf with `newCommitment`; which one is not published. */
  | { kind: "update"; newCommitment: bigint; newRoot: bigint };

export type ApplyResult =
  | { status: "applied"; leaves: bigint[]; leafIndex: number }
  | { status: "already-applied"; leafIndex?: number }
  | { status: "mismatch"; reason: string };

/** All levels of the tree over `leaves`, level 0 being the leaves. */
function levels(leaves: bigint[], depth = TREE_DEPTH): bigint[][] {
  const z = zeros(depth);
  const out: bigint[][] = [leaves.slice()];
  for (let d = 0; d < depth; d++) {
    const level = out[d]!;
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon2([level[i]!, i + 1 < level.length ? level[i + 1]! : z[d]!]));
    }
    out.push(next);
  }
  return out;
}

/** Index of the leaf whose replacement by `leaf` yields `targetRoot`, or -1. */
export function findReplacedLeaf(leaves: bigint[], leaf: bigint, targetRoot: bigint, depth = TREE_DEPTH): number {
  const z = zeros(depth);
  const tree = levels(leaves, depth);
  for (let i = 0; i < leaves.length; i++) {
    let node = leaf;
    let idx = i;
    for (let d = 0; d < depth; d++) {
      const level = tree[d]!;
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      const sib = sibling < level.length ? level[sibling]! : z[d]!;
      node = idx % 2 === 0 ? poseidon2([node, sib]) : poseidon2([sib, node]);
      idx = Math.floor(idx / 2);
    }
    if (node === targetRoot) return i;
  }
  return -1;
}

/**
 * Applies one event. Idempotent: an event the store already reflects (because
 * `/insert-commitment` or `/update-leaf` got there first) is reported as
 * already applied, never applied twice.
 */
export function applyTreeEvent(leaves: bigint[], event: TreeEvent): ApplyResult {
  if (event.kind === "insert") {
    if (event.leafIndex < leaves.length) {
      return leaves[event.leafIndex] === event.commitment
        ? { status: "already-applied", leafIndex: event.leafIndex }
        : { status: "mismatch", reason: `leaf ${event.leafIndex} already holds a different commitment` };
    }
    if (event.leafIndex > leaves.length) {
      return { status: "mismatch", reason: `insert at leaf ${event.leafIndex}, but the store has only ${leaves.length}` };
    }
    const next = [...leaves, event.commitment];
    return computeRoot(next) === event.newRoot
      ? { status: "applied", leaves: next, leafIndex: event.leafIndex }
      : { status: "mismatch", reason: "the insert does not reproduce the event's root" };
  }

  if (computeRoot(leaves) === event.newRoot) {
    const leafIndex = leaves.indexOf(event.newCommitment);
    return { status: "already-applied", ...(leafIndex >= 0 ? { leafIndex } : {}) };
  }
  const leafIndex = findReplacedLeaf(leaves, event.newCommitment, event.newRoot);
  if (leafIndex < 0) {
    return { status: "mismatch", reason: "no single-leaf replacement reproduces the event's root" };
  }
  const next = [...leaves];
  next[leafIndex] = event.newCommitment;
  return { status: "applied", leaves: next, leafIndex };
}
