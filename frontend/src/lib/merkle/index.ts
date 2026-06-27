import { poseidon2 } from "poseidon-lite";

/**
 * Poseidon Merkle helpers for the depth-20 commitment tree. Mirrors the
 * off-chain tree construction used by the relayer/circuits (verified to match
 * the circomlibjs Poseidon). For the demo a single position sits at leaf 0 and
 * the rest of the tree is empty.
 */
export const TREE_DEPTH = 20;

/** Empty-subtree roots: zeros[0] = 0, zeros[i] = Poseidon(zeros[i-1], zeros[i-1]). */
export function zeros(depth = TREE_DEPTH): bigint[] {
  const z: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) {
    z[i] = poseidon2([z[i - 1], z[i - 1]]);
  }
  return z;
}

export interface MerklePath {
  root: bigint;
  pathElements: bigint[]; // length = depth
  pathIndices: number[]; // length = depth (0 = left sibling)
}

/**
 * Merkle path and root for a single leaf at index 0 (the rest of the tree
 * empty). This is the case for the current single-position demo; multi-leaf
 * path derivation (from on-chain leaves) comes with the relayer/indexer.
 */
export function singleLeafPath(leaf: bigint, depth = TREE_DEPTH): MerklePath {
  const z = zeros(depth);
  const pathElements = z.slice(0, depth);
  const pathIndices = new Array<number>(depth).fill(0);
  let current = leaf;
  for (let i = 0; i < depth; i++) {
    current = poseidon2([current, z[i]]);
  }
  return { root: current, pathElements, pathIndices };
}
