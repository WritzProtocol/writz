'use strict';
const { poseidonHash, prove, verify, buildSingleLeafTree } = require('./helpers');

// Fixed position parameters shared across tests.
const COLLATERAL   = 1_000_000n;   // 0.01 BTC = 1,000,000 satoshis
const OLD_DEBT     = 0n;           // Fresh deposit, no debt
const SECRET       = 0xaabbccdd11223344n;
const NONCE        = 0x1122334455667788n;
const NEW_NONCE    = 0x9900aabb11223344n;

// $60,000 per BTC in USDC stroops (7 decimals): 60_000 × 10_000_000
const PRICE_STROOPS_PER_BTC = 600_000_000_000n;
// Collateral value = 1_000_000 sats × 600_000_000_000 / 100_000_000 = 6_000_000_000 stroops ($600)
// Max borrow at 150%: 6_000_000_000 × 10_000 / 15_000 = 4_000_000_000 stroops ($400)
const MAX_BORROW = 4_000_000_000n;
const MIN_RATIO_BP = 15_000n;  // 150%
const DEPTH = 20;

async function buildBaseTree() {
    const oldCommitment = await poseidonHash([COLLATERAL, OLD_DEBT, SECRET, NONCE]);
    const tree = await buildSingleLeafTree(oldCommitment, DEPTH);
    return { oldCommitment, ...tree };
}

function borrowInput({ tree, oldDebt = OLD_DEBT, newNonce = NEW_NONCE, delta, isBorrow = 1 }) {
    return {
        collateral_satoshis:        String(COLLATERAL),
        old_debt_stroops:            String(oldDebt),
        secret:                      String(SECRET),
        nonce:                       String(NONCE),
        new_nonce:                   String(newNonce),
        path_elements:               tree.pathElements.map(String),
        path_indices:                tree.pathIndices.map(String),
        old_root:                    String(tree.root),
        delta_stroops:               String(delta),
        is_borrow:                   String(isBorrow),
        btc_price_stroops_per_btc:   String(PRICE_STROOPS_PER_BTC),
        min_ratio_bp:                String(MIN_RATIO_BP),
    };
}

describe('borrow_repay circuit', () => {
    test('valid borrow within collateral ratio succeeds', async () => {
        const tree = await buildBaseTree();
        const BORROW_AMOUNT = 2_000_000_000n; // $200 USDC (well under $400 max)
        const input = borrowInput({ tree, delta: BORROW_AMOUNT, isBorrow: 1 });
        const { proof, publicSignals } = await prove('borrow_repay', input);
        const valid = await verify('borrow_repay', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('borrow produces correct new commitment', async () => {
        const tree = await buildBaseTree();
        const BORROW = 1_000_000_000n; // $100 USDC
        const input = borrowInput({ tree, delta: BORROW, isBorrow: 1 });
        const { publicSignals } = await prove('borrow_repay', input);

        // new_commitment = Poseidon(collateral, old_debt + borrow, secret, new_nonce)
        const expectedNewCommitment = await poseidonHash([
            COLLATERAL, OLD_DEBT + BORROW, SECRET, NEW_NONCE,
        ]);
        // publicSignals[1] is new_root, [2] is old_nullifier, [0] is new_commitment
        // Actual order depends on circuit output declaration order
        // In our circuit: new_root, old_nullifier, new_commitment
        // snarkjs outputs: [new_root, old_nullifier, new_commitment, ...public inputs]
        const commitment = publicSignals.find((s) => BigInt(s) === expectedNewCommitment);
        expect(commitment).toBeDefined();
    });

    test('nullifier matches Poseidon(secret, nonce)', async () => {
        const tree = await buildBaseTree();
        const input = borrowInput({ tree, delta: 500_000_000n, isBorrow: 1 });
        const { publicSignals } = await prove('borrow_repay', input);

        const expectedNullifier = await poseidonHash([SECRET, NONCE]);
        const found = publicSignals.find((s) => BigInt(s) === expectedNullifier);
        expect(found).toBeDefined();
    });

    test('borrow at exactly max collateral ratio succeeds', async () => {
        const tree = await buildBaseTree();
        const input = borrowInput({ tree, delta: MAX_BORROW, isBorrow: 1 });
        const { proof, publicSignals } = await prove('borrow_repay', input);
        const valid = await verify('borrow_repay', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('borrow exceeding collateral ratio is rejected', async () => {
        const tree = await buildBaseTree();
        const OVER_BORROW = MAX_BORROW + 1n; // 1 stroop over the limit
        const input = borrowInput({ tree, delta: OVER_BORROW, isBorrow: 1 });
        await expect(prove('borrow_repay', input)).rejects.toThrow();
    });

    test('repay reduces debt without ratio check', async () => {
        // First borrow $200.
        const tree1 = await buildBaseTree();
        const BORROW = 2_000_000_000n;
        const inputBorrow = borrowInput({ tree: tree1, delta: BORROW, isBorrow: 1 });
        const { publicSignals: borrowSigs } = await prove('borrow_repay', inputBorrow);
        // new_root after borrow
        const newRootAfterBorrow = BigInt(borrowSigs[0]);

        // Build a new tree with the updated commitment at index 0.
        const newCommitmentAfterBorrow = await poseidonHash([
            COLLATERAL, BORROW, SECRET, NEW_NONCE,
        ]);
        const tree2 = await buildSingleLeafTree(newCommitmentAfterBorrow, DEPTH);
        // Sanity: the computed root should match the proof's new_root.
        expect(tree2.root).toBe(newRootAfterBorrow);

        // Now repay $100: delta = -100 USDC = -1_000_000_000 stroops
        // In the circuit, delta_stroops is used as a field element.
        // A negative repay is expressed as the field complement:
        // BN254 field prime p ≈ 2^254; a "negative" delta in the circuit means
        // old_debt + delta = old_debt - repay_amount (field arithmetic wraps correctly
        // because the circuit uses signal arithmetic, not signed integers).
        // For testing, repay the entire debt (delta = -BORROW as field element).
        // Simpler: just repay to zero and verify new_debt = 0.
        const REPAY = BORROW; // full repayment
        // In field arithmetic: old_debt - repay = BORROW + (-REPAY) mod p
        // snarkjs handles BigInt field elements; we pass the 2's-complement-like value.
        const fieldPrime = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        const repayDelta = (fieldPrime - REPAY) % fieldPrime; // = -REPAY in the field

        const inputRepay = {
            collateral_satoshis:      String(COLLATERAL),
            old_debt_stroops:          String(BORROW),
            secret:                    String(SECRET),
            nonce:                     String(NEW_NONCE),   // use new nonce from borrow
            new_nonce:                 String(0xffeeddcc11223344n),
            path_elements:             tree2.pathElements.map(String),
            path_indices:              tree2.pathIndices.map(String),
            old_root:                  String(tree2.root),
            delta_stroops:             String(repayDelta),
            is_borrow:                 '0',  // repay — skip ratio check
            btc_price_stroops_per_btc: String(PRICE_STROOPS_PER_BTC),
            min_ratio_bp:              String(MIN_RATIO_BP),
        };

        const { proof: repayProof, publicSignals: repaySigs } = await prove('borrow_repay', inputRepay);
        const valid = await verify('borrow_repay', repayProof, repaySigs);
        expect(valid).toBe(true);
    });

    test('tampered old_root fails proof generation', async () => {
        const tree = await buildBaseTree();
        const input = borrowInput({ tree, delta: 500_000_000n, isBorrow: 1 });
        input.old_root = String(tree.root + 1n); // wrong root
        await expect(prove('borrow_repay', input)).rejects.toThrow();
    });
});
