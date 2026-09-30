pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Writz Protocol - Deposit Circuit
 *
 * Proves that a valid BTC deposit was made and creates a cryptographic
 * commitment to the position without revealing the deposited amount.
 *
 * The circuit does NOT verify the Bitcoin SPV proof - that is handled by the
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
 * `actual_satoshis` (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6,
 * GHSA-mg4x-cr23-4x3v): the contract parses the real BTC amount paid to the
 * shared ZK vault script from `raw_tx` and passes it in as this public
 * input; `collateral_satoshis === actual_satoshis` below is what actually
 * binds the hidden collateral witness to Bitcoin reality - without it,
 * nothing here (or in commitment-tree, before this fix) related the private
 * collateral claim to what the referenced transaction paid, so a witness
 * with sats=0 and a claimed collateral_satoshis of 10,000 BTC verified just
 * as validly as an honest one.
 *
 * Constraint count: 596 non-linear (measured via `circom --r1cs`, not an
 * estimate - regenerate this comment if the circuit changes again rather
 * than trusting stale arithmetic here).
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
    // Real amount the referenced transaction paid to the protocol's shared
    // ZK vault script, as parsed on-chain by commitment-tree::deposit.
    signal input actual_satoshis;

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

    // ── Constraint 4: Bind the private collateral to the real BTC amount ─────
    // The whole soundness fix (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6,
    // GHSA-mg4x-cr23-4x3v): forces the hidden collateral_satoshis used in the
    // commitment above to equal the amount commitment-tree independently
    // parsed from the real, SPV-verified Bitcoin transaction. A prover
    // cannot commit to a larger private collateral_satoshis than what was
    // actually paid, since a mismatched value cannot satisfy this equality.
    collateral_satoshis === actual_satoshis;

    // btc_txid_lo and btc_txid_hi are bound to this proof simply by being
    // declared as public inputs above - Groth16's public statement already
    // includes them, so the verifier cannot swap in different txid values
    // without invalidating the proof. No additional in-circuit constraint is
    // needed or possible to add here: a signal that is only ever multiplied
    // and then discarded (as a previous version of this circuit did) adds no
    // binding at all - it is dead code, not a security property.
}

// Public signals: btc_txid_lo, btc_txid_hi, min_deposit_satoshis, actual_satoshis
// All other signals are private.
// Outputs (commitment, nullifier) are public by virtue of being output signals.
component main {public [btc_txid_lo, btc_txid_hi, min_deposit_satoshis, actual_satoshis]} = DepositCircuit();
