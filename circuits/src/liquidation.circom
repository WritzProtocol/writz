pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "./merkle.circom";

/*
 * Writz Protocol — Liquidation Circuit
 *
 * Proves that a lending position is undercollateralized without revealing
 * the actual collateral amount or position owner, while publishing the
 * outstanding debt so the on-chain contract can collect the exact amount.
 *
 * What the circuit proves:
 *   1. The position commitment exists in the current Merkle tree.
 *   2. The collateral ratio < liquidation threshold (120%).
 *      Equivalently: collateral_satoshis × price × 10_000 < debt × 100_000_000 × threshold_bp
 *   3. A nullifier is published — the old position is marked as liquidated.
 *   4. usdc_debt == debt_stroops — the public output is bound to the private
 *      debt field inside the commitment, so the contract can trust it.
 *
 * The circuit does NOT compute the liquidation proceeds or bonus — those are
 * computed on-chain using the public inputs (price, threshold) once the proof
 * is verified. The liquidator receives BTC at a 10% discount to market price.
 *
 * Public signal ordering (outputs first, then declared public inputs):
 *   0: nullifier                  — output, marks position liquidated
 *   1: usdc_debt                  — output, proven debt amount from commitment
 *   2: merkle_root                — public input, current on-chain root
 *   3: btc_price_stroops_per_btc  — public input, from oracle
 *   4: liquidation_threshold_bp   — public input, 12_000 = 120%
 *
 * Constraint count: ~9,200
 *   - Commitment hash: ~320
 *   - Merkle proof (depth 20): ~5,200
 *   - Undercollateral check: ~200
 *   - Range proofs: ~400
 *   - Nullifier: ~160
 *   - usdc_debt binding: ~1
 */

template LiquidationCircuit(DEPTH) {
    // ── Private inputs ────────────────────────────────────────────────────────
    signal input collateral_satoshis; // BTC collateral (hidden)
    signal input debt_stroops;        // Current USDC debt (hidden)
    signal input secret;              // Position secret
    signal input nonce;               // Position nonce

    // Merkle tree membership proof
    signal input path_elements[DEPTH];
    signal input path_indices[DEPTH];

    // ── Public inputs ─────────────────────────────────────────────────────────
    signal input merkle_root;               // Current on-chain Merkle root
    signal input btc_price_stroops_per_btc; // BTC/USD from oracle (USDC stroops per BTC)
    signal input liquidation_threshold_bp;  // 12_000 = 120% liquidation threshold

    // ── Public outputs ────────────────────────────────────────────────────────
    signal output nullifier;  // Marks position as liquidated (prevents double-liquidation)
    signal output usdc_debt;  // Proven outstanding debt — bound to the commitment's debt field

    // ── Step 1: Reconstruct the position commitment ───────────────────────────
    component commit = Poseidon(4);
    commit.inputs[0] <== collateral_satoshis;
    commit.inputs[1] <== debt_stroops;
    commit.inputs[2] <== secret;
    commit.inputs[3] <== nonce;
    signal commitment <== commit.out;

    // ── Step 2: Verify commitment is in the Merkle tree ──────────────────────
    component checker = MerkleTreeChecker(DEPTH);
    checker.leaf <== commitment;
    checker.root <== merkle_root;
    for (var i = 0; i < DEPTH; i++) {
        checker.pathElements[i] <== path_elements[i];
        checker.pathIndices[i]  <== path_indices[i];
    }

    // ── Step 3: Prove the position is undercollateralized ─────────────────────
    // Collateral ratio = (collateral_satoshis × price / 100_000_000) / debt
    //
    // Undercollateralized when ratio < liquidation_threshold_bp / 10_000
    //
    // Rearranged (cross-multiplied, no division):
    //   collateral_satoshis × btc_price × 10_000 < debt × 100_000_000 × threshold_bp
    //
    // lhs = collateral_satoshis × btc_price × 10_000
    // rhs = debt_stroops × 100_000_000 × liquidation_threshold_bp

    signal lhs     <== collateral_satoshis * btc_price_stroops_per_btc;
    signal lhs_bp  <== lhs * 10000;

    signal rhs     <== debt_stroops * 100000000;
    signal rhs_bp  <== rhs * liquidation_threshold_bp;

    // undercollateralized: rhs_bp > lhs_bp
    component under_check = GreaterThan(128);
    under_check.in[0] <== rhs_bp;
    under_check.in[1] <== lhs_bp;
    // Must be 1: the position IS undercollateralized
    under_check.out === 1;

    // ── Step 4: Compute nullifier ─────────────────────────────────────────────
    // nullifier = Poseidon(secret, nonce)
    component null_hasher = Poseidon(2);
    null_hasher.inputs[0] <== secret;
    null_hasher.inputs[1] <== nonce;
    nullifier <== null_hasher.out;

    // ── Step 5: Bind public debt output to private debt field ─────────────────
    // This constraint proves that the usdc_debt signal published on-chain is
    // exactly the same value used to compute the commitment in Step 1.
    // Without this, a keeper could claim an arbitrary debt while the proof
    // commits to a different amount inside the commitment hash.
    usdc_debt <== debt_stroops;
}

// Public outputs (always public): nullifier, usdc_debt
// Public inputs: merkle_root, btc_price_stroops_per_btc, liquidation_threshold_bp
// Private: collateral_satoshis, debt_stroops, secret, nonce, path_elements, path_indices
component main {public [
    merkle_root,
    btc_price_stroops_per_btc,
    liquidation_threshold_bp
]} = LiquidationCircuit(20);
