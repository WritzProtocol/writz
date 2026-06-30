import { poseidon2 } from "poseidon-lite";

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
  pathElements: bigint[];
  pathIndices: number[];
}

/** Computes the authentication path for the leaf at `leafIndex`. */
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

/** Computes the Merkle root for an ordered list of leaves. */
export function computeRoot(leaves: bigint[], depth = TREE_DEPTH): bigint {
  const z = zeros(depth);
  if (leaves.length === 0) return z[depth];

  let level = [...leaves];
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon2([level[i], i + 1 < level.length ? level[i + 1] : z[d]]));
    }
    level = next;
  }
  return level[0];
}
