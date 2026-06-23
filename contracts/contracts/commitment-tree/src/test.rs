#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use crate::{
    CommitmentTreeContract, CommitmentTreeContractClient, BN254_PRIME, EMPTY_TREE_ROOT,
    be32_sub, i128_from_be32_low, sig_i128, sig_u32, sig_u64,
};

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
    // Set a non-zero high byte — value overflows i128.
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
