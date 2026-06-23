pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

/*
 * Writz Protocol — Shared Merkle Tree Components
 *
 * Poseidon-based binary Merkle tree for the position commitment tree.
 * Leaf nodes: position commitments (Poseidon(collateral, debt, secret, nonce))
 * Internal nodes: Poseidon(left_child, right_child)
 * Tree depth: 20 → supports up to 2^20 ≈ 1,048,576 simultaneous positions
 */

// Hashes two Poseidon inputs in the correct order based on the path index.
// Used as the internal node hasher in the Merkle tree.
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output out;

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    out <== h.out;
}

// Verifies that `leaf` exists in a Merkle tree with root `root`.
//
// Parameters:
//   depth — height of the tree (use 20 for Writz's position tree)
//
// pathIndices[i]: 0 = current node is the left child at level i
//                 1 = current node is the right child at level i
//
// Constraint count: depth × (Poseidon(2) + Mux1) ≈ depth × 260
// At depth=20: ~5,200 constraints
template MerkleTreeChecker(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component selectors[depth];
    component hashers[depth];

    signal currentHash[depth + 1];
    currentHash[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be 0 or 1
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select left and right children based on pathIndices[i]
        selectors[i] = MultiMux1(2);
        // When pathIndices[i] == 0: current is left, sibling is right
        // When pathIndices[i] == 1: current is right, sibling is left
        selectors[i].c[0][0] <== currentHash[i];
        selectors[i].c[0][1] <== pathElements[i];
        selectors[i].c[1][0] <== pathElements[i];
        selectors[i].c[1][1] <== currentHash[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left  <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        currentHash[i + 1] <== hashers[i].out;
    }

    root === currentHash[depth];
}

// Computes the new Merkle root after updating a single leaf.
// Used in the borrow/repay circuit to prove the new commitment tree root.
//
// Same path as MerkleTreeChecker but instead of checking old_leaf == old_root,
// it updates old_leaf → new_leaf and outputs the resulting new_root.
template MerkleTreeUpdater(depth) {
    signal input old_leaf;
    signal input new_leaf;
    signal input old_root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal output new_root;

    // Verify the old leaf is in the tree at the given path.
    component old_checker = MerkleTreeChecker(depth);
    old_checker.leaf          <== old_leaf;
    old_checker.root          <== old_root;
    for (var i = 0; i < depth; i++) {
        old_checker.pathElements[i] <== pathElements[i];
        old_checker.pathIndices[i]  <== pathIndices[i];
    }

    // Compute the new root with new_leaf at the same position.
    component new_hashers[depth];
    component new_selectors[depth];

    signal newHash[depth + 1];
    newHash[0] <== new_leaf;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        new_selectors[i] = MultiMux1(2);
        new_selectors[i].c[0][0] <== newHash[i];
        new_selectors[i].c[0][1] <== pathElements[i];
        new_selectors[i].c[1][0] <== pathElements[i];
        new_selectors[i].c[1][1] <== newHash[i];
        new_selectors[i].s <== pathIndices[i];

        new_hashers[i] = HashLeftRight();
        new_hashers[i].left  <== new_selectors[i].out[0];
        new_hashers[i].right <== new_selectors[i].out[1];
        newHash[i + 1] <== new_hashers[i].out;
    }

    new_root <== newHash[depth];
}
