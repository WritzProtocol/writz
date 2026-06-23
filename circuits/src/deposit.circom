pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Writz Protocol — Deposit Circuit
 *
 * Proves that a valid BTC deposit was made and creates a cryptographic
 * commitment to the position without revealing the deposited amount.
 *
 * The circuit does NOT verify the Bitcoin SPV proof — that is handled by the
 * separate `bitcoin-spv` Soroban contract.  The circuit only handles the ZK
 * privacy layer: creating a hiding commitment to the position state.
 *
 * Position commitment scheme:
 *   commitment = Poseidon(collateral_satoshis, debt_stroops, secret, nonce)
 *   At deposit time: debt_stroops = 0
 *
 * Nullifier (prevents re-use of the same deposit):
 *   nullifier = Poseidon(secret, nonce)
 *   Published on-chain so this commitment can never be re-deposited.
 *
 * Constraint count: ~320 (Poseidon(4) × 2 + range check)
 */

template DepositCircuit() {
    // ── Private inputs (never revealed to the verifier) ───────────────────────
    signal input collateral_satoshis; // BTC locked in P2WSH (e.g. 1_000_000 = 0.01 BTC)
    signal input secret;              // 254-bit random secret; user must store this safely
    signal input nonce;               // 254-bit random nonce; unique per position

    // ── Public inputs (visible on-chain to the Soroban verifier) ─────────────
    signal input btc_txid_lo;         // Low 128 bits of the Bitcoin txid
    signal input btc_txid_hi;         // High 128 bits of the Bitcoin txid
    signal input min_deposit_satoshis; // Protocol minimum (100_000 = 0.001 BTC)

    // ── Public outputs ────────────────────────────────────────────────────────
    signal output commitment;  // Added to the on-chain Merkle tree
    signal output nullifier;   // Recorded to prevent replay of this deposit

    // ── Constraint 1: Compute the position commitment ─────────────────────────
    // commitment = Poseidon(collateral_satoshis, 0, secret, nonce)
    // The second element is 0 because debt starts at zero at deposit time.
    component commit_hasher = Poseidon(4);
    commit_hasher.inputs[0] <== collateral_satoshis;
    commit_hasher.inputs[1] <== 0;   // initial debt
    commit_hasher.inputs[2] <== secret;
    commit_hasher.inputs[3] <== nonce;
    commitment <== commit_hasher.out;

    // ── Constraint 2: Compute the nullifier ───────────────────────────────────
    // nullifier = Poseidon(secret, nonce)
    // Published on-chain; prevents this same (secret, nonce) pair from ever
    // being used in another deposit.
    component null_hasher = Poseidon(2);
    null_hasher.inputs[0] <== secret;
    null_hasher.inputs[1] <== nonce;
    nullifier <== null_hasher.out;

    // ── Constraint 3: Enforce minimum deposit ─────────────────────────────────
    // collateral_satoshis >= min_deposit_satoshis
    // GreaterEqThan(n) works on n-bit numbers.
    // Bitcoin max satoshis ≈ 2.1 × 10^15 < 2^51, so 52 bits is sufficient.
    component min_check = GreaterEqThan(52);
    min_check.in[0] <== collateral_satoshis;
    min_check.in[1] <== min_deposit_satoshis;
    min_check.out === 1;

    // ── Constraint 4: Bind proof to the Bitcoin transaction ───────────────────
    // btc_txid_lo and btc_txid_hi appear in the public inputs, so the proof is
    // cryptographically bound to a specific Bitcoin txid.  This prevents the
    // same ZK proof from being submitted for a different transaction.
    // No additional constraints needed — being public inputs is sufficient.
    signal txid_bind <== btc_txid_lo * btc_txid_hi;
    _ <== txid_bind; // suppress unused warning; the signals are constrained by being inputs
}

// Public signals: btc_txid_lo, btc_txid_hi, min_deposit_satoshis
// All other signals are private.
// Outputs (commitment, nullifier) are public by virtue of being output signals.
component main {public [btc_txid_lo, btc_txid_hi, min_deposit_satoshis]} = DepositCircuit();
