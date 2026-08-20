#!/usr/bin/env node
/**
 * Generates a coherent deposit -> borrow -> repay proof chain (same secret,
 * rotating nonce per step, matching how a real position evolves) plus an
 * independent liquidation scenario, as Rust byte-array constants for
 * `commitment-tree/src/test.rs` client-level integration tests.
 *
 * Before this script existed, `commitment-tree`'s test suite never called
 * `deposit`/`borrow`/`repay`/`liquidate` at all - every ZK-gated state
 * transition in the contract had zero test coverage. This closes that gap
 * with real Groth16 proofs, not mocked verification.
 *
 * Output: contracts/contracts/commitment-tree/src/integration_test_vectors.rs
 * Usage: node circuits/scripts/gen_commitment_tree_test_vectors.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const { decToHex32, g1ToHex, g2ToHex, hexToRustBytes } = require('./lib/vkey_encode.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(__dirname, '../../contracts/contracts/commitment-tree/src/integration_test_vectors.rs');
const DEPTH = 20;
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

async function buildSingleLeafTree(poseidon, leaf, depth) {
    const F = poseidon.F;
    const zeros = [0n];
    for (let i = 1; i <= depth; i++) {
        zeros[i] = BigInt(F.toString(poseidon([zeros[i - 1], zeros[i - 1]])));
    }
    const pathElements = [];
    const pathIndices = [];
    let current = leaf;
    for (let i = 0; i < depth; i++) {
        pathElements.push(zeros[i]);
        pathIndices.push(0);
        current = BigInt(F.toString(poseidon([current, zeros[i]])));
    }
    return { root: current, pathElements, pathIndices };
}

function proofLines(name, proof, signals) {
    const piA = g1ToHex(proof.pi_a), piB = g2ToHex(proof.pi_b), piC = g1ToHex(proof.pi_c);
    return [
        hexToRustBytes(piA, `${name}_PI_A`),
        hexToRustBytes(piB, `${name}_PI_B`),
        hexToRustBytes(piC, `${name}_PI_C`),
        ...signals.map((s, i) => hexToRustBytes(decToHex32(s), `${name}_SIGNAL_${i}`)),
        `pub const ${name}_NUM_SIGNALS: usize = ${signals.length};`,
    ];
}

function vkLines(name, vkey) {
    const alpha = g1ToHex(vkey.vk_alpha_1), beta = g2ToHex(vkey.vk_beta_2);
    const gamma = g2ToHex(vkey.vk_gamma_2), delta = g2ToHex(vkey.vk_delta_2);
    return [
        hexToRustBytes(alpha, `${name}_VK_ALPHA_G1`),
        hexToRustBytes(beta, `${name}_VK_BETA_G2`),
        hexToRustBytes(gamma, `${name}_VK_GAMMA_G2`),
        hexToRustBytes(delta, `${name}_VK_DELTA_G2`),
        ...vkey.IC.map((p, i) => hexToRustBytes(g1ToHex(p), `${name}_IC_${i}`)),
        `pub const ${name}_IC_LEN: usize = ${vkey.IC.length};`,
    ];
}

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const poseidonHash = (inputs) => BigInt(F.toString(poseidon(inputs)));

    const COLLATERAL = 1_000_000n; // 0.01 BTC
    const SECRET = 0x5566778811223344n;
    const N0 = 0x1111111111111111n;
    const N1 = 0x2222222222222222n;
    const N2 = 0x3333333333333333n;
    // Must equal Config.min_deposit_satoshis, hardcoded at 10_000 in
    // commitment-tree's initialize() (contracts/contracts/commitment-tree/src/lib.rs) -
    // not the private-lend/frontend default of 100_000.
    const MIN_DEPOSIT = 10_000n;
    const TXID_HI = 0x0fedcba987654321n;
    const TXID_LO = 0xabcdef1234567890n;
    const PRICE = 600_000_000_000n; // $60k, stroops per BTC
    const MIN_RATIO_BP = 15_000n;
    const BORROW_AMOUNT = 2_000_000_000n; // $200 - within 150% ratio for $600 collateral

    // ── 1. Deposit: creates commitment0 = Poseidon(COLLATERAL, 0, SECRET, N0) ──
    const depositInput = {
        collateral_satoshis: COLLATERAL.toString(),
        secret: SECRET.toString(),
        nonce: N0.toString(),
        btc_txid_lo: TXID_LO.toString(),
        btc_txid_hi: TXID_HI.toString(),
        min_deposit_satoshis: MIN_DEPOSIT.toString(),
    };
    const depositVkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'keys/deposit_vkey.json'), 'utf8'));
    console.log('Generating chain step 1/4: deposit…');
    const { proof: depProof, publicSignals: depSignals } = await snarkjs.groth16.fullProve(
        depositInput,
        path.join(ROOT, 'build/deposit_js/deposit.wasm'),
        path.join(ROOT, 'keys/deposit_final.zkey'),
    );
    if (!await snarkjs.groth16.verify(depositVkey, depSignals, depProof)) throw new Error('deposit proof invalid');

    const commitment0 = poseidonHash([COLLATERAL, 0n, SECRET, N0]);
    if (BigInt(depSignals[0]) !== commitment0) throw new Error('commitment0 mismatch');
    const tree0 = await buildSingleLeafTree(poseidon, commitment0, DEPTH);

    // ── 2. Borrow: 0 -> BORROW_AMOUNT debt, same position (N0 -> N1) ──
    const brVkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'keys/borrow_repay_vkey.json'), 'utf8'));
    const brWasm = path.join(ROOT, 'build/borrow_repay_js/borrow_repay.wasm');
    const brZkey = path.join(ROOT, 'keys/borrow_repay_final.zkey');

    const borrowInput = {
        collateral_satoshis: COLLATERAL.toString(),
        old_debt_stroops: '0',
        secret: SECRET.toString(),
        nonce: N0.toString(),
        new_nonce: N1.toString(),
        path_elements: tree0.pathElements.map(String),
        path_indices: tree0.pathIndices.map(String),
        old_root: tree0.root.toString(),
        delta_stroops: BORROW_AMOUNT.toString(),
        is_borrow: '1',
        btc_price_stroops_per_btc: PRICE.toString(),
        min_ratio_bp: MIN_RATIO_BP.toString(),
    };
    console.log('Generating chain step 2/4: borrow…');
    const { proof: borrowProof, publicSignals: borrowSignals } = await snarkjs.groth16.fullProve(borrowInput, brWasm, brZkey);
    if (!await snarkjs.groth16.verify(brVkey, borrowSignals, borrowProof)) throw new Error('borrow proof invalid');

    const commitment1 = poseidonHash([COLLATERAL, BORROW_AMOUNT, SECRET, N1]);
    const tree1 = await buildSingleLeafTree(poseidon, commitment1, DEPTH);
    if (BigInt(borrowSignals[0]) !== tree1.root) throw new Error('tree1 root mismatch');

    // ── 3. Repay: BORROW_AMOUNT -> 0 debt (full repayment), same position (N1 -> N2) ──
    const repayDelta = (FIELD_PRIME - BORROW_AMOUNT) % FIELD_PRIME; // field negation
    const repayInput = {
        collateral_satoshis: COLLATERAL.toString(),
        old_debt_stroops: BORROW_AMOUNT.toString(),
        secret: SECRET.toString(),
        nonce: N1.toString(),
        new_nonce: N2.toString(),
        path_elements: tree1.pathElements.map(String),
        path_indices: tree1.pathIndices.map(String),
        old_root: tree1.root.toString(),
        delta_stroops: repayDelta.toString(),
        is_borrow: '0',
        btc_price_stroops_per_btc: PRICE.toString(),
        min_ratio_bp: MIN_RATIO_BP.toString(),
    };
    console.log('Generating chain step 3/4: repay…');
    const { proof: repayProof, publicSignals: repaySignals } = await snarkjs.groth16.fullProve(repayInput, brWasm, brZkey);
    if (!await snarkjs.groth16.verify(brVkey, repaySignals, repayProof)) throw new Error('repay proof invalid');

    const commitment2 = poseidonHash([COLLATERAL, 0n, SECRET, N2]);
    const tree2 = await buildSingleLeafTree(poseidon, commitment2, DEPTH);
    if (BigInt(repaySignals[0]) !== tree2.root) throw new Error('tree2 root mismatch');

    // ── 4. Liquidation: independent undercollateralized scenario ──
    const LIQ_COLLATERAL = 500_000n;
    const LIQ_DEBT = 2_800_000_000n; // health = 300/280 = 107% < 120% threshold
    const LIQ_SECRET = 0x9988776655443322n;
    const LIQ_NONCE = 0x4444444444444444n;
    const LIQ_THRESHOLD_BP = 12_000n;
    const liqCommitment = poseidonHash([LIQ_COLLATERAL, LIQ_DEBT, LIQ_SECRET, LIQ_NONCE]);
    const liqTree = await buildSingleLeafTree(poseidon, liqCommitment, DEPTH);
    const liqVkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'keys/liquidation_vkey.json'), 'utf8'));
    const liqInput = {
        collateral_satoshis: LIQ_COLLATERAL.toString(),
        debt_stroops: LIQ_DEBT.toString(),
        secret: LIQ_SECRET.toString(),
        nonce: LIQ_NONCE.toString(),
        path_elements: liqTree.pathElements.map(String),
        path_indices: liqTree.pathIndices.map(String),
        merkle_root: liqTree.root.toString(),
        btc_price_stroops_per_btc: PRICE.toString(),
        liquidation_threshold_bp: LIQ_THRESHOLD_BP.toString(),
    };
    console.log('Generating chain step 4/4: liquidation (independent scenario)…');
    const { proof: liqProof, publicSignals: liqSignals } = await snarkjs.groth16.fullProve(
        liqInput,
        path.join(ROOT, 'build/liquidation_js/liquidation.wasm'),
        path.join(ROOT, 'keys/liquidation_final.zkey'),
    );
    if (!await snarkjs.groth16.verify(liqVkey, liqSignals, liqProof)) throw new Error('liquidation proof invalid');

    // ── Emit Rust ──
    const txidHex = TXID_HI.toString(16).padStart(32, '0') + TXID_LO.toString(16).padStart(32, '0');

    const lines = [
        '// AUTO-GENERATED by circuits/scripts/gen_commitment_tree_test_vectors.js - do not edit.',
        '// Regenerate with: node circuits/scripts/gen_commitment_tree_test_vectors.js',
        '//',
        '// A coherent deposit -> borrow -> repay chain (same secret, rotating',
        '// nonce per step) plus an independent liquidation scenario, for',
        '// commitment-tree/src/test.rs client-level integration tests - real',
        '// Groth16 proofs verified through a real deployed zk-verifier instance,',
        '// not mocked. Uses the dev trusted setup - NOT for mainnet.',
        '',
        hexToRustBytes(txidHex, 'DEPOSIT_TXID', '32 bytes: btc_txid_hi(16) || btc_txid_lo(16)'),
        '',
        '// ── Deposit ──────────────────────────────────────────────────────────────────',
        ...vkLines('DEPOSIT', depositVkey),
        ...proofLines('DEPOSIT', depProof, depSignals),
        '',
        '// ── Borrow/repay (shared VK; two proofs, one coherent chain) ──────────────────',
        ...vkLines('BORROW_REPAY', brVkey),
        ...proofLines('BORROW', borrowProof, borrowSignals),
        ...proofLines('REPAY', repayProof, repaySignals),
        '',
        '// ── Liquidation (independent scenario) ─────────────────────────────────────────',
        ...vkLines('LIQUIDATION', liqVkey),
        ...proofLines('LIQUIDATE', liqProof, liqSignals),
    ];
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
    console.log(`Written: ${OUT}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
