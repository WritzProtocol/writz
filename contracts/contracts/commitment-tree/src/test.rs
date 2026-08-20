#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Address, Bytes,
    BytesN, Env, Vec,
};

use crate::{
    types::{DataKey, G1Point, G2Point},
    CommitmentTreeContract, CommitmentTreeContractClient, Proof,
    BN254_PRIME, EMPTY_TREE_ROOT, be32_sub, i128_from_be32_low, sig_i128, sig_u32, sig_u64,
};
use spv_types::SpvVerificationResult;

#[allow(dead_code)]
mod integration_vectors {
    include!("integration_test_vectors.rs");
}
use integration_vectors as iv;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn zero32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn empty_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &EMPTY_TREE_ROOT)
}

fn from_u32(env: &Env, v: u32) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[28..32].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &arr)
}

fn from_i128(env: &Env, v: i128) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[16..32].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &arr)
}

fn setup(env: &Env) -> (CommitmentTreeContractClient<'_>, Address, Address, Address, Address, Address) {
    let id = env.register(CommitmentTreeContract, ());
    let client = CommitmentTreeContractClient::new(env, &id);
    let admin  = Address::generate(env);
    let spv    = Address::generate(env);
    let zk     = Address::generate(env);
    let usdc   = Address::generate(env);
    let oracle = Address::generate(env);
    (client, admin, spv, zk, usdc, oracle)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_empty_tree_root() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    assert_eq!(client.get_merkle_root(), empty_root(&env));
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
}

// ── View functions ────────────────────────────────────────────────────────────

#[test]
fn nullifier_not_spent_initially() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    assert!(!client.is_nullifier_spent(&zero32(&env)));
}

#[test]
fn commitment_not_pending_initially() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    assert!(!client.is_commitment_pending(&zero32(&env)));
}

#[test]
fn get_commitment_returns_none_before_deposit() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    assert_eq!(client.get_commitment(&zero32(&env)), None);
}

#[test]
fn pool_state_starts_at_zero() {
    let env = Env::default();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    assert_eq!(client.get_pool_state(), (0_i128, 0_i128));
}

// ── insert_commitment auth ────────────────────────────────────────────────────

#[test]
#[should_panic]
fn insert_commitment_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let non_admin = Address::generate(&env);
    client.insert_commitment(&non_admin, &zero32(&env), &zero32(&env));
}

// ── Config setters (admin only) ───────────────────────────────────────────────

#[test]
fn set_oracle_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let new_oracle = Address::generate(&env);
    client.set_oracle(&admin, &new_oracle);
    // No panic = success. No public config getter exists to assert the
    // stored value directly.
}

#[test]
#[should_panic]
fn set_oracle_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let non_admin = Address::generate(&env);
    client.set_oracle(&non_admin, &non_admin);
}

#[test]
fn set_spv_contract_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let new_spv = Address::generate(&env);
    client.set_spv_contract(&admin, &new_spv);
}

#[test]
#[should_panic]
fn set_spv_contract_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let non_admin = Address::generate(&env);
    client.set_spv_contract(&non_admin, &non_admin);
}

#[test]
fn set_zk_verifier_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let new_zk = Address::generate(&env);
    client.set_zk_verifier(&admin, &new_zk);
}

#[test]
#[should_panic]
fn set_zk_verifier_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    let non_admin = Address::generate(&env);
    client.set_zk_verifier(&non_admin, &non_admin);
}

// ── paused / supply_usdc / withdraw_supply ────────────────────────────────────
//
// `setup()` above uses a fake `usdc` address (no real token contract behind
// it) since none of the tests it originally supported call `supply_usdc`/
// `withdraw_supply`. Those two functions need a real SEP-41 token to
// transfer, so this section deploys its own Stellar Asset Contract instead
// of reusing `setup()`, mirroring the pattern in `private-lend/src/test.rs`.

fn setup_with_real_usdc(
    env: &Env,
) -> (CommitmentTreeContractClient<'_>, Address, Address, Address) {
    let id = env.register(CommitmentTreeContract, ());
    let client = CommitmentTreeContractClient::new(env, &id);
    let admin = Address::generate(env);
    let spv = Address::generate(env);
    let zk = Address::generate(env);
    let oracle = Address::generate(env);

    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = usdc_id.address();

    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    (client, admin, usdc, spv)
}

#[test]
fn set_paused_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _usdc, _spv) = setup_with_real_usdc(&env);
    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);
}

#[test]
#[should_panic]
fn set_paused_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _usdc, _spv) = setup_with_real_usdc(&env);
    let rando = Address::generate(&env);
    client.set_paused(&rando, &true);
}

#[test]
fn supply_increases_pool_and_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, usdc, _spv) = setup_with_real_usdc(&env);
    let supplier = Address::generate(&env);
    let amount = 1_000_000_000_i128; // 100 USDC
    StellarAssetClient::new(&env, &usdc).mint(&supplier, &amount);

    client.supply_usdc(&supplier, &amount);

    let (total_supplied, _) = client.get_pool_state();
    assert_eq!(total_supplied, amount);
    assert_eq!(client.get_supply_balance(&supplier), amount);
}

#[test]
#[should_panic]
fn supply_usdc_while_paused_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, usdc, _spv) = setup_with_real_usdc(&env);
    let supplier = Address::generate(&env);
    let amount = 1_000_000_000_i128;
    StellarAssetClient::new(&env, &usdc).mint(&supplier, &amount);

    client.set_paused(&admin, &true);
    client.supply_usdc(&supplier, &amount);
}

#[test]
fn withdraw_supply_works_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, usdc, _spv) = setup_with_real_usdc(&env);
    let supplier = Address::generate(&env);
    let amount = 1_000_000_000_i128;
    StellarAssetClient::new(&env, &usdc).mint(&supplier, &amount);
    client.supply_usdc(&supplier, &amount);

    client.set_paused(&admin, &true);
    // Exiting is never blocked by a pause - only new deposits/borrows/supply are.
    client.withdraw_supply(&supplier, &amount);

    assert_eq!(client.get_supply_balance(&supplier), 0);
}

#[test]
#[should_panic]
fn insert_commitment_with_unknown_commitment_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, spv, zk, usdc, oracle) = setup(&env);
    client.initialize(&admin, &spv, &zk, &usdc, &oracle, &6);
    client.insert_commitment(&admin, &zero32(&env), &zero32(&env));
}

// ── Signal extraction helpers ─────────────────────────────────────────────────

#[test]
fn sig_u32_extracts_from_last_4_bytes() {
    let env = Env::default();
    let sig = from_u32(&env, 15_000);
    assert_eq!(sig_u32(&sig), 15_000);
}

#[test]
fn sig_u32_with_zero_returns_zero() {
    let env = Env::default();
    assert_eq!(sig_u32(&zero32(&env)), 0);
}

#[test]
fn sig_u64_extracts_satoshi_amounts() {
    let env = Env::default();
    // 0.01 BTC = 1_000_000 satoshis
    let mut arr = [0u8; 32];
    let sats: u64 = 1_000_000;
    arr[24..32].copy_from_slice(&sats.to_be_bytes());
    let sig = BytesN::from_array(&env, &arr);
    assert_eq!(sig_u64(&sig), 1_000_000);
}

#[test]
fn sig_i128_extracts_from_low_16_bytes() {
    let env = Env::default();
    let amount: i128 = 600_000_000_000; // $60k BTC price in USDC stroops
    let sig = from_i128(&env, amount);
    assert_eq!(sig_i128(&sig), Some(amount));
}

#[test]
fn sig_i128_rejects_values_too_large() {
    let env = Env::default();
    // Set a non-zero high byte - value overflows i128.
    let mut arr = [0u8; 32];
    arr[0] = 0x01;
    let sig = BytesN::from_array(&env, &arr);
    assert_eq!(sig_i128(&sig), None);
}

// ── BN254 arithmetic ──────────────────────────────────────────────────────────

#[test]
fn be32_sub_recovers_repay_amount() {
    // For a repay_amount of 100_000_000 (100 USDC stroops),
    // the circuit encodes delta_stroops = BN254_PRIME - 100_000_000.
    // The contract must recover 100_000_000.
    let repay: i128 = 100_000_000;

    // Compute BN254_PRIME - repay: what the circuit encodes for delta_stroops.
    let repay_field = be32_sub(&BN254_PRIME, &{
        let mut b = [0u8; 32];
        b[16..32].copy_from_slice(&repay.to_be_bytes());
        b
    });

    // Invert: prime - (prime - repay) must recover the original repay amount.
    let recovered = be32_sub(&BN254_PRIME, &repay_field);
    assert_eq!(i128_from_be32_low(&recovered), Some(repay));
}

#[test]
fn be32_sub_zero_minus_zero_is_zero() {
    let zero = [0u8; 32];
    assert_eq!(be32_sub(&zero, &zero), [0u8; 32]);
}

#[test]
fn be32_sub_prime_minus_one_is_prime_minus_one() {
    let mut one = [0u8; 32];
    one[31] = 1;
    let result = be32_sub(&BN254_PRIME, &one);
    // Last byte should be 0x00 (prime ends in ...01, minus 1 = ...00)
    assert_eq!(result[31], 0x00);
    // Second-to-last should be unchanged
    assert_eq!(result[30], 0x00);
    // The upper bytes remain the same as prime except the last
    assert_eq!(&result[0..30], &BN254_PRIME[0..30]);
}

#[test]
fn i128_from_be32_low_rejects_high_bytes_set() {
    let mut arr = [0u8; 32];
    arr[15] = 1; // byte index 15 is in the high 16 bytes
    assert_eq!(i128_from_be32_low(&arr), None);
}

#[test]
fn i128_from_be32_low_accepts_max_i128() {
    let mut arr = [0u8; 32];
    arr[16..32].copy_from_slice(&i128::MAX.to_be_bytes());
    assert_eq!(i128_from_be32_low(&arr), Some(i128::MAX));
}

// ── Client-level integration: deposit / borrow / repay / liquidate ─────────────
//
// Before this section existed, `deposit`/`borrow`/`repay`/`liquidate` - the
// four ZK-gated state transitions that are this contract's actual purpose -
// had zero test coverage. Everything below exercises them with real Groth16
// proofs (`circuits/scripts/gen_commitment_tree_test_vectors.js`) verified
// through a real deployed `zk-verifier` instance, not a mock verifier.
//
// A note on `liquidate`'s test: this contract has no interest-accrual
// mechanism for ZK positions (unlike `private-lend`, which accrues interest
// over ledger time - see its `liquidation_of_undercollateralized_position`
// test), and `borrow`'s circuit enforces >=150% collateralization at the
// moment of borrowing. With a fixed oracle price (the Phase 1 stub), there is
// currently no legitimate on-chain sequence of calls that reaches an
// undercollateralized ZK position - liquidation only becomes reachable once
// either real accrual or a real (movable) oracle price exists. The
// liquidation test below writes the Merkle root directly via
// `env.as_contract` to construct that precondition, so it tests `liquidate`'s
// own logic (proof verification, threshold enforcement, nullifier spend, USDC
// transfer) in isolation from that separate, real gap.

fn zk_g1(env: &Env, bytes: &[u8; 64]) -> zk_verifier::G1Point {
    zk_verifier::G1Point { bytes: BytesN::from_array(env, bytes) }
}
fn zk_g2(env: &Env, bytes: &[u8; 128]) -> zk_verifier::G2Point {
    zk_verifier::G2Point { bytes: BytesN::from_array(env, bytes) }
}
fn ct_g1(env: &Env, bytes: &[u8; 64]) -> G1Point {
    G1Point { bytes: BytesN::from_array(env, bytes) }
}
fn ct_g2(env: &Env, bytes: &[u8; 128]) -> G2Point {
    G2Point { bytes: BytesN::from_array(env, bytes) }
}
fn sig32(env: &Env, bytes: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, bytes)
}

#[contract]
struct MockSpv;

#[contractimpl]
impl MockSpv {
    pub fn verify_transaction(
        env: Env,
        _headers: Vec<BytesN<80>>,
        _merkle_proof: Vec<BytesN<32>>,
        _tx_index: u32,
        _raw_tx: Bytes,
        _min_confirmations: u32,
    ) -> SpvVerificationResult {
        SpvVerificationResult {
            txid: BytesN::from_array(&env, &iv::DEPOSIT_TXID),
            block_hash: BytesN::from_array(&env, &[0xadu8; 32]),
            confirmations: 6,
        }
    }
}

struct IntegrationSetup {
    env: Env,
    admin: Address,
    depositor: Address,
    supplier: Address,
    usdc: Address,
    contract_id: Address,
    client: CommitmentTreeContractClient<'static>,
}

fn setup_integration() -> IntegrationSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let supplier = Address::generate(&env);
    let spv = env.register(MockSpv, ());
    let oracle = Address::generate(&env); // ignored by the Phase 1 oracle stub

    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = usdc_id.address();

    let zk_id = env.register(zk_verifier::ZkVerifierContract, ());
    let zk_client = zk_verifier::ZkVerifierContractClient::new(&env, &zk_id);
    zk_client.initialize(&admin);

    let deposit_ic: Vec<zk_verifier::G1Point> = Vec::from_array(&env, [
        zk_g1(&env, &iv::DEPOSIT_IC_0), zk_g1(&env, &iv::DEPOSIT_IC_1),
        zk_g1(&env, &iv::DEPOSIT_IC_2), zk_g1(&env, &iv::DEPOSIT_IC_3),
        zk_g1(&env, &iv::DEPOSIT_IC_4), zk_g1(&env, &iv::DEPOSIT_IC_5),
    ]);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::Deposit, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::DEPOSIT_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::DEPOSIT_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::DEPOSIT_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::DEPOSIT_VK_DELTA_G2),
        ic: deposit_ic,
    });

    let br_ic: Vec<zk_verifier::G1Point> = Vec::from_array(&env, [
        zk_g1(&env, &iv::BORROW_REPAY_IC_0), zk_g1(&env, &iv::BORROW_REPAY_IC_1),
        zk_g1(&env, &iv::BORROW_REPAY_IC_2), zk_g1(&env, &iv::BORROW_REPAY_IC_3),
        zk_g1(&env, &iv::BORROW_REPAY_IC_4), zk_g1(&env, &iv::BORROW_REPAY_IC_5),
        zk_g1(&env, &iv::BORROW_REPAY_IC_6), zk_g1(&env, &iv::BORROW_REPAY_IC_7),
        zk_g1(&env, &iv::BORROW_REPAY_IC_8),
    ]);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::BorrowRepay, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::BORROW_REPAY_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::BORROW_REPAY_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::BORROW_REPAY_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::BORROW_REPAY_VK_DELTA_G2),
        ic: br_ic,
    });

    let liq_ic: Vec<zk_verifier::G1Point> = Vec::from_array(&env, [
        zk_g1(&env, &iv::LIQUIDATION_IC_0), zk_g1(&env, &iv::LIQUIDATION_IC_1),
        zk_g1(&env, &iv::LIQUIDATION_IC_2), zk_g1(&env, &iv::LIQUIDATION_IC_3),
        zk_g1(&env, &iv::LIQUIDATION_IC_4), zk_g1(&env, &iv::LIQUIDATION_IC_5),
    ]);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::Liquidation, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::LIQUIDATION_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::LIQUIDATION_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::LIQUIDATION_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::LIQUIDATION_VK_DELTA_G2),
        ic: liq_ic,
    });

    let ct_id = env.register(CommitmentTreeContract, ());
    let client = CommitmentTreeContractClient::new(&env, &ct_id);
    // min_confirmations=6, matching the fixed 6-confirmation policy elsewhere.
    client.initialize(&admin, &spv, &zk_id, &usdc, &oracle, &6);

    IntegrationSetup { env, admin, depositor, supplier, usdc, contract_id: ct_id, client }
}

fn deposit_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::DEPOSIT_PI_A),
        pi_b: ct_g2(env, &iv::DEPOSIT_PI_B),
        pi_c: ct_g1(env, &iv::DEPOSIT_PI_C),
    }
}
fn deposit_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        sig32(env, &iv::DEPOSIT_SIGNAL_0), sig32(env, &iv::DEPOSIT_SIGNAL_1),
        sig32(env, &iv::DEPOSIT_SIGNAL_2), sig32(env, &iv::DEPOSIT_SIGNAL_3),
        sig32(env, &iv::DEPOSIT_SIGNAL_4),
    ])
}
fn borrow_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::BORROW_PI_A),
        pi_b: ct_g2(env, &iv::BORROW_PI_B),
        pi_c: ct_g1(env, &iv::BORROW_PI_C),
    }
}
fn borrow_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        sig32(env, &iv::BORROW_SIGNAL_0), sig32(env, &iv::BORROW_SIGNAL_1),
        sig32(env, &iv::BORROW_SIGNAL_2), sig32(env, &iv::BORROW_SIGNAL_3),
        sig32(env, &iv::BORROW_SIGNAL_4), sig32(env, &iv::BORROW_SIGNAL_5),
        sig32(env, &iv::BORROW_SIGNAL_6), sig32(env, &iv::BORROW_SIGNAL_7),
    ])
}
fn repay_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::REPAY_PI_A),
        pi_b: ct_g2(env, &iv::REPAY_PI_B),
        pi_c: ct_g1(env, &iv::REPAY_PI_C),
    }
}
fn repay_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        sig32(env, &iv::REPAY_SIGNAL_0), sig32(env, &iv::REPAY_SIGNAL_1),
        sig32(env, &iv::REPAY_SIGNAL_2), sig32(env, &iv::REPAY_SIGNAL_3),
        sig32(env, &iv::REPAY_SIGNAL_4), sig32(env, &iv::REPAY_SIGNAL_5),
        sig32(env, &iv::REPAY_SIGNAL_6), sig32(env, &iv::REPAY_SIGNAL_7),
    ])
}
fn liquidate_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::LIQUIDATE_PI_A),
        pi_b: ct_g2(env, &iv::LIQUIDATE_PI_B),
        pi_c: ct_g1(env, &iv::LIQUIDATE_PI_C),
    }
}
fn liquidate_signals(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        sig32(env, &iv::LIQUIDATE_SIGNAL_0), sig32(env, &iv::LIQUIDATE_SIGNAL_1),
        sig32(env, &iv::LIQUIDATE_SIGNAL_2), sig32(env, &iv::LIQUIDATE_SIGNAL_3),
        sig32(env, &iv::LIQUIDATE_SIGNAL_4),
    ])
}

#[test]
fn full_deposit_borrow_repay_cycle() {
    let s = setup_integration();
    let empty_headers: Vec<BytesN<80>> = Vec::new(&s.env);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);

    // Fund the pool so `borrow` below has liquidity to draw from.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);

    // ── Deposit ──
    let commitment = s.client.deposit(
        &s.depositor,
        &empty_headers,
        &empty_proof,
        &0u32,
        &empty_bytes,
        &deposit_proof(&s.env),
        &deposit_signals(&s.env),
        &empty_bytes,
    );
    assert_eq!(commitment, sig32(&s.env, &iv::DEPOSIT_SIGNAL_0));
    assert!(s.client.is_commitment_pending(&commitment));

    // ── Admin inserts the pending commitment (Phase 1 trusted relayer) ──
    // BORROW_SIGNAL_3 is the borrow proof's `old_root` - i.e. exactly the
    // root of the single-leaf tree containing this deposit's commitment.
    let root_after_deposit = sig32(&s.env, &iv::BORROW_SIGNAL_3);
    s.client.insert_commitment(&s.admin, &commitment, &root_after_deposit);
    assert_eq!(s.client.get_merkle_root(), root_after_deposit);
    assert!(!s.client.is_commitment_pending(&commitment));

    // ── Borrow ──
    s.client.borrow(&s.depositor, &borrow_proof(&s.env), &borrow_signals(&s.env), &empty_bytes);
    let root_after_borrow = sig32(&s.env, &iv::BORROW_SIGNAL_0);
    assert_eq!(s.client.get_merkle_root(), root_after_borrow);
    let (_, total_borrowed) = s.client.get_pool_state();
    assert_eq!(total_borrowed, 2_000_000_000_i128);
    let usdc_client = soroban_sdk::token::Client::new(&s.env, &s.usdc);
    assert_eq!(usdc_client.balance(&s.depositor), 2_000_000_000_i128);

    // ── Repay (full) ── the depositor already holds exactly the borrowed
    // amount from the step above, which is exactly what full repayment costs.
    s.client.repay(&s.depositor, &repay_proof(&s.env), &repay_signals(&s.env), &empty_bytes);
    let root_after_repay = sig32(&s.env, &iv::REPAY_SIGNAL_0);
    assert_eq!(s.client.get_merkle_root(), root_after_repay);
    let (_, total_borrowed_after_repay) = s.client.get_pool_state();
    assert_eq!(total_borrowed_after_repay, 0);
    assert_eq!(usdc_client.balance(&s.depositor), 0);
}

#[test]
#[should_panic]
fn borrow_with_tampered_signal_panics() {
    // Sanity check the negative direction too: a bit-flipped public signal
    // must not verify, even against a correctly-set-up chain.
    let s = setup_integration();
    let empty_headers: Vec<BytesN<80>> = Vec::new(&s.env);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);

    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);

    let commitment = s.client.deposit(
        &s.depositor, &empty_headers, &empty_proof, &0u32, &empty_bytes,
        &deposit_proof(&s.env), &deposit_signals(&s.env), &empty_bytes,
    );
    let root_after_deposit = sig32(&s.env, &iv::BORROW_SIGNAL_3);
    s.client.insert_commitment(&s.admin, &commitment, &root_after_deposit);

    let mut tampered_signals = borrow_signals(&s.env);
    let mut bad_delta = iv::BORROW_SIGNAL_4;
    bad_delta[31] ^= 0x01;
    tampered_signals.set(4, sig32(&s.env, &bad_delta));

    s.client.borrow(&s.depositor, &borrow_proof(&s.env), &tampered_signals, &empty_bytes);
}

#[test]
fn liquidate_undercollateralized_position() {
    // See the section-level comment above for why this writes the Merkle
    // root directly rather than reaching it through deposit+borrow: with a
    // fixed oracle price and no accrual, there is no legitimate on-chain
    // sequence of calls that produces an undercollateralized ZK position
    // today. This isolates `liquidate`'s own logic from that separate gap.
    let s = setup_integration();
    let keeper = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&keeper, &10_000_000_000_i128);

    let liq_root = sig32(&s.env, &iv::LIQUIDATE_SIGNAL_2); // merkle_root public input
    s.env.as_contract(&s.contract_id, || {
        s.env.storage().persistent().set(&DataKey::MerkleRoot, &liq_root);
    });

    s.client.liquidate(&keeper, &liquidate_proof(&s.env), &liquidate_signals(&s.env));

    let nullifier = sig32(&s.env, &iv::LIQUIDATE_SIGNAL_0);
    assert!(s.client.is_nullifier_spent(&nullifier));
}
