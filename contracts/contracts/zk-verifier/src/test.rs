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
/// transaction panics.  This is the correct security behaviour — a malformed
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
/// the host rejects it and the transaction panics — correct security behaviour.
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
    // VK not set — should panic with VerificationKeyNotSet.
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
