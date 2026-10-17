pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Writz Protocol - position building blocks shared by every circuit (#212).
 *
 * A position has two keys:
 *   secret   - the owner's spending key. Borrow, repay and release prove
 *              knowledge of it.
 *   liq_key  - Poseidon(secret). Enough to prove a position is
 *              undercollateralized and liquidate it, not to change or release
 *              it. Every borrow and repay encrypts it to the protocol keeper
 *              (see KeeperNote), so a ZK position can be liquidated without
 *              its owner.
 *
 *   commitment = Poseidon(collateral_satoshis, debt_stroops, liq_key, nonce, timelock_height)
 *   nullifier  = Poseidon(liq_key, nonce)
 *
 * `timelock_height` is the CLTV height of the position's Bitcoin script. It
 * is bound at deposit to the height the contract checked against the real
 * output, carried unchanged through every update, and lets `borrow` require
 * real time left before the owner can reclaim the BTC alone.
 */

template LiquidationKey() {
    signal input secret;
    signal output out;

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    out <== h.out;
}

template PositionCommitment() {
    signal input collateral_satoshis;
    signal input debt_stroops;
    signal input liq_key;
    signal input nonce;
    signal input timelock_height;
    signal output out;

    component h = Poseidon(5);
    h.inputs[0] <== collateral_satoshis;
    h.inputs[1] <== debt_stroops;
    h.inputs[2] <== liq_key;
    h.inputs[3] <== nonce;
    h.inputs[4] <== timelock_height;
    out <== h.out;
}

template PositionNullifier() {
    signal input liq_key;
    signal input nonce;
    signal output out;

    component h = Poseidon(2);
    h.inputs[0] <== liq_key;
    h.inputs[1] <== nonce;
    out <== h.out;
}

/*
 * The keeper note's third element: collateral, debt and timelock packed into
 * one field element (52 + 120 + 32 = 204 bits). Every caller range-checks the
 * three parts to those widths, so the packing is injective.
 */
template PackPosition() {
    signal input collateral_satoshis;
    signal input debt_stroops;
    signal input timelock_height;
    signal output out;

    out <== collateral_satoshis
        + debt_stroops * (1 << 52)
        + timelock_height * (1 << 172);
}

/*
 * Verifiable encryption of a position's liquidation witness to the keeper.
 *
 * The prover picks a fresh ephemeral scalar `eph_sk`. Over BabyJubJub:
 *   eph_pub = eph_sk · B8
 *   shared  = eph_sk · keeper_pub        (the keeper computes keeper_sk · eph_pub)
 *   ct[i]   = msg[i] + Poseidon(shared.x, shared.y, i)
 *
 * Because the encryption is a constraint of the proof, a borrower cannot
 * publish a note the keeper fails to open, which is what would otherwise make
 * a position unliquidatable. The contract pins `keeper_pub` to its configured
 * key. Observers see only `eph_pub` and `ct`; the keypad is a Poseidon output
 * of a Diffie-Hellman secret they do not know.
 */
template KeeperNote(N) {
    signal input eph_sk;
    signal input keeper_pub[2];
    signal input msg[N];
    signal output eph_pub[2];
    signal output ct[N];

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // The identity point (x = 0) would make the pad public. The contract pins
    // keeper_pub to its configured key; this keeps the circuit sound alone.
    component pub_is_identity = IsZero();
    pub_is_identity.in <== keeper_pub[0];
    pub_is_identity.out === 0;

    component bits = Num2Bits(253);
    bits.in <== eph_sk;

    component pub = EscalarMulFix(253, BASE8);
    component dh = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        pub.e[i] <== bits.out[i];
        dh.e[i] <== bits.out[i];
    }
    dh.p[0] <== keeper_pub[0];
    dh.p[1] <== keeper_pub[1];
    eph_pub[0] <== pub.out[0];
    eph_pub[1] <== pub.out[1];

    component pad[N];
    for (var i = 0; i < N; i++) {
        pad[i] = Poseidon(3);
        pad[i].inputs[0] <== dh.out[0];
        pad[i].inputs[1] <== dh.out[1];
        pad[i].inputs[2] <== i;
        ct[i] <== msg[i] + pad[i].out;
    }
}
