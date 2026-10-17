'use strict';
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon, buildBabyjub } = require('circomlibjs');

const ROOT = path.resolve(__dirname, '..');

let poseidon;
async function getPoseidon() {
    if (!poseidon) poseidon = await buildPoseidon();
    return poseidon;
}

// Compute Poseidon hash of an array of BigInt values, returning a BigInt.
async function poseidonHash(inputs) {
    const p = await getPoseidon();
    return p.F.toObject(p(inputs));
}

// Position scheme (#212, see src/position.circom).
const TIMELOCK = 950_000n;

async function liqKey(secret) {
    return poseidonHash([secret]);
}

async function positionCommitment(collateral, debt, secret, nonce, timelock = TIMELOCK) {
    return poseidonHash([collateral, debt, await liqKey(secret), nonce, timelock]);
}

async function positionNullifier(secret, nonce) {
    return poseidonHash([await liqKey(secret), nonce]);
}

let babyjub;
async function getBabyjub() {
    if (!babyjub) babyjub = await buildBabyjub();
    return babyjub;
}

// A keeper BabyJubJub keypair from a scalar.
async function keeperKeypair(sk) {
    const bj = await getBabyjub();
    const pub = bj.mulPointEscalar(bj.Base8, sk);
    return { sk, pub: [bj.F.toObject(pub[0]), bj.F.toObject(pub[1])] };
}

// What the keeper does with a borrow/repay's public keeper note: recompute
// the shared point with its own key and strip the Poseidon pads.
async function openKeeperNote(keeperSk, ephPub, ct) {
    const bj = await getBabyjub();
    const shared = bj.mulPointEscalar([bj.F.e(ephPub[0]), bj.F.e(ephPub[1])], keeperSk);
    const sx = bj.F.toObject(shared[0]);
    const sy = bj.F.toObject(shared[1]);
    const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const out = [];
    for (let i = 0; i < ct.length; i++) {
        const pad = await poseidonHash([sx, sy, BigInt(i)]);
        out.push(((BigInt(ct[i]) - pad) % P + P) % P);
    }
    return out;
}

function unpackPosition(packed) {
    const mask = (bits) => (1n << BigInt(bits)) - 1n;
    return {
        collateral: packed & mask(52),
        debt: (packed >> 52n) & mask(120),
        timelock: packed >> 172n,
    };
}

// Generate a Groth16 proof for a circuit.
async function prove(circuitName, input) {
    const wasmFile = path.join(ROOT, 'build', `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyFile = path.join(ROOT, 'keys', `${circuitName}_final.zkey`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmFile, zkeyFile);
    return { proof, publicSignals };
}

// Verify a Groth16 proof for a circuit.
async function verify(circuitName, proof, publicSignals) {
    const vkeyFile = path.join(ROOT, 'keys', `${circuitName}_vkey.json`);
    const vkey = require(vkeyFile);
    return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// Build a sparse Merkle tree of depth DEPTH with a single leaf at index 0.
// Returns: { root, pathElements, pathIndices }
async function buildSingleLeafTree(leaf, depth = 20) {
    const p = await getPoseidon();
    const F = p.F;

    // Empty subtree hashes at each level (hash of two zeroes, recursively).
    const zeros = new Array(depth + 1);
    zeros[0] = 0n;
    for (let i = 1; i <= depth; i++) {
        const h = p([zeros[i - 1], zeros[i - 1]]);
        zeros[i] = F.toObject(h);
    }

    // The leaf is at index 0, so it is always the LEFT child at every level.
    // pathIndices[i] = 0 means "current node is the left child at level i"
    const pathElements = zeros.slice(0, depth).map((z) => z);
    const pathIndices = new Array(depth).fill(0);

    // Compute root: hash(leaf, zeros[0]), hash(result, zeros[1]), ...
    let current = leaf;
    for (let i = 0; i < depth; i++) {
        const h = p([current, zeros[i]]);
        current = F.toObject(h);
    }
    return { root: current, pathElements, pathIndices };
}

module.exports = {
    poseidonHash, prove, verify, buildSingleLeafTree,
    TIMELOCK, liqKey, positionCommitment, positionNullifier,
    keeperKeypair, openKeeperNote, unpackPosition,
};
