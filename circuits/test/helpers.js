'use strict';
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

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

module.exports = { poseidonHash, prove, verify, buildSingleLeafTree };
