pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./merkle.circom";

/*
 * Writz Protocol - Merkle Insertion Circuit (#211, GHSA-prw2-j3jx-43qh)
 *
 * Proves that `new_root` is `old_root` with `commitment` written into the
 * empty leaf at `leaf_index`. `commitment-tree::insert_commitment` verifies
 * this proof instead of trusting whatever root the admin submits, so a
 * compromised admin key or a relayer bug can no longer install a root holding
 * invented leaves or dropping honest ones.
 *
 * What the circuit proves:
 *   1. The leaf at `leaf_index` is empty (0) under `old_root`.
 *   2. `new_root` is the root after setting that leaf to `commitment`, with
 *      every other leaf unchanged.
 *
 * `leaf_index` is decomposed with Num2Bits(20), so the path direction bits are
 * the canonical binary form of an index below 2^20. The contract pins
 * `leaf_index` to its own next-leaf counter and `old_root` to its stored root,
 * so insertions are strictly sequential and none can overwrite a used slot.
 *
 * Nothing here is secret: the relayer generates the proof from public data.
 *
 * Public signal ordering (one output, then the public inputs in declaration
 * order):
 *   0: new_root
 *   1: old_root
 *   2: commitment
 *   3: leaf_index
 */
template InsertCircuit(depth) {
    signal input old_root;
    signal input commitment;
    signal input leaf_index;
    signal input path_elements[depth];

    signal output new_root;

    component bits = Num2Bits(depth);
    bits.in <== leaf_index;

    component updater = MerkleTreeUpdater(depth);
    updater.old_leaf <== 0;
    updater.new_leaf <== commitment;
    updater.old_root <== old_root;
    for (var i = 0; i < depth; i++) {
        updater.pathElements[i] <== path_elements[i];
        updater.pathIndices[i]  <== bits.out[i];
    }

    new_root <== updater.new_root;
}

component main {public [old_root, commitment, leaf_index]} = InsertCircuit(20);
