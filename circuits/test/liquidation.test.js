'use strict';
const { poseidonHash, prove, verify, buildSingleLeafTree } = require('./helpers');

const DEPTH = 20;
const PRICE_STROOPS_PER_BTC = 600_000_000_000n; // $60,000 per BTC
const LIQUIDATION_THRESHOLD_BP = 12_000n;        // 120%
const SECRET = 0xdeadbeef12345678n;
const NONCE  = 0x8765432112345678n;

// Undercollateralized position:
//   collateral = 500_000 sats (0.005 BTC = $300 at $60k)
//   debt = 2_800_000_000 stroops ($280)
//   health = 300/280 = 107% < 120% threshold → liquidatable
const COLLATERAL_UNDER = 500_000n;
const DEBT_UNDER       = 2_800_000_000n;

// Healthy position:
//   collateral = 500_000 sats ($300)
//   debt = 1_000_000_000 stroops ($100)
//   health = 300% > 120% → not liquidatable
const COLLATERAL_HEALTHY = 500_000n;
const DEBT_HEALTHY       = 1_000_000_000n;

async function buildTree(collateral, debt) {
    const commitment = await poseidonHash([collateral, debt, SECRET, NONCE]);
    const tree = await buildSingleLeafTree(commitment, DEPTH);
    return { commitment, ...tree };
}

function liquidateInput({ tree, collateral, debt }) {
    return {
        collateral_satoshis:        String(collateral),
        debt_stroops:                String(debt),
        secret:                      String(SECRET),
        nonce:                       String(NONCE),
        path_elements:               tree.pathElements.map(String),
        path_indices:                tree.pathIndices.map(String),
        merkle_root:                 String(tree.root),
        btc_price_stroops_per_btc:   String(PRICE_STROOPS_PER_BTC),
        liquidation_threshold_bp:    String(LIQUIDATION_THRESHOLD_BP),
    };
}

describe('liquidation circuit', () => {
    test('undercollateralized position proves and verifies', async () => {
        const tree = await buildTree(COLLATERAL_UNDER, DEBT_UNDER);
        const input = liquidateInput({ tree, collateral: COLLATERAL_UNDER, debt: DEBT_UNDER });
        const { proof, publicSignals } = await prove('liquidation', input);
        const valid = await verify('liquidation', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('nullifier matches Poseidon(secret, nonce)', async () => {
        const tree = await buildTree(COLLATERAL_UNDER, DEBT_UNDER);
        const input = liquidateInput({ tree, collateral: COLLATERAL_UNDER, debt: DEBT_UNDER });
        const { publicSignals } = await prove('liquidation', input);

        const expectedNullifier = await poseidonHash([SECRET, NONCE]);
        // publicSignals[0] = nullifier (first output); publicSignals[1] = usdc_debt (second output)
        expect(BigInt(publicSignals[0])).toBe(expectedNullifier);
    });

    test('healthy position is rejected by the circuit', async () => {
        const tree = await buildTree(COLLATERAL_HEALTHY, DEBT_HEALTHY);
        const input = liquidateInput({ tree, collateral: COLLATERAL_HEALTHY, debt: DEBT_HEALTHY });
        await expect(prove('liquidation', input)).rejects.toThrow();
    });

    test('position exactly at threshold is rejected (must be strictly below)', async () => {
        // At exactly 120%: collateral × price × 10_000 == debt × sats_per_btc × threshold_bp
        // → not < threshold → not liquidatable
        // collateral = 500_000 sats, threshold debt = collateral_usd / 1.2
        // collateral_usd_stroops = 500_000 × 600_000_000_000 / 100_000_000 = 3_000_000_000
        // threshold_debt = 3_000_000_000 × 10_000 / 12_000 = 2_500_000_000
        const collateral = 500_000n;
        const debt = 2_500_000_000n; // exactly at threshold
        const tree = await buildTree(collateral, debt);
        const input = liquidateInput({ tree, collateral, debt });
        // GreaterThan requires strict inequality: rhs > lhs, not rhs >= lhs
        // At exactly 120%, rhs == lhs → not strictly greater → circuit rejects
        await expect(prove('liquidation', input)).rejects.toThrow();
    });

    test('wrong merkle root fails proof generation', async () => {
        const tree = await buildTree(COLLATERAL_UNDER, DEBT_UNDER);
        const input = liquidateInput({ tree, collateral: COLLATERAL_UNDER, debt: DEBT_UNDER });
        input.merkle_root = String(tree.root + 1n); // corrupted root
        await expect(prove('liquidation', input)).rejects.toThrow();
    });

    test('tampered nullifier fails verification', async () => {
        const tree = await buildTree(COLLATERAL_UNDER, DEBT_UNDER);
        const input = liquidateInput({ tree, collateral: COLLATERAL_UNDER, debt: DEBT_UNDER });
        const { proof, publicSignals } = await prove('liquidation', input);
        const tampered = [...publicSignals];
        tampered[0] = String(BigInt(publicSignals[0]) + 1n);
        const valid = await verify('liquidation', proof, tampered);
        expect(valid).toBe(false);
    });
});
