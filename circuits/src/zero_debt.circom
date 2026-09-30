pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "./merkle.circom";

/*
 * Writz Protocol - Zero-Debt Release Circuit
 *
 * Proves that a commitment in the current Merkle tree encodes zero outstanding
 * debt (debt_stroops == 0), without revealing the collateral amount, secret,
 * or nonce. The protocol uses this proof in the cooperative BTC release path
 * to verify per-position debt clearance without learning which position is
 * being released.
 *
 * What the circuit proves:
 *   1. The prover knows (collateral, secret, nonce) such that
 *      commitment = Poseidon(collateral, 0, secret, nonce).
 *   2. That commitment exists in the Merkle tree at the provided root.
 *
 * The literal `0` for debt is hardcoded in the circuit - there is no private
 * debt signal. It is impossible to generate a valid proof with any non-zero
 * debt value.
 *
 * `commitment` (GHSA-6jmp-wf3x-3vxh, GHSA-9j8g-prh5-jhhj): the circuit's only
 * public signal used to be `merkle_root`, so a valid zero-debt proof carried
 * no indication of *which* position it was about - /api/cosign verified the
 * proof and separately trusted a caller-supplied `commitment` string with
 * nothing tying the two together, letting a proof about position B authorize
 * releasing position A's BTC. Publishing `commitment` as a circuit output
 * closes that: the server can now check `publicSignals[0] == commitment` it
 * was told to release, same as `publicSignals[1] == on-chain root`. This
 * doesn't weaken privacy - the commitment is already public on-chain (it's
 * the Merkle leaf itself, visible in DepositEvent/InsertLeafEvent); only
 * collateral, secret and nonce stay hidden.
 *
 * Public signal ordering (one circuit output, one declared public input):
 *   0: commitment   - Poseidon(collateral_satoshis, 0, secret, nonce)
 *   1: merkle_root  - must equal the current on-chain Merkle root at verify time
 *
 * Private signals (never revealed):
 *   collateral_satoshis, secret, nonce, path_elements[20], path_indices[20]
 *
 * Constraint count: ~5,520
 *   - Commitment hash (Poseidon 4-in): ~320
 *   - Merkle proof (depth 20, MerkleTreeChecker): ~5,200
 *
 * Build:
 *   cd circuits && ./scripts/build_zero_debt.sh
 * Then copy the output artifacts to frontend/app/public/circuits/ and
 * frontend/app/src/circuits/zero_debt_vkey.json (see script for details).
 */
template ZeroDebtCircuit(DEPTH) {
    // ── Private inputs ────────────────────────────────────────────────────────
    signal input collateral_satoshis;
    signal input secret;
    signal input nonce;
    signal input path_elements[DEPTH];
    signal input path_indices[DEPTH];

    // ── Public input ──────────────────────────────────────────────────────────
    signal input merkle_root;

    // ── Public output ─────────────────────────────────────────────────────────
    signal output commitment;

    // ── Step 1: Compute the zero-debt commitment ──────────────────────────────
    // commitment = Poseidon(collateral_satoshis, 0, secret, nonce)
    // The second input is the literal 0 - no private debt variable exists.
    // A witness with non-zero debt cannot satisfy this circuit.
    component commit = Poseidon(4);
    commit.inputs[0] <== collateral_satoshis;
    commit.inputs[1] <== 0;
    commit.inputs[2] <== secret;
    commit.inputs[3] <== nonce;
    commitment <== commit.out;

    // ── Step 2: Verify Merkle inclusion ──────────────────────────────────────
    // Proves the commitment above exists in the tree rooted at merkle_root.
    component checker = MerkleTreeChecker(DEPTH);
    checker.leaf <== commit.out;
    checker.root <== merkle_root;
    for (var i = 0; i < DEPTH; i++) {
        checker.pathElements[i] <== path_elements[i];
        checker.pathIndices[i]  <== path_indices[i];
    }
}

// Public: merkle_root only. Everything else is private.
component main { public [merkle_root] } = ZeroDebtCircuit(20);
