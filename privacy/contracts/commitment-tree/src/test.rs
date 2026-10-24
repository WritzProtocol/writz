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
    env.mock_all_auths();
    let admin  = Address::generate(env);
    let spv    = Address::generate(env);
    let zk     = Address::generate(env);
    let usdc   = Address::generate(env);
    let oracle = Address::generate(env);
    let id = env.register(CommitmentTreeContract, (admin.clone(), spv.clone(), zk.clone(), usdc.clone(), oracle.clone(), 6u32, protocol_pubkey(env), keeper_x(env), keeper_y(env)));
    let client = CommitmentTreeContractClient::new(env, &id);
    (client, admin, spv, zk, usdc, oracle)
}

/// The keeper key the fixture proofs encrypt their notes to (#212).
fn keeper_x(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &iv::KEEPER_PUB_X)
}
fn keeper_y(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &iv::KEEPER_PUB_Y)
}

/// The protocol co-signing key every test contract is constructed with.
fn protocol_pubkey(env: &Env) -> BytesN<33> {
    let mut k = [0x11u8; 33];
    k[0] = 0x02;
    BytesN::from_array(env, &k)
}

/// The depositor's Bitcoin key used by every test deposit.
fn user_pubkey(env: &Env) -> BytesN<33> {
    pubkey_of(env, &user_signing_key())
}

fn user_signing_key() -> k256::ecdsa::SigningKey {
    k256::ecdsa::SigningKey::from_slice(&[0x42u8; 32]).unwrap()
}

/// A second, real Bitcoin key: someone other than the depositor.
fn other_signing_key() -> k256::ecdsa::SigningKey {
    k256::ecdsa::SigningKey::from_slice(&[0x77u8; 32]).unwrap()
}

fn pubkey_of(env: &Env, key: &k256::ecdsa::SigningKey) -> BytesN<33> {
    let point = key.verifying_key().to_encoded_point(true);
    let mut out = [0u8; 33];
    out.copy_from_slice(point.as_bytes());
    BytesN::from_array(env, &out)
}

/// A BIP-137 signature by `key` over the deposit message, as a wallet makes it
/// (GHSA-862g-739q-x6h8).
fn sign_with(env: &Env, key: &k256::ecdsa::SigningKey, contract: &Address, depositor: &Address, txid: &BytesN<32>) -> BytesN<65> {
    let msg = spv_types::key_proof::deposit_message(env, contract, depositor, txid);
    let digest = spv_types::key_proof::signed_message_digest(env, &msg).to_array();
    let (sig, recid) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut out = [0u8; 65];
    out[0] = 31 + recid.to_byte();
    out[1..].copy_from_slice(&sig.to_bytes());
    BytesN::from_array(env, &out)
}

/// A timelock inside the allowed window above `MockSpv`'s confirming block
/// (2,900,000 + 1,008 ..= 2,900,000 + 105,000).
const TIMELOCK: u32 = iv::TIMELOCK;

/// The Writz P2WSH scriptPubKey a valid test deposit pays.
fn deposit_spk(env: &Env) -> Bytes {
    spv_types::script::p2wsh_script_pubkey(env, &protocol_pubkey(env), &user_pubkey(env), TIMELOCK)
}

/// Builds a minimal legacy Bitcoin transaction with a single output paying
/// `value_sat` to `spk`. Mirrors `writz-lend`'s own `build_deposit_tx`.
fn build_deposit_tx(env: &Env, value_sat: u64, spk: &Bytes) -> Bytes {
    let mut spk_bytes = std::vec![0u8; spk.len() as usize];
    spk.copy_into_slice(&mut spk_bytes);
    let mut tx = std::vec::Vec::new();
    tx.extend_from_slice(&1u32.to_le_bytes()); // version
    tx.push(0x01); // 1 input
    tx.extend_from_slice(&[0u8; 32]); // prev hash
    tx.extend_from_slice(&0xffff_ffffu32.to_le_bytes()); // prev index
    tx.push(0x00); // empty scriptSig
    tx.extend_from_slice(&0xffff_fffeu32.to_le_bytes()); // sequence
    tx.push(0x01); // 1 output
    tx.extend_from_slice(&value_sat.to_le_bytes());
    tx.push(spk_bytes.len() as u8); // scriptPubKey len
    tx.extend_from_slice(&spk_bytes);
    tx.extend_from_slice(&0u32.to_le_bytes()); // locktime
    Bytes::from_slice(env, &tx)
}

/// A syntactically valid proof for calls that must fail before verification.
fn dummy_proof(env: &Env) -> Proof {
    Proof {
        pi_a: G1Point { bytes: BytesN::from_array(env, &[0u8; 64]) },
        pi_b: G2Point { bytes: BytesN::from_array(env, &[0u8; 128]) },
        pi_c: G1Point { bytes: BytesN::from_array(env, &[0u8; 64]) },
    }
}

/// Insert-circuit public signals [new_root, old_root, commitment, leaf_index]
/// with the empty-tree root as old_root.
fn insert_signals_for(env: &Env, commitment: &BytesN<32>, leaf_index: u32) -> Vec<BytesN<32>> {
    Vec::from_array(env, [
        zero32(env), empty_root(env), commitment.clone(), from_u32(env, leaf_index),
    ])
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_empty_tree_root() {
    let env = Env::default();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    assert_eq!(client.get_merkle_root(), empty_root(&env));
}

// ── View functions ────────────────────────────────────────────────────────────

#[test]
fn nullifier_not_spent_initially() {
    let env = Env::default();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    assert!(!client.is_nullifier_spent(&zero32(&env)));
}

#[test]
fn commitment_not_pending_initially() {
    let env = Env::default();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    assert!(!client.is_commitment_pending(&zero32(&env)));
}

#[test]
fn get_commitment_returns_none_before_deposit() {
    let env = Env::default();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    assert_eq!(client.get_commitment(&zero32(&env)), None);
}

#[test]
fn pool_state_starts_at_zero() {
    let env = Env::default();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    assert_eq!(client.get_pool_state(), (0_i128, 0_i128));
}

// ── insert_commitment auth ────────────────────────────────────────────────────

#[test]
#[should_panic]
fn insert_commitment_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let non_admin = Address::generate(&env);
    client.insert_commitment(&non_admin, &dummy_proof(&env), &insert_signals_for(&env, &zero32(&env), 0));
}

// ── Config setters (admin only) ───────────────────────────────────────────────

#[test]
fn set_oracle_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _spv, _zk, _usdc, _oracle) = setup(&env);
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
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let non_admin = Address::generate(&env);
    client.set_oracle(&non_admin, &non_admin);
}

#[test]
fn set_spv_contract_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let new_spv = Address::generate(&env);
    client.set_spv_contract(&admin, &new_spv);
}

#[test]
#[should_panic]
fn set_spv_contract_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let non_admin = Address::generate(&env);
    client.set_spv_contract(&non_admin, &non_admin);
}

#[test]
fn set_zk_verifier_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let new_zk = Address::generate(&env);
    client.set_zk_verifier(&admin, &new_zk);
}

#[test]
#[should_panic]
fn set_zk_verifier_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let non_admin = Address::generate(&env);
    client.set_zk_verifier(&non_admin, &non_admin);
}

// ── paused / supply_usdc / withdraw_supply ────────────────────────────────────
//
// `setup()` above uses a fake `usdc` address (no real token contract behind
// it) since none of the tests it originally supported call `supply_usdc`/
// `withdraw_supply`. Those two functions need a real SEP-41 token to
// transfer, so this section deploys its own Stellar Asset Contract instead
// of reusing `setup()`, mirroring the pattern in `writz-lend/src/test.rs`.

fn setup_with_real_usdc(
    env: &Env,
) -> (CommitmentTreeContractClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let spv = Address::generate(env);
    let zk = Address::generate(env);
    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = usdc_id.address();
    let oracle = Address::generate(env);
    let id = env.register(CommitmentTreeContract, (admin.clone(), spv.clone(), zk.clone(), usdc.clone(), oracle.clone(), 6u32, protocol_pubkey(env), keeper_x(env), keeper_y(env)));
    let client = CommitmentTreeContractClient::new(env, &id);

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
    let (client, admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    client.insert_commitment(&admin, &dummy_proof(&env), &insert_signals_for(&env, &zero32(&env), 0));
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
// proofs (`privacy/circuits/scripts/gen_commitment_tree_test_vectors.js`) verified
// through a real deployed `zk-verifier` instance, not a mock verifier.
//
// A note on `liquidate`'s test: this contract has no interest-accrual
// mechanism for ZK positions (unlike `writz-lend`, which accrues interest
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
fn ic_of(env: &Env, all: &[[u8; 64]]) -> Vec<zk_verifier::G1Point> {
    let mut v = Vec::new(env);
    for p in all {
        v.push_back(zk_g1(env, p));
    }
    v
}
fn signals_of(env: &Env, all: &[[u8; 32]]) -> Vec<BytesN<32>> {
    let mut v = Vec::new(env);
    for s in all {
        v.push_back(sig32(env, s));
    }
    v
}

#[contract]
struct MockSpv;

#[contractimpl]
impl MockSpv {
    pub fn verify_transaction(
        env: Env,
        _block_hash: BytesN<32>,
        _merkle_proof: Vec<BytesN<32>>,
        _tx_index: u32,
        _raw_tx: Bytes,
        _min_confirmations: u32,
    ) -> SpvVerificationResult {
        SpvVerificationResult {
            txid: BytesN::from_array(&env, &iv::DEPOSIT_TXID),
            block_hash: BytesN::from_array(&env, &[0xadu8; 32]),
            block_height: 2_900_000,
            confirmations: 6,
        }
    }

    /// The shared txid registry is exercised in bitcoin-spv's own tests; this
    /// mock only needs to accept the call so deposit reaches its own checks.
    pub fn consume_deposit(_env: Env, _consumer: Address, _txid: BytesN<32>) {}

    /// Tip for the borrow timelock check (#212). Defaults to the height that
    /// leaves exactly the default 4,320-block margin under the fixture
    /// borrow's `min_timelock_height`, stamped "now".
    pub fn set_tip(env: Env, height: u32, time: u32) {
        env.storage().instance().set(&soroban_sdk::symbol_short!("tip"), &(height, time));
    }

    pub fn get_best_tip(env: Env) -> Option<spv_types::BestTip> {
        let (height, _) = Self::tip(&env);
        Some(spv_types::BestTip {
            hash: BytesN::from_array(&env, &[0xbeu8; 32]),
            height,
            chainwork: soroban_sdk::U256::from_u32(&env, 0),
        })
    }

    pub fn get_header(env: Env, _block_hash: BytesN<32>) -> Option<spv_types::HeaderEntry> {
        let (height, time) = Self::tip(&env);
        Some(spv_types::HeaderEntry {
            prev: BytesN::from_array(&env, &[0u8; 32]),
            merkle_root: BytesN::from_array(&env, &[0u8; 32]),
            height,
            bits: 0,
            time,
            period_start_time: 0,
            chainwork: soroban_sdk::U256::from_u32(&env, 0),
        })
    }
}

impl MockSpv {
    fn tip(env: &Env) -> (u32, u32) {
        env.storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("tip"))
            .unwrap_or((iv::MIN_TIMELOCK - 4_320, env.ledger().timestamp() as u32))
    }
}

struct IntegrationSetup {
    env: Env,
    admin: Address,
    spv: Address,
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

    let zk_id = env.register(zk_verifier::ZkVerifierContract, (admin.clone(),));
    let zk_client = zk_verifier::ZkVerifierContractClient::new(&env, &zk_id);

    let deposit_ic: Vec<zk_verifier::G1Point> = ic_of(&env, &iv::DEPOSIT_IC);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::Deposit, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::DEPOSIT_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::DEPOSIT_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::DEPOSIT_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::DEPOSIT_VK_DELTA_G2),
        ic: deposit_ic,
    });

    let br_ic: Vec<zk_verifier::G1Point> = ic_of(&env, &iv::BORROW_REPAY_IC);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::BorrowRepay, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::BORROW_REPAY_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::BORROW_REPAY_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::BORROW_REPAY_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::BORROW_REPAY_VK_DELTA_G2),
        ic: br_ic,
    });

    let liq_ic: Vec<zk_verifier::G1Point> = ic_of(&env, &iv::LIQUIDATION_IC);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::Liquidation, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::LIQUIDATION_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::LIQUIDATION_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::LIQUIDATION_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::LIQUIDATION_VK_DELTA_G2),
        ic: liq_ic,
    });

    let zd_ic: Vec<zk_verifier::G1Point> = ic_of(&env, &iv::ZERO_DEBT_IC);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::ZeroDebt, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::ZERO_DEBT_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::ZERO_DEBT_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::ZERO_DEBT_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::ZERO_DEBT_VK_DELTA_G2),
        ic: zd_ic,
    });

    let ins_ic: Vec<zk_verifier::G1Point> = ic_of(&env, &iv::INSERT_IC);
    zk_client.set_verification_key(&admin, &zk_verifier::CircuitId::Insert, &zk_verifier::VerificationKey {
        alpha_g1: zk_g1(&env, &iv::INSERT_VK_ALPHA_G1),
        beta_g2:  zk_g2(&env, &iv::INSERT_VK_BETA_G2),
        gamma_g2: zk_g2(&env, &iv::INSERT_VK_GAMMA_G2),
        delta_g2: zk_g2(&env, &iv::INSERT_VK_DELTA_G2),
        ic: ins_ic,
    });

    let ct_id = env.register(CommitmentTreeContract, (admin.clone(), spv.clone(), zk_id.clone(), usdc.clone(), oracle.clone(), 6u32, protocol_pubkey(&env), keeper_x(&env), keeper_y(&env)));
    let client = CommitmentTreeContractClient::new(&env, &ct_id);
    // min_confirmations=6, matching the fixed 6-confirmation policy elsewhere.

    IntegrationSetup { env, admin, spv, depositor, supplier, usdc, contract_id: ct_id, client }
}

fn deposit_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::DEPOSIT_PI_A),
        pi_b: ct_g2(env, &iv::DEPOSIT_PI_B),
        pi_c: ct_g1(env, &iv::DEPOSIT_PI_C),
    }
}
fn deposit_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::DEPOSIT_SIGNALS)
}
fn insert_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::INSERT_PI_A),
        pi_b: ct_g2(env, &iv::INSERT_PI_B),
        pi_c: ct_g1(env, &iv::INSERT_PI_C),
    }
}
/// [new_root, old_root, commitment, leaf_index]: the deposit commitment into
/// leaf 0 of the empty tree. new_root equals BORROW_SIGNAL_8, the borrow
/// proof's old_root.
fn insert_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::INSERT_SIGNALS)
}
fn borrow_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::BORROW_PI_A),
        pi_b: ct_g2(env, &iv::BORROW_PI_B),
        pi_c: ct_g1(env, &iv::BORROW_PI_C),
    }
}
fn borrow_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::BORROW_SIGNALS)
}

/// Must stay byte-identical to `RECIPIENT_STRKEY` in
/// privacy/circuits/scripts/gen_commitment_tree_test_vectors.js - the fixture
/// proof's recipient_lo/hi signals are sha256 of this exact string
/// (GHSA-xxqv-6vhx-hhrx, GHSA-mhp9-jmvc-x9mw).
const BORROW_RECIPIENT: &str = "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V";
fn borrow_recipient(env: &Env) -> Address {
    Address::from_string(&soroban_sdk::String::from_str(env, BORROW_RECIPIENT))
}
fn repay_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::REPAY_PI_A),
        pi_b: ct_g2(env, &iv::REPAY_PI_B),
        pi_c: ct_g1(env, &iv::REPAY_PI_C),
    }
}
fn repay_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::REPAY_SIGNALS)
}
fn zero_debt_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::ZERO_DEBT_PI_A),
        pi_b: ct_g2(env, &iv::ZERO_DEBT_PI_B),
        pi_c: ct_g1(env, &iv::ZERO_DEBT_PI_C),
    }
}
fn zero_debt_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::ZERO_DEBT_SIGNALS)
}
fn liquidate_proof(env: &Env) -> Proof {
    Proof {
        pi_a: ct_g1(env, &iv::LIQUIDATE_PI_A),
        pi_b: ct_g2(env, &iv::LIQUIDATE_PI_B),
        pi_c: ct_g1(env, &iv::LIQUIDATE_PI_C),
    }
}
fn liquidate_signals(env: &Env) -> Vec<BytesN<32>> {
    signals_of(env, &iv::LIQUIDATE_SIGNALS)
}

#[test]
fn full_deposit_borrow_repay_cycle() {
    let s = setup_integration();
    let block_hash = BytesN::<32>::from_array(&s.env, &[0xadu8; 32]);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);

    // Fund the pool so `borrow` below has liquidity to draw from.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);

    // ── Deposit ──
    // 1_000_000 sats matches gen_commitment_tree_test_vectors.js's COLLATERAL -
    // the proof's collateral_satoshis/actual_satoshis both commit to that
    // exact figure, so the real amount this raw_tx pays must equal it too.
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    let commitment = s.client.deposit(
        &s.depositor,
        &block_hash,
        &empty_proof,
        &0u32,
        &raw_tx,
        &user_pubkey(&s.env),
        &TIMELOCK,
        &key_sig(&s),
        &deposit_proof(&s.env),
        &deposit_signals(&s.env),
        &empty_bytes,
    );
    assert_eq!(commitment, sig32(&s.env, &iv::DEPOSIT_SIGNAL_0));
    assert!(s.client.is_commitment_pending(&commitment));

    // ── Admin inserts the pending commitment (Phase 1 trusted relayer) ──
    // BORROW_SIGNAL_8 is the borrow proof's `old_root` - i.e. exactly the
    // root of the single-leaf tree containing this deposit's commitment.
    let root_after_deposit = sig32(&s.env, &iv::BORROW_SIGNAL_8);
    assert_eq!(sig32(&s.env, &iv::INSERT_SIGNAL_2), commitment);
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));
    assert_eq!(s.client.get_merkle_root(), root_after_deposit);
    assert_eq!(s.client.get_next_leaf_index(), 1);
    assert!(!s.client.is_commitment_pending(&commitment));

    // ── Borrow ── the proof's recipient_lo/hi signals commit to
    // `borrow_recipient`, not `s.depositor` - the contract pays out to
    // whichever address it authenticates that matches that binding.
    let recipient = borrow_recipient(&s.env);
    s.client.borrow(&recipient, &borrow_proof(&s.env), &borrow_signals(&s.env), &empty_bytes);
    let root_after_borrow = sig32(&s.env, &iv::BORROW_SIGNAL_0);
    assert_eq!(s.client.get_merkle_root(), root_after_borrow);
    let (_, total_borrowed) = s.client.get_pool_state();
    assert_eq!(total_borrowed, 2_000_000_000_i128);
    let usdc_client = soroban_sdk::token::Client::new(&s.env, &s.usdc);
    assert_eq!(usdc_client.balance(&recipient), 2_000_000_000_i128);

    // ── Repay (full) ── `recipient` already holds exactly the borrowed
    // amount from the step above, which is exactly what full repayment
    // costs. `repay()` has no recipient binding, so any authenticated
    // address able to pay may do it.
    s.client.repay(&recipient, &repay_proof(&s.env), &repay_signals(&s.env), &empty_bytes);
    let root_after_repay = sig32(&s.env, &iv::REPAY_SIGNAL_0);
    assert_eq!(s.client.get_merkle_root(), root_after_repay);
    let (_, total_borrowed_after_repay) = s.client.get_pool_state();
    assert_eq!(total_borrowed_after_repay, 0);
    assert_eq!(usdc_client.balance(&recipient), 0);
}

#[test]
#[should_panic]
fn borrow_with_tampered_signal_panics() {
    // Sanity check the negative direction too: a bit-flipped public signal
    // must not verify, even against a correctly-set-up chain.
    let s = setup_integration();
    let block_hash = BytesN::<32>::from_array(&s.env, &[0xadu8; 32]);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);

    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);

    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    s.client.deposit(
        &s.depositor, &block_hash, &empty_proof, &0u32, &raw_tx,
        &user_pubkey(&s.env), &TIMELOCK, &key_sig(&s), &deposit_proof(&s.env), &deposit_signals(&s.env), &empty_bytes,
    );
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));

    let mut tampered_signals = borrow_signals(&s.env);
    let mut bad_delta = iv::BORROW_SIGNAL_9;
    bad_delta[31] ^= 0x01;
    tampered_signals.set(9, sig32(&s.env, &bad_delta));

    // Use the recipient the proof actually binds to, so this specifically
    // exercises the Groth16-rejects-tampering path rather than tripping the
    // separate recipient-mismatch check first.
    s.client.borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &tampered_signals, &empty_bytes);
}

#[test]
#[should_panic]
fn borrow_proof_cannot_be_redirected_to_another_recipient() {
    // PoC for GHSA-xxqv-6vhx-hhrx / GHSA-mhp9-jmvc-x9mw: a party who obtains
    // a pending borrow transaction's proof + public signals could, before
    // this fix, submit the identical proof/signals with a different
    // authenticated address and receive the payout instead - the contract
    // only checked `borrower.require_auth()`, never that the proof itself
    // committed to that address. `borrow_signals()` here embeds
    // `recipient_lo/hi = sha256(BORROW_RECIPIENT)`, so an attacker
    // authenticating as a *different* address must now be rejected with
    // `RecipientMismatch` before the transfer, Groth16 verification aside.
    let s = setup_integration();
    let block_hash = BytesN::<32>::from_array(&s.env, &[0xadu8; 32]);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);

    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);

    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    s.client.deposit(
        &s.depositor, &block_hash, &empty_proof, &0u32, &raw_tx,
        &user_pubkey(&s.env), &TIMELOCK, &key_sig(&s), &deposit_proof(&s.env), &deposit_signals(&s.env), &empty_bytes,
    );
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));

    // Attacker: a different address, not the one the proof's recipient_lo/hi
    // signals commit to. `mock_all_auths()` lets them "authenticate" as
    // themselves freely, exactly like a real attacker who only needs to sign
    // for their own account, not the victim's.
    let attacker = Address::generate(&s.env);
    s.client.borrow(&attacker, &borrow_proof(&s.env), &borrow_signals(&s.env), &empty_bytes);
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

/// GHSA-w4rp-v54x-2cv3 / GHSA-hcjf-8vjc-2hfv: a repaid position's zero-debt
/// leaf must not be borrowable once its BTC is released. The re-borrow proof
/// is valid against the current root, so only the released nullifier stops it.
#[test]
fn released_zero_debt_leaf_cannot_be_borrowed_again() {
    let s = setup_integration();
    let block_hash = BytesN::<32>::from_array(&s.env, &[0xadu8; 32]);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    let empty_bytes = Bytes::new(&s.env);
    let recipient = borrow_recipient(&s.env);

    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    s.client.deposit(
        &s.depositor, &block_hash, &empty_proof, &0u32, &raw_tx,
        &user_pubkey(&s.env), &TIMELOCK, &key_sig(&s), &deposit_proof(&s.env), &deposit_signals(&s.env), &empty_bytes,
    );
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));
    s.client.borrow(&recipient, &borrow_proof(&s.env), &borrow_signals(&s.env), &empty_bytes);
    s.client.repay(&recipient, &repay_proof(&s.env), &repay_signals(&s.env), &empty_bytes);

    let reborrow_proof = Proof {
        pi_a: ct_g1(&s.env, &iv::RELEASED_BORROW_PI_A),
        pi_b: ct_g2(&s.env, &iv::RELEASED_BORROW_PI_B),
        pi_c: ct_g1(&s.env, &iv::RELEASED_BORROW_PI_C),
    };
    let reborrow_signals = signals_of(&s.env, &iv::RELEASED_BORROW_SIGNALS);

    // Release first: it spends the zero-debt nullifier. The same borrow then fails.
    let zd_nullifier = sig32(&s.env, &iv::ZERO_DEBT_SIGNAL_1);
    assert!(!s.client.is_nullifier_spent(&zd_nullifier));
    s.client.mark_released(&zero_debt_proof(&s.env), &zero_debt_signals(&s.env));
    assert!(s.client.is_nullifier_spent(&zd_nullifier));
    assert_eq!(
        s.client.try_borrow(&recipient, &reborrow_proof, &reborrow_signals, &empty_bytes),
        Err(Ok(crate::error::CommitmentTreeError::NullifierAlreadySpent)),
    );
}

// ── Per-user deposit script (#177) ────────────────────────────────────────────
//
// A ZK deposit must pay the Writz P2WSH built from the protocol key, the
// depositor's key and a bounded timelock - the script the UI derives and
// /api/cosign co-signs. Each case below changes one input to that script.

fn try_deposit_with(
    s: &IntegrationSetup,
    raw_tx: &Bytes,
    user: &BytesN<33>,
    timelock: u32,
) -> Result<BytesN<32>, crate::error::CommitmentTreeError> {
    let block_hash = BytesN::<32>::from_array(&s.env, &[0xadu8; 32]);
    let empty_proof: Vec<BytesN<32>> = Vec::new(&s.env);
    match s.client.try_deposit(
        &s.depositor, &block_hash, &empty_proof, &0u32, raw_tx,
        user, &timelock, &key_sig_for(s, user), &deposit_proof(&s.env), &deposit_signals(&s.env),
        &Bytes::new(&s.env),
    ) {
        Ok(Ok(c)) => Ok(c),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn deposit_to_the_depositors_writz_script_succeeds() {
    let s = setup_integration();
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    let commitment = try_deposit_with(&s, &raw_tx, &user_pubkey(&s.env), TIMELOCK).unwrap();
    assert!(s.client.is_commitment_pending(&commitment));
}

#[test]
fn deposit_paying_a_script_the_protocol_cannot_cosign_is_rejected() {
    // The output is a Writz-shaped script, but under a different protocol
    // key: the depositor could spend it alone, so it is not collateral.
    let s = setup_integration();
    let mut other = [0x33u8; 33];
    other[0] = 0x02;
    let foreign_spk = spv_types::script::p2wsh_script_pubkey(
        &s.env, &BytesN::from_array(&s.env, &other), &user_pubkey(&s.env), TIMELOCK,
    );
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &foreign_spk);
    assert_eq!(
        try_deposit_with(&s, &raw_tx, &user_pubkey(&s.env), TIMELOCK),
        Err(crate::error::CommitmentTreeError::VaultOutputNotFound),
    );
}

#[test]
fn deposit_claiming_someone_elses_output_is_rejected() {
    // The transaction pays the depositor's Writz script, but the caller
    // names (and signs for) their own key - the rebuilt script does not
    // match the output, so a key they control cannot claim it.
    let s = setup_integration();
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    assert_eq!(
        try_deposit_with(&s, &raw_tx, &pubkey_of(&s.env, &other_signing_key()), TIMELOCK),
        Err(crate::error::CommitmentTreeError::VaultOutputNotFound),
    );
}

#[test]
fn deposit_with_a_timelock_outside_the_window_is_rejected() {
    let s = setup_integration();
    for timelock in [2_900_000 + 1_007, 2_900_000 + 105_001] {
        let spk = spv_types::script::p2wsh_script_pubkey(
            &s.env, &protocol_pubkey(&s.env), &user_pubkey(&s.env), timelock,
        );
        let raw_tx = build_deposit_tx(&s.env, 1_000_000, &spk);
        assert_eq!(
            try_deposit_with(&s, &raw_tx, &user_pubkey(&s.env), timelock),
            Err(crate::error::CommitmentTreeError::InvalidTimelock),
        );
    }
}

#[test]
fn deposit_with_an_uncompressed_user_key_is_rejected() {
    let s = setup_integration();
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    let mut bad = [0x22u8; 33];
    bad[0] = 0x04;
    assert_eq!(
        try_deposit_with(&s, &raw_tx, &BytesN::from_array(&s.env, &bad), TIMELOCK),
        Err(crate::error::CommitmentTreeError::InvalidPubkey),
    );
}

#[test]
#[should_panic]
fn constructor_rejects_an_uncompressed_protocol_key() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let mut bad = [0x11u8; 33];
    bad[0] = 0x04;
    env.register(CommitmentTreeContract, (
        admin.clone(), admin.clone(), admin.clone(), admin.clone(), admin,
        6u32, BytesN::<33>::from_array(&env, &bad), keeper_x(&env), keeper_y(&env),
    ));
}

// ── Proven Merkle insertion (#211, GHSA-prw2-j3jx-43qh) ───────────────────────
//
// The admin used to set any root it liked. Each case below is a root the
// admin could have installed before, and must now be refused.

fn deposited(s: &IntegrationSetup) -> BytesN<32> {
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    try_deposit_with(s, &raw_tx, &user_pubkey(&s.env), TIMELOCK).unwrap()
}

fn try_insert(
    s: &IntegrationSetup,
    signals: &Vec<BytesN<32>>,
) -> Result<(), crate::error::CommitmentTreeError> {
    match s.client.try_insert_commitment(&s.admin, &insert_proof(&s.env), signals) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn insertion_with_a_forged_new_root_is_rejected() {
    let s = setup_integration();
    deposited(&s);
    let mut forged = insert_signals(&s.env);
    let mut root = iv::INSERT_SIGNAL_0;
    root[31] ^= 0x01;
    forged.set(0, sig32(&s.env, &root));
    assert_eq!(try_insert(&s, &forged), Err(crate::error::CommitmentTreeError::InvalidZkProof));
    assert_eq!(s.client.get_merkle_root(), empty_root(&s.env));
    assert_eq!(s.client.get_next_leaf_index(), 0);
}

#[test]
fn insertion_into_a_slot_other_than_the_next_one_is_rejected() {
    let s = setup_integration();
    deposited(&s);
    let mut skipped = insert_signals(&s.env);
    skipped.set(3, from_u32(&s.env, 1));
    assert_eq!(try_insert(&s, &skipped), Err(crate::error::CommitmentTreeError::LeafIndexMismatch));
}

#[test]
fn an_insertion_proof_cannot_be_replayed() {
    let s = setup_integration();
    deposited(&s);
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));
    // The commitment is no longer pending, and the root has moved on.
    assert_eq!(
        try_insert(&s, &insert_signals(&s.env)),
        Err(crate::error::CommitmentTreeError::CommitmentNotFound),
    );
}

#[test]
fn insertion_of_a_commitment_that_was_never_deposited_is_rejected() {
    let s = setup_integration();
    assert_eq!(
        try_insert(&s, &insert_signals(&s.env)),
        Err(crate::error::CommitmentTreeError::CommitmentNotFound),
    );
}

#[test]
fn insertion_against_a_stale_root_is_rejected() {
    let s = setup_integration();
    deposited(&s);
    let root = sig32(&s.env, &iv::BORROW_SIGNAL_0);
    s.env.as_contract(&s.contract_id, || {
        s.env.storage().persistent().set(&DataKey::MerkleRoot, &root);
    });
    assert_eq!(try_insert(&s, &insert_signals(&s.env)), Err(crate::error::CommitmentTreeError::RootMismatch));
}

// ── Exposure cap (GHSA-5rxp, mirrored from writz-lend) ──────────────────────

#[test]
fn borrowing_past_the_exposure_cap_is_rejected() {
    let s = setup_integration();
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);
    deposited(&s);
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));

    // The fixture borrow is 200 USDC; cap the pool just below it.
    s.client.set_max_total_borrowed(&s.admin, &1_999_999_999_i128);
    assert_eq!(
        s.client.try_borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &borrow_signals(&s.env), &Bytes::new(&s.env)),
        Err(Ok(crate::error::CommitmentTreeError::ExposureCapExceeded)),
    );
    s.client.set_max_total_borrowed(&s.admin, &2_000_000_000_i128);
    s.client.borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &borrow_signals(&s.env), &Bytes::new(&s.env));
}

#[test]
#[should_panic]
fn set_max_total_borrowed_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _spv, _zk, _usdc, _oracle) = setup(&env);
    let rando = Address::generate(&env);
    client.set_max_total_borrowed(&rando, &0);
}

/// The deposit txid `MockSpv` reports.
fn mock_txid(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &iv::DEPOSIT_TXID)
}

fn key_sig(s: &IntegrationSetup) -> BytesN<65> {
    sign_with(&s.env, &user_signing_key(), &s.contract_id, &s.depositor, &mock_txid(&s.env))
}

/// Signed by whichever test key `user` belongs to, so each case proves
/// control of the key it names.
fn key_sig_for(s: &IntegrationSetup, user: &BytesN<33>) -> BytesN<65> {
    let key = if *user == pubkey_of(&s.env, &other_signing_key()) { other_signing_key() } else { user_signing_key() };
    sign_with(&s.env, &key, &s.contract_id, &s.depositor, &mock_txid(&s.env))
}

fn try_deposit_signed(s: &IntegrationSetup, sig: &BytesN<65>) -> Result<BytesN<32>, crate::error::CommitmentTreeError> {
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    match s.client.try_deposit(
        &s.depositor, &BytesN::from_array(&s.env, &[0xadu8; 32]), &Vec::new(&s.env), &0u32, &raw_tx,
        &user_pubkey(&s.env), &TIMELOCK, sig, &deposit_proof(&s.env), &deposit_signals(&s.env), &Bytes::new(&s.env),
    ) {
        Ok(Ok(c)) => Ok(c),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected result: {other:?}"),
    }
}

// ── Bitcoin key-control proof (GHSA-862g-739q-x6h8) ───────────────────────────

#[test]
fn a_deposit_without_the_depositors_bitcoin_key_is_rejected() {
    // Someone watching Bitcoin registers another user's Writz deposit: the
    // script and txid are public, but they cannot sign for the user's key.
    let s = setup_integration();
    let sig = sign_with(&s.env, &other_signing_key(), &s.contract_id, &s.depositor, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(crate::error::CommitmentTreeError::InvalidKeyProof));
}

#[test]
fn a_key_proof_replayed_by_another_account_is_rejected() {
    let s = setup_integration();
    let victim = Address::generate(&s.env);
    let sig = sign_with(&s.env, &user_signing_key(), &s.contract_id, &victim, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(crate::error::CommitmentTreeError::InvalidKeyProof));
}

#[test]
fn a_key_proof_made_for_the_other_lender_is_rejected() {
    let s = setup_integration();
    let other_contract = Address::generate(&s.env);
    let sig = sign_with(&s.env, &user_signing_key(), &other_contract, &s.depositor, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(crate::error::CommitmentTreeError::InvalidKeyProof));
}

#[test]
fn a_deposit_reusing_an_earlier_deposits_nullifier_is_rejected() {
    // GHSA-frj5-5wmv-wvm3: a second leaf sharing a nullifier could never be
    // spent. Simulate an earlier deposit having recorded this proof's
    // nullifier (MockSpv reuses one txid, so two real deposits would stop at
    // the txid registry first).
    let s = setup_integration();
    let nullifier = sig32(&s.env, &iv::DEPOSIT_SIGNAL_1);
    s.env.as_contract(&s.contract_id, || {
        s.env.storage().persistent().set(&DataKey::DepositNullifier(nullifier.clone()), &true);
    });
    assert_eq!(
        try_deposit_signed(&s, &key_sig(&s)),
        Err(crate::error::CommitmentTreeError::DuplicateNullifier),
    );
}

#[test]
fn a_successful_deposit_records_its_nullifier() {
    let s = setup_integration();
    try_deposit_signed(&s, &key_sig(&s)).unwrap();
    let nullifier = sig32(&s.env, &iv::DEPOSIT_SIGNAL_1);
    let recorded = s.env.as_contract(&s.contract_id, || {
        s.env.storage().persistent().has(&DataKey::DepositNullifier(nullifier.clone()))
    });
    assert!(recorded);
}

// ── Timelock margin and keeper note (#212) ────────────────────────────────────

/// Funded pool, the fixture deposit inserted: the borrow proof applies.
fn ready_to_borrow(s: &IntegrationSetup) {
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.supplier, &10_000_000_000_i128);
    s.client.supply_usdc(&s.supplier, &10_000_000_000_i128);
    deposited(s);
    s.client.insert_commitment(&s.admin, &insert_proof(&s.env), &insert_signals(&s.env));
}

fn try_fixture_borrow(s: &IntegrationSetup) -> Result<(), crate::error::CommitmentTreeError> {
    match s.client.try_borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &borrow_signals(&s.env), &Bytes::new(&s.env)) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected {other:?}"),
    }
}

fn mock_spv(s: &IntegrationSetup) -> MockSpvClient<'_> {
    MockSpvClient::new(&s.env, &s.spv)
}

#[test]
fn a_borrow_must_leave_the_margin_before_the_timelock() {
    let s = setup_integration();
    ready_to_borrow(&s);
    // One block later and the fixture's min_timelock_height no longer
    // clears tip + 4,320.
    let now = s.env.ledger().timestamp() as u32;
    mock_spv(&s).set_tip(&(iv::MIN_TIMELOCK - 4_320 + 1), &now);
    assert_eq!(try_fixture_borrow(&s), Err(crate::error::CommitmentTreeError::TimelockTooSoon));

    // A shorter admin-set margin lets the same proof through.
    s.client.set_borrow_timelock_margin(&s.admin, &4_319);
    assert_eq!(try_fixture_borrow(&s), Ok(()));
}

#[test]
fn a_borrow_refuses_a_stale_bitcoin_tip() {
    let s = setup_integration();
    ready_to_borrow(&s);
    // A tip that stopped six hours and one second ago would let a borrow
    // measure its margin from a height Bitcoin has long passed.
    { use soroban_sdk::testutils::Ledger as _; s.env.ledger().with_mut(|l| l.timestamp = 1_800_000_000); }
    mock_spv(&s).set_tip(&(iv::MIN_TIMELOCK - 4_320), &(1_800_000_000 - 6 * 3600 - 1));
    assert_eq!(try_fixture_borrow(&s), Err(crate::error::CommitmentTreeError::StaleBitcoinTip));

    mock_spv(&s).set_tip(&(iv::MIN_TIMELOCK - 4_320), &(1_800_000_000 - 6 * 3600));
    assert_eq!(try_fixture_borrow(&s), Ok(()));
}

#[test]
fn borrow_and_repay_require_the_configured_keeper_key() {
    let s = setup_integration();
    ready_to_borrow(&s);
    let mut other = iv::KEEPER_PUB_X;
    other[31] ^= 1;
    s.client.set_keeper_pubkey(&s.admin, &BytesN::from_array(&s.env, &other), &keeper_y(&s.env));
    assert_eq!(try_fixture_borrow(&s), Err(crate::error::CommitmentTreeError::KeeperKeyMismatch));

    s.client.set_keeper_pubkey(&s.admin, &keeper_x(&s.env), &keeper_y(&s.env));
    assert_eq!(try_fixture_borrow(&s), Ok(()));

    s.client.set_keeper_pubkey(&s.admin, &BytesN::from_array(&s.env, &other), &keeper_y(&s.env));
    assert_eq!(
        s.client.try_repay(&borrow_recipient(&s.env), &repay_proof(&s.env), &repay_signals(&s.env), &Bytes::new(&s.env)),
        Err(Ok(crate::error::CommitmentTreeError::KeeperKeyMismatch)),
    );
}

#[test]
fn a_repay_is_not_held_to_the_timelock_margin() {
    // A position past its margin (or its timelock) must still be able to repay.
    let s = setup_integration();
    ready_to_borrow(&s);
    s.client.borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &borrow_signals(&s.env), &Bytes::new(&s.env));
    let now = s.env.ledger().timestamp() as u32;
    mock_spv(&s).set_tip(&(TIMELOCK + 10), &now);
    s.client.repay(&borrow_recipient(&s.env), &repay_proof(&s.env), &repay_signals(&s.env), &Bytes::new(&s.env));
    assert_eq!(s.client.get_merkle_root(), sig32(&s.env, &iv::REPAY_SIGNAL_0));
}

#[test]
fn the_borrow_event_publishes_the_keeper_note() {
    use crate::events::BorrowEvent;
    use soroban_sdk::testutils::Events as _;
    use soroban_sdk::Event as _;

    let s = setup_integration();
    ready_to_borrow(&s);
    s.client.borrow(&borrow_recipient(&s.env), &borrow_proof(&s.env), &borrow_signals(&s.env), &Bytes::new(&s.env));
    let expected = BorrowEvent {
        new_root: sig32(&s.env, &iv::BORROW_SIGNAL_0),
        borrower: borrow_recipient(&s.env),
        usdc_amount: 2_000_000_000,
        old_nullifier: sig32(&s.env, &iv::BORROW_SIGNAL_1),
        new_commitment: sig32(&s.env, &iv::BORROW_SIGNAL_2),
        enc_note: Bytes::new(&s.env),
        keeper_note: signals_of(&s.env, &iv::BORROW_SIGNALS[3..8]),
    };
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract_id).events().last(),
        Some(&expected.to_xdr(&s.env, &s.contract_id)),
    );
}

#[test]
fn deposit_binds_the_timelock_signal_to_the_checked_script() {
    let s = setup_integration();
    let mut signals = deposit_signals(&s.env);
    signals.set(6, from_u32(&s.env, TIMELOCK + 1));
    let raw_tx = build_deposit_tx(&s.env, 1_000_000, &deposit_spk(&s.env));
    assert_eq!(
        s.client.try_deposit(
            &s.depositor, &BytesN::from_array(&s.env, &[0xadu8; 32]), &Vec::new(&s.env), &0u32, &raw_tx,
            &user_pubkey(&s.env), &TIMELOCK, &key_sig(&s), &deposit_proof(&s.env), &signals, &Bytes::new(&s.env),
        ),
        Err(Ok(crate::error::CommitmentTreeError::InvalidTimelock)),
    );
}

#[test]
fn keeper_and_margin_setters_are_bounded_and_admin_only() {
    let s = setup_integration();
    let zero = BytesN::from_array(&s.env, &[0u8; 32]);
    assert_eq!(
        s.client.try_set_keeper_pubkey(&s.admin, &zero, &keeper_y(&s.env)),
        Err(Ok(crate::error::CommitmentTreeError::InvalidParameter)),
    );
    assert_eq!(
        s.client.try_set_keeper_pubkey(&s.depositor, &keeper_x(&s.env), &keeper_y(&s.env)),
        Err(Ok(crate::error::CommitmentTreeError::Unauthorized)),
    );
    assert_eq!(
        s.client.try_set_borrow_timelock_margin(&s.admin, &143),
        Err(Ok(crate::error::CommitmentTreeError::InvalidParameter)),
    );
    assert_eq!(
        s.client.try_set_borrow_timelock_margin(&s.admin, &105_001),
        Err(Ok(crate::error::CommitmentTreeError::InvalidParameter)),
    );
    assert_eq!(
        s.client.try_set_max_tip_age(&s.admin, &(3600 - 1)),
        Err(Ok(crate::error::CommitmentTreeError::InvalidParameter)),
    );
    assert_eq!(
        s.client.try_set_max_tip_age(&s.admin, &(48 * 3600 + 1)),
        Err(Ok(crate::error::CommitmentTreeError::InvalidParameter)),
    );
    s.client.set_max_tip_age(&s.admin, &(12 * 3600));
}

#[test]
fn borrow_parameters_are_readable() {
    let s = setup_integration();
    assert_eq!(s.client.get_keeper_pubkey(), (keeper_x(&s.env), keeper_y(&s.env)));
    assert_eq!(s.client.get_borrow_timelock_margin(), 4_320);
}
