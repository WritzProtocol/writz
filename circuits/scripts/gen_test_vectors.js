#!/usr/bin/env node
/**
 * Generates Rust test vector constants for the zk-verifier Soroban contract.
 *
 * Runs a real snarkjs deposit proof and exports:
 *   - The verification key as Rust byte-array constants
 *   - A valid proof as Rust byte-array constants
 *   - The corresponding public signals
 *
 * Output: contracts/contracts/zk-verifier/src/test_vectors.rs
 *
 * Usage: node circuits/scripts/gen_test_vectors.js
 */
'use strict';
const path  = require('path');
const fs    = require('fs');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

const ROOT = path.resolve(__dirname, '..');
const CONTRACTS_ROOT = path.resolve(__dirname, '../../contracts/contracts/zk-verifier/src');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert a decimal string to a 32-byte big-endian hex string.
function decToHex32(s) {
    let n = BigInt(s);
    let hex = n.toString(16).padStart(64, '0');
    if (hex.length > 64) throw new Error(`Value too large: ${s}`);
    return hex;
}

// Convert a G1 point [x_dec, y_dec, "1"] to 64-byte hex.
// Format: be(x) || be(y) — Ethereum-compatible.
function g1ToHex(point) {
    return decToHex32(point[0]) + decToHex32(point[1]);
}

// Convert a G2 point [[x0,x1],[y0,y1],["1","0"]] to 128-byte hex.
// Soroban / EIP-197 format: be(x.c1) || be(x.c0) || be(y.c1) || be(y.c0)
function g2ToHex(point) {
    // point[0] = [x.c0, x.c1], point[1] = [y.c0, y.c1]
    const xc0 = point[0][0], xc1 = point[0][1];
    const yc0 = point[1][0], yc1 = point[1][1];
    return decToHex32(xc1) + decToHex32(xc0) + decToHex32(yc1) + decToHex32(yc0);
}

// Convert a hex string to a Rust byte array literal.
function hexToRustBytes(hex, name, comment = '') {
    const bytes = hex.match(/.{2}/g).map(b => `0x${b}`).join(', ');
    const commentLine = comment ? `    // ${comment}\n` : '';
    return `${commentLine}    pub const ${name}: [u8; ${hex.length / 2}] = [${bytes}];`;
}

// Format a 32-byte public signal as Rust bytes.
function signalToRustBytes(hex, name) {
    return hexToRustBytes(hex, name);
}

// Build a single-leaf Poseidon Merkle tree of depth 20.
// Returns { root, pathElements, pathIndices } matching the circom helpers.
async function buildSingleLeafTree(poseidon, leaf, depth) {
    // zeros[i] = hash of an empty subtree at depth i
    const zeros = [0n];
    for (let i = 1; i <= depth; i++) {
        zeros[i] = BigInt(poseidon.F.toString(poseidon([zeros[i-1], zeros[i-1]])));
    }
    const pathElements = [];
    const pathIndices  = [];
    let current = leaf;
    for (let i = 0; i < depth; i++) {
        pathElements.push(zeros[i]);
        pathIndices.push(0);
        current = BigInt(poseidon.F.toString(poseidon([current, zeros[i]])));
    }
    return { root: current, pathElements, pathIndices };
}

async function main() {
    const poseidon = await buildPoseidon();

    // ── 1. Generate a deposit proof ───────────────────────────────────────────
    const COLLATERAL = 1_000_000n;
    const SECRET = 0xdeadbeefcafe1234n;
    const NONCE  = 0x0102030405060708n;
    const MIN_DEPOSIT = 100_000n;
    const TXID_LO = 0xabcdef1234567890n;
    const TXID_HI = 0x0fedcba987654321n;

    const depositInput = {
        collateral_satoshis:  COLLATERAL.toString(),
        secret:               SECRET.toString(),
        nonce:                NONCE.toString(),
        btc_txid_lo:          TXID_LO.toString(),
        btc_txid_hi:          TXID_HI.toString(),
        min_deposit_satoshis: MIN_DEPOSIT.toString(),
    };

    console.log('Generating deposit proof…');
    const depositWasm = path.join(ROOT, 'build/deposit_js/deposit.wasm');
    const depositZkey = path.join(ROOT, 'keys/deposit_final.zkey');
    const depositVkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'keys/deposit_vkey.json'), 'utf8'));

    const { proof: depProof, publicSignals: depSignals } =
        await snarkjs.groth16.fullProve(depositInput, depositWasm, depositZkey);
    if (!await snarkjs.groth16.verify(depositVkey, depSignals, depProof))
        throw new Error('deposit proof is invalid');
    console.log('Deposit proof verified ✓');

    // ── 2. Generate a liquidation proof ──────────────────────────────────────
    // Undercollateralized position: 0.005 BTC @ $60k = $300 collateral, $280 debt
    // health = 300/280 = 107% < 120% liquidation threshold → liquidatable
    const LIQ_COLLATERAL = 500_000n;         // satoshis
    const LIQ_DEBT       = 2_800_000_000n;   // USDC stroops
    const LIQ_SECRET     = 0xdeadbeef12345678n;
    const LIQ_NONCE      = 0x8765432112345678n;
    const LIQ_PRICE      = 600_000_000_000n; // stroops per BTC ($60k)
    const LIQ_THRESHOLD  = 12_000n;          // 120% in bp

    // Commitment = Poseidon(collateral_satoshis, debt_stroops, secret, nonce)
    const commitment = BigInt(poseidon.F.toString(
        poseidon([LIQ_COLLATERAL, LIQ_DEBT, LIQ_SECRET, LIQ_NONCE])
    ));
    const { root, pathElements, pathIndices } =
        await buildSingleLeafTree(poseidon, commitment, 20);

    const liqInput = {
        collateral_satoshis:      LIQ_COLLATERAL.toString(),
        debt_stroops:             LIQ_DEBT.toString(),
        secret:                   LIQ_SECRET.toString(),
        nonce:                    LIQ_NONCE.toString(),
        path_elements:            pathElements.map(String),
        path_indices:             pathIndices.map(String),
        merkle_root:              root.toString(),
        btc_price_stroops_per_btc: LIQ_PRICE.toString(),
        liquidation_threshold_bp: LIQ_THRESHOLD.toString(),
    };

    console.log('Generating liquidation proof…');
    const liqWasm = path.join(ROOT, 'build/liquidation_js/liquidation.wasm');
    const liqZkey = path.join(ROOT, 'keys/liquidation_final.zkey');
    const liqVkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'keys/liquidation_vkey.json'), 'utf8'));

    const { proof: liqProof, publicSignals: liqSignals } =
        await snarkjs.groth16.fullProve(liqInput, liqWasm, liqZkey);
    if (!await snarkjs.groth16.verify(liqVkey, liqSignals, liqProof))
        throw new Error('liquidation proof is invalid');
    console.log('Liquidation proof verified ✓');

    // ── 3. Convert to byte format ─────────────────────────────────────────────

    function proofAndVkeyLines(proof, vkey, signals, signalNames, moduleName, header) {
        const piAHex  = g1ToHex(proof.pi_a);
        const piBHex  = g2ToHex(proof.pi_b);
        const piCHex  = g1ToHex(proof.pi_c);
        const alphaHex = g1ToHex(vkey.vk_alpha_1);
        const betaHex  = g2ToHex(vkey.vk_beta_2);
        const gammaHex = g2ToHex(vkey.vk_gamma_2);
        const deltaHex = g2ToHex(vkey.vk_delta_2);
        const icHexes  = vkey.IC.map((ic, i) => ({ name: `IC_${i}`, hex: g1ToHex(ic) }));
        const signalHexes = signals.map((s, i) => ({
            name: `SIGNAL_${i}`,
            hex: decToHex32(s),
            comment: signalNames[i] ?? `signal_${i}`,
        }));
        return [
            header,
            '#[allow(dead_code)]',
            `pub mod ${moduleName} {`,
            '    // ── Proof ──────────────────────────────────────────────────────────────',
            hexToRustBytes(piAHex, 'PI_A', 'G1: 32-byte X || 32-byte Y'),
            hexToRustBytes(piBHex, 'PI_B', 'G2: be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0)'),
            hexToRustBytes(piCHex, 'PI_C', 'G1'),
            '',
            '    // ── Verification key ────────────────────────────────────────────────────',
            hexToRustBytes(alphaHex, 'VK_ALPHA_G1'),
            hexToRustBytes(betaHex,  'VK_BETA_G2'),
            hexToRustBytes(gammaHex, 'VK_GAMMA_G2'),
            hexToRustBytes(deltaHex, 'VK_DELTA_G2'),
            ...icHexes.map(({ name, hex }) => hexToRustBytes(hex, name)),
            `    pub const IC_LEN: usize = ${icHexes.length};`,
            '',
            '    // ── Public signals ─────────────────────────────────────────────────────',
            ...signalHexes.map(({ name, hex, comment }) => hexToRustBytes(hex, name, comment)),
            `    pub const NUM_SIGNALS: usize = ${signalHexes.length};`,
            '}',
        ];
    }

    const depositSignalNames = ['commitment', 'nullifier', 'btc_txid_lo', 'btc_txid_hi', 'min_deposit'];
    // Liquidation: 2 outputs (nullifier, usdc_debt) then 3 public inputs
    const liqSignalNames = ['nullifier', 'usdc_debt', 'merkle_root', 'btc_price_stroops_per_btc', 'liquidation_threshold_bp'];

    // ── 4. Emit Rust source ───────────────────────────────────────────────────
    const lines = [
        '// AUTO-GENERATED by circuits/scripts/gen_test_vectors.js — do not edit.',
        '// Re-generate with: node circuits/scripts/gen_test_vectors.js',
        '//',
        '// Test vectors use the dev trusted setup — NOT for mainnet.',
        '',
        ...proofAndVkeyLines(depProof, depositVkey, depSignals, depositSignalNames, 'deposit',
            '// ── Deposit circuit ──────────────────────────────────────────────────────────'),
        '',
        ...proofAndVkeyLines(liqProof, liqVkey, liqSignals, liqSignalNames, 'liquidation',
            '// ── Liquidation circuit ─────────────────────────────────────────────────────'),
    ];

    const out = lines.join('\n') + '\n';
    fs.writeFileSync(path.join(CONTRACTS_ROOT, 'test_vectors.rs'), out);
    console.log(`Written: contracts/contracts/zk-verifier/src/test_vectors.rs`);
    console.log(`  Deposit signals: ${depSignals.length}, IC: ${depositVkey.IC.length}`);
    console.log(`  Liquidation signals: ${liqSignals.length}, IC: ${liqVkey.IC.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
