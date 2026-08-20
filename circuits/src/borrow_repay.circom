pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";
include "./merkle.circom";

/*
 * Writz Protocol - Borrow/Repay Circuit
 *
 * Proves a valid state transition of a lending position without revealing
 * collateral amount, current debt, or the identity of the position owner.
 *
 * What the circuit proves (all without revealing amounts):
 *   1. The position (commitment) exists in the current Merkle tree.
 *   2. The new debt is correctly updated: new_debt = old_debt ± delta.
 *   3. `is_borrow` is boolean, and its value matches the actual debt
 *      direction: is_borrow=1 requires new_debt >= old_debt, is_borrow=0
 *      requires new_debt <= old_debt. Neither was constrained before - see
 *      the comment on Step 3b below for the exploit this closes.
 *   4. After the update, the collateral ratio >= 150% (borrow) or is
 *      unconstrained (repay - reducing debt cannot itself break solvency).
 *   5. A nullifier is published to spend the old commitment (prevents replay).
 *   6. The new commitment is correctly formed with the updated debt.
 *   7. The new Merkle root reflects the commitment update.
 *
 * Collateral ratio check (borrow only):
 *   collateral_satoshis × btc_price_stroops_per_btc ÷ 100_000_000 ÷ new_debt
 *   ≥ 1.5 (150%)
 *
 *   Rearranged to avoid division (ZK-friendly):
 *   collateral_satoshis × btc_price × 10_000 ≥ new_debt × 100_000_000 × 15_000
 *
 * Constraint count: 11,296 non-linear (measured via `circom --r1cs`, not an
 * estimate - regenerate this comment if the circuit changes again rather
 * than trusting stale arithmetic here).
 *   - Old commitment hash: ~320
 *   - Old Merkle proof (depth 20): ~5,200
 *   - New commitment hash: ~320
 *   - New Merkle root update: ~5,200 (shared path, no double-count)
 *   - Ratio check + is_borrow boolean + debt-direction + collateral/price
 *     range proofs: ~800
 *
 * Tree depth parameter: DEPTH = 20 (supports 1M+ positions)
 */

template BorrowRepayCircuit(DEPTH) {
    // ── Private inputs ────────────────────────────────────────────────────────
    signal input collateral_satoshis; // BTC collateral (does not change in borrow/repay)
    signal input old_debt_stroops;    // Current USDC debt before this operation
    signal input secret;              // Position secret (constant across all operations)
    signal input nonce;               // Position nonce (constant; new nonce in new commit)
    signal input new_nonce;           // New nonce - prevents linking old and new commitments

    // Merkle tree path for the old commitment
    signal input path_elements[DEPTH];
    signal input path_indices[DEPTH];  // 0 = left, 1 = right at each level

    // ── Public inputs ─────────────────────────────────────────────────────────
    signal input old_root;            // Current Merkle root (on-chain state)
    signal input delta_stroops;       // USDC amount borrowed (positive) or repaid (negative)
    signal input is_borrow;           // 1 = borrow (must check ratio), 0 = repay
    // BTC/USD price as USDC stroops per BTC (e.g. $60,000 = 600_000_000_000)
    signal input btc_price_stroops_per_btc;
    // Protocol parameters (on-chain, not user-controlled)
    signal input min_ratio_bp;        // Minimum collateral ratio in bp (15_000 = 150%)

    // ── Public outputs ────────────────────────────────────────────────────────
    signal output new_root;           // Updated Merkle root after commitment swap
    signal output old_nullifier;      // Marks old commitment as spent
    signal output new_commitment;     // New commitment to add to tree

    // ── Step 1: Reconstruct and verify the old commitment ─────────────────────
    component old_commit = Poseidon(4);
    old_commit.inputs[0] <== collateral_satoshis;
    old_commit.inputs[1] <== old_debt_stroops;
    old_commit.inputs[2] <== secret;
    old_commit.inputs[3] <== nonce;
    signal old_commitment <== old_commit.out;

    // ── Step 2: Verify old commitment is in the current Merkle tree ───────────
    // (Uses MerkleTreeUpdater which also checks old root as part of the update)

    // ── Step 3: Compute new debt ──────────────────────────────────────────────
    signal new_debt_stroops <== old_debt_stroops + delta_stroops;

    // new_debt must be non-negative: enforce with a 120-bit range check.
    // 120 bits covers USDC amounts up to ~$10^24 (far beyond realistic values).
    component debt_range = Num2Bits(120);
    debt_range.in <== new_debt_stroops;
    // (If new_debt_stroops were negative, Num2Bits would fail to produce valid bits)

    // `collateral_satoshis` and `btc_price_stroops_per_btc` feed the ratio
    // comparator below (Step 4), whose correctness depends on both operands
    // already fitting their assumed bit-width - GreaterEqThan does not itself
    // verify that. Without an explicit check here, `collateral_satoshis`'
    // range only holds because it happens to be copied forward unchanged from
    // `deposit.circom`'s own `GreaterEqThan(52)` check at the position's
    // creation - a real but undocumented cross-circuit dependency, not
    // something this circuit enforces on its own. `btc_price_stroops_per_btc`
    // has no such indirect guarantee at all; it's a fresh public input every
    // call, only pinned to the real oracle value by the calling contract's
    // separate equality check (`price_signal != get_btc_price_stroops(...)`),
    // not by anything in this circuit. Range-checking both here makes this
    // circuit's own soundness self-contained instead of borrowed.
    component collateral_range = Num2Bits(52); // Bitcoin's 21M BTC cap fits in ~51 bits
    collateral_range.in <== collateral_satoshis;
    component price_range = Num2Bits(64); // generous headroom over any realistic USD price
    price_range.in <== btc_price_stroops_per_btc;

    // ── Step 3b: is_borrow must be boolean, and must match the debt direction ──
    // Without these two constraints, is_borrow is an unconstrained public
    // signal: the ratio check below is gated by `is_borrow * (1 - ratio_ok)`,
    // which is satisfiable for ANY is_borrow value as long as ratio_ok == 1,
    // and trivially satisfiable whenever is_borrow == 0 regardless of
    // ratio_ok - with nothing tying `is_borrow == 0` to delta_stroops actually
    // being non-positive. A prover could set is_borrow = 0 (skipping the ratio
    // check entirely) while delta_stroops is any value that still range-checks
    // at Step 3, including a positive one that increases debt with no
    // collateral-ratio enforcement at all. The Rust caller currently forecloses
    // this only incidentally (`commitment-tree::repay`'s field-negation decode
    // of delta_stroops overflows i128 for a non-negative delta) - that is a
    // property of one specific caller, not a guarantee the circuit itself
    // makes. Fix it here so the circuit is self-sufficient.
    is_borrow * (1 - is_borrow) === 0;

    component debt_did_not_decrease = GreaterEqThan(120);
    debt_did_not_decrease.in[0] <== new_debt_stroops;
    debt_did_not_decrease.in[1] <== old_debt_stroops;
    // is_borrow == 1  =>  new_debt_stroops >= old_debt_stroops
    is_borrow * (1 - debt_did_not_decrease.out) === 0;

    component debt_did_not_increase = LessEqThan(120);
    debt_did_not_increase.in[0] <== new_debt_stroops;
    debt_did_not_increase.in[1] <== old_debt_stroops;
    // is_borrow == 0  =>  new_debt_stroops <= old_debt_stroops
    (1 - is_borrow) * (1 - debt_did_not_increase.out) === 0;

    // ── Step 4: Collateral ratio check (borrow case only) ─────────────────────
    // Check: collateral_satoshis × price × 10_000 >= new_debt × 100_000_000 × min_ratio_bp
    //
    // To avoid overflow (both sides can be ~2^100), we use intermediate signals.
    // We check this only when is_borrow == 1.
    //
    // Left side: collateral_usd_scaled = collateral_satoshis × price / 100_000_000
    // (We compute this as an intermediate step scaled by 10_000 to stay integer)
    //
    // Constraint: lhs >= rhs (checked using GreaterEqThan)
    // lhs = collateral_satoshis × btc_price_stroops_per_btc × 10_000
    // rhs = new_debt_stroops × 100_000_000 × min_ratio_bp

    signal lhs <== collateral_satoshis * btc_price_stroops_per_btc;
    // lhs fits in ~95 bits (satoshis ~51 bits × price ~44 bits)

    signal lhs_scaled <== lhs * 10000;
    // lhs_scaled fits in ~109 bits

    signal rhs <== new_debt_stroops * 100000000;
    // rhs: debt ~87 bits × 10^8 ~27 bits = ~114 bits

    signal rhs_scaled <== rhs * min_ratio_bp;
    // rhs_scaled: ~114 + 14 bits = ~128 bits - within i128 range

    // ratio_ok = 1 if lhs_scaled >= rhs_scaled (collateral ratio satisfied)
    component ratio_check = GreaterEqThan(128);
    ratio_check.in[0] <== lhs_scaled;
    ratio_check.in[1] <== rhs_scaled;

    // When is_borrow == 1: ratio_ok must be 1.
    // When is_borrow == 0 (repay): no ratio check needed.
    // Enforce: is_borrow * (1 - ratio_check.out) === 0
    is_borrow * (1 - ratio_check.out) === 0;

    // ── Step 5: Compute the new commitment ────────────────────────────────────
    component new_commit = Poseidon(4);
    new_commit.inputs[0] <== collateral_satoshis;
    new_commit.inputs[1] <== new_debt_stroops;
    new_commit.inputs[2] <== secret;
    new_commit.inputs[3] <== new_nonce;  // new nonce hides that this is the same position
    new_commitment <== new_commit.out;

    // ── Step 6: Nullifier - marks old commitment as spent ────────────────────
    component null_hasher = Poseidon(2);
    null_hasher.inputs[0] <== secret;
    null_hasher.inputs[1] <== nonce;
    old_nullifier <== null_hasher.out;

    // ── Step 7: Update Merkle tree - verify old root, compute new root ────────
    component updater = MerkleTreeUpdater(DEPTH);
    updater.old_leaf <== old_commitment;
    updater.new_leaf <== new_commitment;
    updater.old_root <== old_root;
    for (var i = 0; i < DEPTH; i++) {
        updater.pathElements[i] <== path_elements[i];
        updater.pathIndices[i]  <== path_indices[i];
    }
    new_root <== updater.new_root;
}

// Public: old_root, delta_stroops, is_borrow, btc_price_stroops_per_btc, min_ratio_bp
// Private: collateral_satoshis, old_debt_stroops, secret, nonce, new_nonce, path_elements, path_indices
// Outputs (public): new_root, old_nullifier, new_commitment
component main {public [
    old_root,
    delta_stroops,
    is_borrow,
    btc_price_stroops_per_btc,
    min_ratio_bp
]} = BorrowRepayCircuit(20);
