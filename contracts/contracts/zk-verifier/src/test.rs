#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

use crate::{
    CircuitId, G1Point, G2Point, Proof, VerificationKey, ZkVerifierContract,
    ZkVerifierContractClient,
};

mod vectors {
    include!("test_vectors.rs");
}
use vectors::deposit as tv;
use vectors::borrow_repay as br_tv;
use vectors::liquidation as lq_tv;

// ── Fixtures ──────────────────────────────────────────────────────────────────

fn g1(env: &Env, bytes: &[u8; 64]) -> G1Point {
    G1Point { bytes: BytesN::from_array(env, bytes) }
}

fn g2(env: &Env, bytes: &[u8; 128]) -> G2Point {
    G2Point { bytes: BytesN::from_array(env, bytes) }
}

fn signal(env: &Env, bytes: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, bytes)
}

/// Builds the deposit circuit verification key from test vectors.
fn build_vk(env: &Env) -> VerificationKey {
    let ic: Vec<G1Point> = Vec::from_array(env, [
        g1(env, &tv::IC_0),
        g1(env, &tv::IC_1),
        g1(env, &tv::IC_2),
        g1(env, &tv::IC_3),
        g1(env, &tv::IC_4),
        g1(env, &tv::IC_5),
    ]);
    VerificationKey {
        alpha_g1: g1(env, &tv::VK_ALPHA_G1),
        beta_g2:  g2(env, &tv::VK_BETA_G2),
        gamma_g2: g2(env, &tv::VK_GAMMA_G2),
        delta_g2: g2(env, &tv::VK_DELTA_G2),
        ic,
    }
}

/// Builds the valid proof from test vectors.
fn build_proof(env: &Env) -> Proof {
    Proof {
        pi_a: g1(env, &tv::PI_A),
        pi_b: g2(env, &tv::PI_B),
        pi_c: g1(env, &tv::PI_C),
    }
}

/// Builds the valid public signals from test vectors.
fn build_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        signal(env, &tv::SIGNAL_0),
        signal(env, &tv::SIGNAL_1),
        signal(env, &tv::SIGNAL_2),
        signal(env, &tv::SIGNAL_3),
        signal(env, &tv::SIGNAL_4),
    ])
}

/// Deploy and initialize the verifier contract.
fn setup() -> (Env, Address, ZkVerifierContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(ZkVerifierContract, ());
    let client = ZkVerifierContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    (env, admin, client)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds() {
    let (_env, _admin, _client) = setup();
    // No panic = success.
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let (env, _, client) = setup();
    let second_admin = Address::generate(&env);
    client.initialize(&second_admin);
}

// ── Verification key management ───────────────────────────────────────────────

#[test]
fn set_and_get_verification_key() {
    let (env, admin, client) = setup();
    let vk = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk);
    let stored = client.get_verification_key(&CircuitId::Deposit);
    assert!(stored.is_some());
    let stored = stored.unwrap();
    assert_eq!(stored.ic.len(), vk.ic.len());
}

#[test]
fn set_verification_key_emits_vk_rotated_event_with_zero_old_hash_on_first_set() {
    use crate::events::VkRotatedEvent;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::Event as _;

    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(ZkVerifierContract, ());
    let client = ZkVerifierContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let vk = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk);

    let expected = VkRotatedEvent {
        new_vk_hash: crate::vk_fingerprint(&env, &vk),
        circuit: CircuitId::Deposit,
        old_vk_hash: BytesN::from_array(&env, &[0u8; 32]),
    };
    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        std::vec![expected.to_xdr(&env, &contract_id)],
    );
}

#[test]
fn set_verification_key_emits_vk_rotated_event_with_prior_hash_on_rotation() {
    use crate::events::VkRotatedEvent;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::Event as _;

    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(ZkVerifierContract, ());
    let client = ZkVerifierContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let vk1 = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk1);

    // Rotate to a second key that differs from the first (swap two IC
    // entries) so old_vk_hash != new_vk_hash on this second call.
    let mut vk2 = build_vk(&env);
    let ic0 = vk2.ic.get(0).unwrap();
    let ic1 = vk2.ic.get(1).unwrap();
    vk2.ic.set(0, ic1);
    vk2.ic.set(1, ic0);

    client.set_verification_key(&admin, &CircuitId::Deposit, &vk2);

    let expected = VkRotatedEvent {
        new_vk_hash: crate::vk_fingerprint(&env, &vk2),
        circuit: CircuitId::Deposit,
        old_vk_hash: crate::vk_fingerprint(&env, &vk1),
    };
    assert_eq!(
        env.events().all().filter_by_contract(&contract_id).events().last(),
        Some(&expected.to_xdr(&env, &contract_id)),
    );
}

#[test]
fn refresh_ttl_does_not_panic_before_any_key_is_set() {
    let (_env, _admin, client) = setup();
    // Only the admin entry exists at this point; refresh_ttl must not assume
    // any circuit's VerificationKey is present.
    client.refresh_ttl();
}

#[test]
fn refresh_ttl_does_not_panic_after_a_key_is_set() {
    let (env, admin, client) = setup();
    let vk = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk);
    // BorrowRepay/Liquidation are still unset - refresh_ttl must skip them
    // rather than panic on a missing entry.
    client.refresh_ttl();
}

#[test]
#[should_panic]
fn non_admin_cannot_set_verification_key() {
    let (env, _, client) = setup();
    let intruder = Address::generate(&env);
    let vk = build_vk(&env);
    client.set_verification_key(&intruder, &CircuitId::Deposit, &vk);
}

#[test]
fn get_verification_key_returns_none_before_set() {
    let (_env, _admin, client) = setup();
    assert!(client.get_verification_key(&CircuitId::Deposit).is_none());
    assert!(client.get_verification_key(&CircuitId::BorrowRepay).is_none());
    assert!(client.get_verification_key(&CircuitId::Liquidation).is_none());
}

#[test]
fn verification_keys_are_independent_per_circuit() {
    let (env, admin, client) = setup();
    let vk = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk);
    // Other circuits still unset.
    assert!(client.get_verification_key(&CircuitId::BorrowRepay).is_none());
    assert!(client.get_verification_key(&CircuitId::Liquidation).is_none());
}

// ── Proof verification ────────────────────────────────────────────────────────

#[test]
fn valid_deposit_proof_verifies() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));

    let result = client.verify_deposit(&build_proof(&env), &build_signals(&env));
    assert_eq!(result, true);
}

/// Flipping high bits in a G1 X coordinate corrupts the Ethereum-format flag
/// bits, so the Soroban host rejects the point at deserialization and the
/// transaction panics.  This is the correct security behaviour - a malformed
/// proof must never silently verify as false; it must abort the transaction.
#[test]
#[should_panic]
fn malformed_pi_a_flag_bits_panics() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));
    let mut bad_proof = build_proof(&env);
    let mut pi_a_bytes = tv::PI_A;
    pi_a_bytes[0] ^= 0xff; // sets reserved flag bits → host rejects
    bad_proof.pi_a = g1(&env, &pi_a_bytes);
    client.verify_deposit(&bad_proof, &build_signals(&env));
}

/// Flipping an interior byte of pi_c produces a point not on the BN254 curve;
/// the host rejects it and the transaction panics - correct security behaviour.
#[test]
#[should_panic]
fn malformed_pi_c_not_on_curve_panics() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));
    let mut bad_proof = build_proof(&env);
    let mut pi_c_bytes = tv::PI_C;
    pi_c_bytes[10] ^= 0x01; // produces a point not on the curve → host rejects
    bad_proof.pi_c = g1(&env, &pi_c_bytes);
    client.verify_deposit(&bad_proof, &build_signals(&env));
}

#[test]
fn tampered_public_signal_fails_verification() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));

    // Flip the last bit of the commitment signal.
    let mut bad_commitment = tv::SIGNAL_0;
    bad_commitment[31] ^= 0x01;

    let bad_signals: Vec<BytesN<32>> = Vec::from_array(&env, [
        signal(&env, &bad_commitment),
        signal(&env, &tv::SIGNAL_1),
        signal(&env, &tv::SIGNAL_2),
        signal(&env, &tv::SIGNAL_3),
        signal(&env, &tv::SIGNAL_4),
    ]);

    let result = client.verify_deposit(&build_proof(&env), &bad_signals);
    assert_eq!(result, false);
}

#[test]
#[should_panic]
fn wrong_number_of_public_signals_panics() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));

    // 3 signals instead of 5 → PublicInputCountMismatch.
    let short_signals: Vec<BytesN<32>> = Vec::from_array(&env, [
        signal(&env, &tv::SIGNAL_0),
        signal(&env, &tv::SIGNAL_1),
        signal(&env, &tv::SIGNAL_2),
    ]);
    client.verify_deposit(&build_proof(&env), &short_signals);
}

#[test]
#[should_panic]
fn verify_without_verification_key_panics() {
    let (env, _, client) = setup();
    // VK not set - should panic with VerificationKeyNotSet.
    client.verify_deposit(&build_proof(&env), &build_signals(&env));
}

// ── Edge cases ────────────────────────────────────────────────────────────────

#[test]
fn proof_with_swapped_pi_a_and_pi_c_fails() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));

    let swapped_proof = Proof {
        pi_a: g1(&env, &tv::PI_C), // swapped
        pi_b: g2(&env, &tv::PI_B),
        pi_c: g1(&env, &tv::PI_A), // swapped
    };
    let result = client.verify_deposit(&swapped_proof, &build_signals(&env));
    assert_eq!(result, false);
}

#[test]
fn admin_can_update_verification_key() {
    let (env, admin, client) = setup();
    let vk = build_vk(&env);
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk.clone());
    // Update with the same key (idempotent).
    client.set_verification_key(&admin, &CircuitId::Deposit, &vk);
    let result = client.verify_deposit(&build_proof(&env), &build_signals(&env));
    assert_eq!(result, true);
}

// ── Borrow/repay circuit ─────────────────────────────────────────────────────
//
// No coverage existed for this circuit before - `test_vectors.rs` had no
// `borrow_repay` module (see `circuits/scripts/gen_test_vectors.js`, updated
// alongside this test to actually generate one). This is the entrypoint that
// the `is_borrow` soundness fix in `circuits/src/borrow_repay.circom` lives
// behind on-chain; it needs the same direct verifier coverage the other two
// circuits already had.

fn build_br_vk(env: &Env) -> VerificationKey {
    let ic: Vec<G1Point> = Vec::from_array(env, [
        g1(env, &br_tv::IC_0),
        g1(env, &br_tv::IC_1),
        g1(env, &br_tv::IC_2),
        g1(env, &br_tv::IC_3),
        g1(env, &br_tv::IC_4),
        g1(env, &br_tv::IC_5),
        g1(env, &br_tv::IC_6),
        g1(env, &br_tv::IC_7),
        g1(env, &br_tv::IC_8),
    ]);
    VerificationKey {
        alpha_g1: g1(env, &br_tv::VK_ALPHA_G1),
        beta_g2:  g2(env, &br_tv::VK_BETA_G2),
        gamma_g2: g2(env, &br_tv::VK_GAMMA_G2),
        delta_g2: g2(env, &br_tv::VK_DELTA_G2),
        ic,
    }
}

fn build_br_proof(env: &Env) -> Proof {
    Proof {
        pi_a: g1(env, &br_tv::PI_A),
        pi_b: g2(env, &br_tv::PI_B),
        pi_c: g1(env, &br_tv::PI_C),
    }
}

fn build_br_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        signal(env, &br_tv::SIGNAL_0), // new_root
        signal(env, &br_tv::SIGNAL_1), // old_nullifier
        signal(env, &br_tv::SIGNAL_2), // new_commitment
        signal(env, &br_tv::SIGNAL_3), // old_root
        signal(env, &br_tv::SIGNAL_4), // delta_stroops
        signal(env, &br_tv::SIGNAL_5), // is_borrow
        signal(env, &br_tv::SIGNAL_6), // btc_price_stroops_per_btc
        signal(env, &br_tv::SIGNAL_7), // min_ratio_bp
    ])
}

#[test]
fn valid_borrow_repay_proof_verifies() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::BorrowRepay, &build_br_vk(&env));
    let result = client.verify_borrow_repay(&build_br_proof(&env), &build_br_signals(&env));
    assert_eq!(result, true);
}

#[test]
fn tampered_borrow_repay_signal_fails() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::BorrowRepay, &build_br_vk(&env));

    // Tamper with is_borrow (SIGNAL_5) - should invalidate the proof, since
    // the circuit's public statement is bound to the exact signal values it
    // was proven against.
    let mut bad_is_borrow = br_tv::SIGNAL_5;
    bad_is_borrow[31] ^= 0x01;

    let bad_signals: Vec<BytesN<32>> = Vec::from_array(&env, [
        signal(&env, &br_tv::SIGNAL_0),
        signal(&env, &br_tv::SIGNAL_1),
        signal(&env, &br_tv::SIGNAL_2),
        signal(&env, &br_tv::SIGNAL_3),
        signal(&env, &br_tv::SIGNAL_4),
        signal(&env, &bad_is_borrow),
        signal(&env, &br_tv::SIGNAL_6),
        signal(&env, &br_tv::SIGNAL_7),
    ]);
    let result = client.verify_borrow_repay(&build_br_proof(&env), &bad_signals);
    assert_eq!(result, false);
}

#[test]
#[should_panic]
fn borrow_repay_vk_rejects_deposit_shaped_signals() {
    // Deposit has 5 public signals; borrow_repay's VK expects 8 (IC len 9).
    // Submitting the wrong shape must be rejected outright, not silently
    // padded or truncated - this hits PublicInputCountMismatch rather than
    // a same-shape proof-swap case (no other circuit here shares
    // borrow_repay's 8-signal shape to test that variant against).
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::BorrowRepay, &build_br_vk(&env));
    client.verify_borrow_repay(&build_proof(&env), &build_signals(&env));
}

// ── Liquidation circuit ───────────────────────────────────────────────────────

fn build_liq_vk(env: &Env) -> VerificationKey {
    let ic: Vec<G1Point> = Vec::from_array(env, [
        g1(env, &lq_tv::IC_0),
        g1(env, &lq_tv::IC_1),
        g1(env, &lq_tv::IC_2),
        g1(env, &lq_tv::IC_3),
        g1(env, &lq_tv::IC_4),
        g1(env, &lq_tv::IC_5),
    ]);
    VerificationKey {
        alpha_g1: g1(env, &lq_tv::VK_ALPHA_G1),
        beta_g2:  g2(env, &lq_tv::VK_BETA_G2),
        gamma_g2: g2(env, &lq_tv::VK_GAMMA_G2),
        delta_g2: g2(env, &lq_tv::VK_DELTA_G2),
        ic,
    }
}

fn build_liq_proof(env: &Env) -> Proof {
    Proof {
        pi_a: g1(env, &lq_tv::PI_A),
        pi_b: g2(env, &lq_tv::PI_B),
        pi_c: g1(env, &lq_tv::PI_C),
    }
}

fn build_liq_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        signal(env, &lq_tv::SIGNAL_0), // nullifier
        signal(env, &lq_tv::SIGNAL_1), // usdc_debt
        signal(env, &lq_tv::SIGNAL_2), // merkle_root
        signal(env, &lq_tv::SIGNAL_3), // btc_price_stroops_per_btc
        signal(env, &lq_tv::SIGNAL_4), // liquidation_threshold_bp
    ])
}

#[test]
fn valid_liquidation_proof_verifies() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Liquidation, &build_liq_vk(&env));
    let result = client.verify_liquidation(&build_liq_proof(&env), &build_liq_signals(&env));
    assert_eq!(result, true);
}

#[test]
fn tampered_liquidation_nullifier_fails() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Liquidation, &build_liq_vk(&env));

    let mut bad_nullifier = lq_tv::SIGNAL_0;
    bad_nullifier[31] ^= 0x01;

    let bad_signals: Vec<BytesN<32>> = Vec::from_array(&env, [
        signal(&env, &bad_nullifier),
        signal(&env, &lq_tv::SIGNAL_1),
        signal(&env, &lq_tv::SIGNAL_2),
        signal(&env, &lq_tv::SIGNAL_3),
        signal(&env, &lq_tv::SIGNAL_4),
    ]);
    let result = client.verify_liquidation(&build_liq_proof(&env), &bad_signals);
    assert_eq!(result, false);
}

#[test]
#[should_panic]
fn liquidation_wrong_signal_count_panics() {
    let (env, admin, client) = setup();
    client.set_verification_key(&admin, &CircuitId::Liquidation, &build_liq_vk(&env));

    // 3 signals instead of 5 → PublicInputCountMismatch
    let short_signals: Vec<BytesN<32>> = Vec::from_array(&env, [
        signal(&env, &lq_tv::SIGNAL_0),
        signal(&env, &lq_tv::SIGNAL_1),
        signal(&env, &lq_tv::SIGNAL_2),
    ]);
    client.verify_liquidation(&build_liq_proof(&env), &short_signals);
}

#[test]
fn deposit_vk_rejects_liquidation_proof() {
    let (env, admin, client) = setup();
    // Register both VKs independently.
    client.set_verification_key(&admin, &CircuitId::Deposit, &build_vk(&env));
    client.set_verification_key(&admin, &CircuitId::Liquidation, &build_liq_vk(&env));
    // Submitting a liquidation proof against the deposit VK must fail.
    let result = client.verify_deposit(&build_liq_proof(&env), &build_signals(&env));
    assert_eq!(result, false);
}
