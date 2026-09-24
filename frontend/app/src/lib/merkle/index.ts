import { poseidon2 } from "poseidon-lite";

/**
 * Poseidon Merkle helpers for the depth-20 commitment tree. Mirrors the
 * off-chain tree construction used by the relayer/circuits (verified to match
 * the circomlibjs Poseidon).
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
 * Computes the Merkle authentication path for the leaf at `leafIndex` in a
 * tree built from `leaves` (insertion order, matching circomlibjs
 * IncrementalMerkleTree). The returned `root` is identical to
 * `computeRoot(leaves)` and must be used as `old_root` in borrow/repay proofs.
 */
export function computePath(leaves: bigint[], leafIndex: number, depth = TREE_DEPTH): MerklePath {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new RangeError(`leafIndex ${leafIndex} out of range [0, ${leaves.length})`);
  }
  const z = zeros(depth);
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let level = [...leaves];
  let idx = leafIndex;

  for (let d = 0; d < depth; d++) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(siblingIdx < level.length ? level[siblingIdx] : z[d]);
    // 0 = current node is the left child; 1 = right child (matches circuit convention)
    pathIndices.push(idx % 2);

    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon2([level[i], i + 1 < level.length ? level[i + 1] : z[d]]));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return { root: level[0] ?? z[depth], pathElements, pathIndices };
}

/**
 * Kept for the single-position demo case (leaf at index 0, empty tree).
 * Prefer computePath for any multi-leaf tree.
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

/**
 * Computes the Poseidon Merkle root for an ordered list of leaves.
 * Leaves are placed at positions 0..N-1; all remaining positions are filled
 * with the appropriate empty-subtree root. This matches the circomlibjs
 * IncrementalMerkleTree used by the circuits and relayer.
 */
export function computeRoot(leaves: bigint[], depth = TREE_DEPTH): bigint {
  const z = zeros(depth);
  if (leaves.length === 0) return z[depth];

  let level = [...leaves];
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : z[d];
      next.push(poseidon2([left, right]));
    }
    level = next;
  }
  return level[0];
}
