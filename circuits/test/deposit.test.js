'use strict';
const { poseidonHash, prove, verify } = require('./helpers');

// Test values — realistic but small enough for fast proving.
const COLLATERAL = 1_000_000n;           // 0.01 BTC = 1,000,000 satoshis
const SECRET = 0xdeadbeefcafe1234n;
const NONCE  = 0x0102030405060708n;
const MIN_DEPOSIT = 100_000n;            // 0.001 BTC minimum
const TXID_LO = 0xabcdef1234567890n;
const TXID_HI = 0x0fedcba987654321n;

function baseInput(overrides = {}) {
    return {
        collateral_satoshis:  String(COLLATERAL),
        secret:               String(SECRET),
        nonce:                String(NONCE),
        btc_txid_lo:          String(TXID_LO),
        btc_txid_hi:          String(TXID_HI),
        min_deposit_satoshis: String(MIN_DEPOSIT),
        ...overrides,
    };
}

describe('deposit circuit', () => {
    test('valid deposit produces correct commitment and nullifier', async () => {
        const input = baseInput();
        const { proof, publicSignals } = await prove('deposit', input);

        // Public signals order (from circom output): commitment, nullifier, then public inputs
        // snarkjs orders: outputs first, then public inputs in declaration order
        // Check by computing expected values independently.
        const expectedCommitment = await poseidonHash([COLLATERAL, 0n, SECRET, NONCE]);
        const expectedNullifier  = await poseidonHash([SECRET, NONCE]);

        expect(BigInt(publicSignals[0])).toBe(expectedCommitment);
        expect(BigInt(publicSignals[1])).toBe(expectedNullifier);

        const valid = await verify('deposit', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('proof verifies correctly', async () => {
        const { proof, publicSignals } = await prove('deposit', baseInput());
        const valid = await verify('deposit', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('different collateral produces different commitment', async () => {
        const { publicSignals: sig1 } = await prove('deposit', baseInput());
        const { publicSignals: sig2 } = await prove('deposit', baseInput({
            collateral_satoshis: String(2_000_000n),
        }));
        expect(sig1[0]).not.toBe(sig2[0]);
    });

    test('same inputs always produce same commitment (deterministic)', async () => {
        const input = baseInput();
        const { publicSignals: s1 } = await prove('deposit', input);
        const { publicSignals: s2 } = await prove('deposit', input);
        expect(s1[0]).toBe(s2[0]);
        expect(s1[1]).toBe(s2[1]);
    });

    test('deposit below minimum is rejected', async () => {
        const input = baseInput({ collateral_satoshis: String(MIN_DEPOSIT - 1n) });
        await expect(prove('deposit', input)).rejects.toThrow();
    });

    test('deposit at exactly minimum is accepted', async () => {
        const input = baseInput({ collateral_satoshis: String(MIN_DEPOSIT) });
        const { proof, publicSignals } = await prove('deposit', input);
        const valid = await verify('deposit', proof, publicSignals);
        expect(valid).toBe(true);
    });

    test('tampered public signal fails verification', async () => {
        const { proof, publicSignals } = await prove('deposit', baseInput());
        // Flip the commitment to a different value.
        const tamperedSignals = [...publicSignals];
        tamperedSignals[0] = String(BigInt(publicSignals[0]) + 1n);
        const valid = await verify('deposit', proof, tamperedSignals);
        expect(valid).toBe(false);
    });
});
