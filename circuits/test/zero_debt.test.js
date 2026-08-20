'use strict';
const { poseidonHash, prove, verify, buildSingleLeafTree } = require('./helpers');

const DEPTH = 20;
const COLLATERAL = 1_000_000n; // 0.01 BTC
const SECRET = 0xaabbccdd11223344n;
const NONCE  = 0x1122334455667788n;

async function buildZeroDebtTree() {
    const commitment = await poseidonHash([COLLATERAL, 0n, SECRET, NONCE]);
    const tree = await buildSingleLeafTree(commitment, DEPTH);
    return { commitment, ...tree };
}

function zeroDebtInput({ tree }) {
    return {
        collateral_satoshis: String(COLLATERAL),
        secret:               String(SECRET),
        nonce:                String(NONCE),
        path_elements:        tree.pathElements.map(String),
        path_indices:         tree.pathIndices.map(String),
        merkle_root:          String(tree.root),
    };
}

describe('zero_debt circuit', () => {
    test('a commitment with zero debt proves and verifies', async () => {
        const tree = await buildZeroDebtTree();
        const input = zeroDebtInput({ tree });
        const { proof, publicSignals } = await prove('zero_debt', input);
        const valid = await verify('zero_debt', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('merkle_root is the only public signal, and it echoes the input root', async () => {
        const tree = await buildZeroDebtTree();
        const input = zeroDebtInput({ tree });
        const { publicSignals } = await prove('zero_debt', input);
        expect(publicSignals.length).toBe(1);
        expect(BigInt(publicSignals[0])).toBe(tree.root);
    });

    test('a commitment with non-zero debt cannot generate a valid proof', async () => {
        // Build a tree from a commitment that actually encodes debt=500 -
        // the circuit hardcodes 0 as the second Poseidon input (see
        // circuits/src/zero_debt.circom, Step 1), so proving against this
        // tree's root requires a leaf the circuit is structurally incapable
        // of producing. This is the core security property this circuit
        // exists for: it must be impossible to release BTC for a position
        // that still owes debt.
        const debtCommitment = await poseidonHash([COLLATERAL, 500n, SECRET, NONCE]);
        const tree = await buildSingleLeafTree(debtCommitment, DEPTH);
        const input = zeroDebtInput({ tree });
        await expect(prove('zero_debt', input)).rejects.toThrow();
    });

    test('wrong merkle root fails proof generation', async () => {
        const tree = await buildZeroDebtTree();
        const input = zeroDebtInput({ tree });
        input.merkle_root = String(tree.root + 1n); // corrupted root
        await expect(prove('zero_debt', input)).rejects.toThrow();
    });

    test('wrong collateral value fails proof generation', async () => {
        // Proving with a collateral value that doesn't match what was
        // committed changes the recomputed leaf, breaking Merkle inclusion -
        // same failure mode as a tampered secret/nonce would produce.
        const tree = await buildZeroDebtTree();
        const input = zeroDebtInput({ tree });
        input.collateral_satoshis = String(COLLATERAL + 1n);
        await expect(prove('zero_debt', input)).rejects.toThrow();
    });

    test('tampered merkle_root public signal fails verification', async () => {
        const tree = await buildZeroDebtTree();
        const input = zeroDebtInput({ tree });
        const { proof, publicSignals } = await prove('zero_debt', input);
        const tampered = [String(BigInt(publicSignals[0]) + 1n)];
        const valid = await verify('zero_debt', proof, tampered);
        expect(valid).toBe(false);
    });
});
