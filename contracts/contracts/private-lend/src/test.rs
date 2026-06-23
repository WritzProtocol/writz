#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env, Vec,
};

use crate::{
    types::{Position, PositionStatus, SpvResult},
    PrivateLendContract, PrivateLendContractClient,
};

// ── Mock SPV contract ─────────────────────────────────────────────────────────
// Returns the SHA256d of the raw_tx as the txid (mirroring the real contract),
// using a fixed fake value so tests don't need real Bitcoin transactions.

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
    ) -> SpvResult {
        SpvResult {
            txid: BytesN::from_array(&env, &[0xdeu8; 32]),
            block_hash: BytesN::from_array(&env, &[0xadu8; 32]),
            confirmations: 6,
        }
    }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

/// Builds a minimal legacy Bitcoin transaction with a single P2WSH output.
/// The P2WSH scriptPubKey is `0x00 0x20 [hash_byte; 32]`.
fn build_deposit_tx(value_sat: u64, hash_byte: u8) -> std::vec::Vec<u8> {
    let mut tx = std::vec::Vec::new();
    // version
    tx.extend_from_slice(&1u32.to_le_bytes());
    // 1 input
    tx.push(0x01);
    tx.extend_from_slice(&[0u8; 32]); // prev hash
    tx.extend_from_slice(&0xffff_ffffu32.to_le_bytes()); // prev index
    tx.push(0x00); // empty scriptSig
    tx.extend_from_slice(&0xffff_fffeu32.to_le_bytes()); // sequence
    // 1 output
    tx.push(0x01);
    tx.extend_from_slice(&value_sat.to_le_bytes());
    tx.push(0x22); // scriptPubKey len = 34
    tx.push(0x00); // OP_0
    tx.push(0x20); // PUSH32
    tx.extend_from_slice(&[hash_byte; 32]);
    // locktime
    tx.extend_from_slice(&0u32.to_le_bytes());
    tx
}

fn fake_p2wsh_spk(hash_byte: u8, env: &Env) -> Bytes {
    let mut spk = std::vec![0x00u8, 0x20];
    spk.extend_from_slice(&[hash_byte; 32]);
    Bytes::from_slice(env, &spk)
}

fn fake_headers(env: &Env) -> Vec<BytesN<80>> {
    let mut v = Vec::new(env);
    for _ in 0..6 {
        v.push_back(BytesN::from_array(env, &[0u8; 80]));
    }
    v
}

fn fake_proof(env: &Env) -> Vec<BytesN<32>> {
    Vec::new(env)
}

struct Setup {
    env: Env,
    admin: Address,
    supplier: Address,
    depositor: Address,
    keeper: Address,
    client: PrivateLendContractClient<'static>,
    usdc: Address,
    /// The 34-byte P2WSH scriptPubKey used in test deposit transactions.
    spk: Bytes,
    /// Raw transaction bytes matching `spk` with 500_000 sats deposited.
    raw_tx: Bytes,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(1_000);

    let admin = Address::generate(&env);
    let supplier = Address::generate(&env);
    let depositor = Address::generate(&env);
    let keeper = Address::generate(&env);

    // Deploy USDC stellar asset contract.
    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = usdc_id.address();
    let usdc_admin = StellarAssetClient::new(&env, &usdc);

    // Mint USDC for supplier and keeper.
    usdc_admin.mint(&supplier, &10_000_000_000_000_i128); // 1_000_000 USDC
    usdc_admin.mint(&keeper, &10_000_000_000_i128);       // 1_000 USDC

    // Deploy mock SPV.
    let spv = env.register(MockSpv, ());

    // Deploy PrivateLend.
    let pl = env.register(PrivateLendContract, ());
    let client = PrivateLendContractClient::new(&env, &pl);

    client.initialize(&admin, &spv, &usdc, &admin, &keeper);

    // Pre-build deposit transaction artifacts.
    let hash_byte = 0xabu8;
    let sat_amount = 500_000u64; // 0.005 BTC
    let raw_bytes = build_deposit_tx(sat_amount, hash_byte);
    let raw_tx = Bytes::from_slice(&env, &raw_bytes);
    let spk = fake_p2wsh_spk(hash_byte, &env);

    Setup {
        env,
        admin,
        supplier,
        depositor,
        keeper,
        client,
        usdc,
        spk,
        raw_tx,
    }
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_config() {
    let s = setup();
    let state = s.client.get_protocol_state();
    assert_eq!(state.total_supplied, 0);
    assert_eq!(state.total_borrowed, 0);
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let s = setup();
    let spv2 = Address::generate(&s.env);
    s.client
        .initialize(&s.admin, &spv2, &s.usdc, &s.admin, &s.keeper);
}

// ── deposit ───────────────────────────────────────────────────────────────────

fn do_deposit(s: &Setup) -> BytesN<32> {
    s.client.deposit(
        &s.depositor,
        &fake_headers(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &s.raw_tx,
        &s.spk,
        &2_905_328u32,
    )
}

#[test]
fn deposit_creates_active_position() {
    let s = setup();
    let txid = do_deposit(&s);
    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Active);
    assert_eq!(pos.btc_satoshis, 500_000);
    assert_eq!(pos.usdc_debt, 0);
    assert_eq!(pos.depositor, s.depositor);
}

#[test]
fn deposit_returns_the_txid_from_spv() {
    let s = setup();
    let txid = do_deposit(&s);
    // Mock SPV always returns [0xde; 32].
    assert_eq!(txid.to_array(), [0xdeu8; 32]);
}

#[test]
#[should_panic]
fn deposit_duplicate_txid_panics() {
    let s = setup();
    do_deposit(&s);
    do_deposit(&s); // same txid from mock SPV → should panic
}

#[test]
#[should_panic]
fn deposit_wrong_script_pubkey_panics() {
    let s = setup();
    let wrong_spk = fake_p2wsh_spk(0xffu8, &s.env); // doesn't match 0xab in raw_tx
    s.client.deposit(
        &s.depositor,
        &fake_headers(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &s.raw_tx,
        &wrong_spk,
        &2_905_328u32,
    );
}

#[test]
#[should_panic]
fn deposit_too_small_panics() {
    let s = setup();
    // Build a tx with only 1_000 satoshis (below 100_000 minimum).
    let raw_bytes = build_deposit_tx(1_000, 0xab);
    let raw_tx = Bytes::from_slice(&s.env, &raw_bytes);
    s.client.deposit(
        &s.depositor,
        &fake_headers(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &raw_tx,
        &s.spk,
        &2_905_328u32,
    );
}

// ── supply_usdc / withdraw_supply ─────────────────────────────────────────────

#[test]
fn supply_increases_pool_and_balance() {
    let s = setup();
    let amount = 1_000_000_000_i128; // 100 USDC
    s.client.supply_usdc(&s.supplier, &amount);
    let state = s.client.get_protocol_state();
    assert_eq!(state.total_supplied, amount);
    assert_eq!(s.client.get_supply_balance(&s.supplier), amount);
}

#[test]
fn withdraw_supply_decreases_pool_and_balance() {
    let s = setup();
    let amount = 2_000_000_000_i128;
    s.client.supply_usdc(&s.supplier, &amount);
    s.client.withdraw_supply(&s.supplier, &1_000_000_000);
    assert_eq!(s.client.get_supply_balance(&s.supplier), 1_000_000_000);
    assert_eq!(s.client.get_protocol_state().total_supplied, 1_000_000_000);
}

#[test]
#[should_panic]
fn withdraw_more_than_balance_panics() {
    let s = setup();
    s.client.supply_usdc(&s.supplier, &500_000_000_i128);
    s.client.withdraw_supply(&s.supplier, &600_000_000_i128);
}

// ── borrow ────────────────────────────────────────────────────────────────────

/// Deposits and supplies, then returns the txid.
fn setup_with_supply_and_deposit(s: &Setup, supply_usdc: i128) -> BytesN<32> {
    s.client.supply_usdc(&s.supplier, &supply_usdc);
    do_deposit(s)
}

#[test]
fn borrow_within_ratio_succeeds() {
    let s = setup();
    // BTC = 500_000 sats, price = $60_000 → collateral = $300 = 3_000_000_000 stroops
    // Max borrow at 150%: 3_000_000_000 * 10_000 / 15_000 = 2_000_000_000 stroops ($200)
    let supply = 10_000_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);

    let borrow_amount = 1_000_000_000_i128; // $100 USDC (well under $200 max)
    s.client.borrow(&s.depositor, &txid, &borrow_amount);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.usdc_debt, borrow_amount);
    assert_eq!(s.client.get_protocol_state().total_borrowed, borrow_amount);
}

#[test]
fn borrow_transfers_usdc_to_borrower() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    let borrow_amount = 500_000_000_i128;
    let token = TokenClient::new(&s.env, &s.usdc);
    let before = token.balance(&s.depositor);
    s.client.borrow(&s.depositor, &txid, &borrow_amount);
    let after = token.balance(&s.depositor);
    assert_eq!(after - before, borrow_amount);
}

#[test]
#[should_panic]
fn borrow_exceeding_collateral_ratio_panics() {
    let s = setup();
    // Max borrow for 500_000 sats at $60k = $200 USDC = 2_000_000_000 stroops.
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &2_000_000_001_i128); // $200 + 1 stroop over limit
}

#[test]
#[should_panic]
fn borrow_by_non_depositor_panics() {
    let s = setup();
    let other = Address::generate(&s.env);
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.borrow(&other, &txid, &100_000_000_i128);
}

#[test]
fn health_ratio_at_150_pct_after_max_borrow() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    // Borrow exactly at the limit.
    // collateral = 500_000 × 600_000_000_000 / 100_000_000 = 3_000_000_000
    // max_borrow = 3_000_000_000 × 10_000 / 15_000 = 2_000_000_000
    s.client.borrow(&s.depositor, &txid, &2_000_000_000_i128);
    let health = s.client.get_health_ratio_bp(&txid);
    assert_eq!(health, 15_000);
}

// ── repay ─────────────────────────────────────────────────────────────────────

#[test]
fn partial_repay_reduces_debt() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &1_000_000_000_i128);

    // Give depositor USDC to repay.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &1_000_000_000_i128);
    s.client.repay(&s.depositor, &txid, &400_000_000_i128);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.usdc_debt, 600_000_000);
    assert_eq!(pos.status, PositionStatus::Active);
}

#[test]
fn full_repay_closes_position() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    let debt = 1_000_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &debt);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &debt);
    s.client.repay(&s.depositor, &txid, &debt);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Closed);
    assert_eq!(pos.usdc_debt, 0);
}

#[test]
#[should_panic]
fn repay_more_than_debt_panics() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    let debt = 1_000_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &debt);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &(debt + 1));
    s.client.repay(&s.depositor, &txid, &(debt + 1));
}

// ── interest accrual ──────────────────────────────────────────────────────────

#[test]
fn interest_accrues_over_time() {
    let s = setup();
    // 500_000 sats × $60k = $300 collateral = 3_000_000_000 stroops.
    // Max borrow at 150%: 3_000_000_000 × 10_000 / 15_000 = 2_000_000_000 stroops.
    // Borrow $199 (1_990_000_000 stroops) — just under the limit.
    // Supply = borrow / 0.75 ≈ 2_654_000_000 to put utilization near optimal (75%).
    let supply = 2_654_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);

    // Advance 1 year of ledgers — at ~75% utilization, rate = 800 bp (8% APR).
    // Expected interest ≈ 1_990_000_000 × 8% = 159_200_000 stroops.
    s.env.ledger().set_sequence_number(1_000 + 6_311_520);

    // Trigger accrual via a minimal partial repay.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert!(pos.usdc_debt > borrow, "interest should have accrued after 1 year");
}

// ── liquidation ───────────────────────────────────────────────────────────────

#[test]
fn liquidation_of_undercollateralized_position() {
    let s = setup();

    // collateral = 500_000 sats × $60k = $300 = 3_000_000_000 stroops.
    // Liquidation threshold (120%): debt > 3_000_000_000 × 10_000 / 12_000 = 2_500_000_000.
    // Borrow $199 (1_990_000_000 stroops) at ~75% utilization with $2_654M supply.
    // At 800 bp (8% APR), interest > 510_000_000 needed → ~20.2M ledgers.
    // Use 25_000_000 for comfortable margin.
    let supply = 2_654_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);

    s.env.ledger().set_sequence_number(1_000 + 25_000_000);

    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.keeper, &10_000_000_000_i128);
    s.client.liquidate(&s.keeper, &txid);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Liquidated);
    assert_eq!(pos.usdc_debt, 0);
    assert_eq!(s.client.get_protocol_state().total_borrowed, 0);
}

#[test]
fn liquidation_after_interest_accrual() {
    let s = setup();

    // Supply enough USDC for 75% utilization at borrow amount.
    // borrow = 1_999_000_000 (~$199.9 USDC, just under $200 max)
    // supply = borrow / 0.75 = 2_665_333_333 ≈ 2_666_000_000
    let supply = 10_000_000_000_i128; // $1000 USDC (low utilization, OK for test)
    let txid = setup_with_supply_and_deposit(&s, supply);

    // Borrow just under max (2_000_000_000 stroops = $200).
    let borrow = 1_999_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);

    // Advance many ledgers so debt grows above the liquidation threshold.
    // collateral = 3_000_000_000 stroops ($300)
    // liquidation when debt > 3_000_000_000 × 10_000 / 12_000 = 2_500_000_000 stroops
    // Need: 1_999_000_000 + interest > 2_500_000_000 → interest > 501_000_000
    // At U=20% (1_999/10_000), borrow_rate_bp = 2000*800/7500 = 213 bp (2.13% APR)
    // interest = 1_999_000_000 × 213 × N / (6_311_520 × 10_000)
    // 501_000_000 = 1_999_000_000 × 213 × N / 63_115_200_000
    // N = 501_000_000 × 63_115_200_000 / (1_999_000_000 × 213)
    // N = 31,620,715,200,000,000 / 425_787_000_000 ≈ 74,269,000 ledgers (~11.8 years)
    s.env.ledger().set_sequence_number(1_000 + 80_000_000);

    // Keeper liquidates. Keeper needs to pay the accrued debt amount.
    // Ensure keeper has enough USDC.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.keeper, &100_000_000_000_i128);

    s.client.liquidate(&s.keeper, &txid);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Liquidated);
    assert_eq!(pos.usdc_debt, 0);
    assert_eq!(s.client.get_protocol_state().total_borrowed, 0);
}

#[test]
#[should_panic]
fn liquidation_of_healthy_position_panics() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &500_000_000_i128); // $50 on $300 collateral = 600% health
    s.client.liquidate(&s.keeper, &txid);
}

#[test]
#[should_panic]
fn liquidation_by_non_keeper_panics() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &500_000_000_i128);
    let rando = Address::generate(&s.env);
    s.client.liquidate(&rando, &txid);
}

// ── borrow rate ───────────────────────────────────────────────────────────────

#[test]
fn borrow_rate_zero_when_nothing_borrowed() {
    let s = setup();
    assert_eq!(s.client.get_borrow_rate_bp(), 0);
}

#[test]
fn borrow_rate_at_optimal_utilization_is_slope1() {
    let s = setup();
    // Supply 100_000, borrow 75_000 → U = 75% → rate = 800 bp
    s.client.supply_usdc(&s.supplier, &100_000_i128);
    let txid = do_deposit(&s);
    s.client.borrow(&s.depositor, &txid, &75_000_i128);
    assert_eq!(s.client.get_borrow_rate_bp(), 800);
}

// ── full cycle ────────────────────────────────────────────────────────────────

#[test]
fn full_deposit_borrow_repay_cycle() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);

    let borrow_amount = 1_000_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow_amount);

    // Advance a few ledgers to accrue a small amount of interest.
    s.env.ledger().set_sequence_number(2_000);

    // Repay the exact original debt (interest may round to zero at this scale).
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &borrow_amount);
    s.client.repay(&s.depositor, &txid, &borrow_amount);

    // Position closed (no interest accrued at low utilization / short time).
    let pos: Position = s.client.get_position(&txid).unwrap();
    // Debt may be 0 (closed) or tiny interest was accrued (still active with small remaining debt).
    // Either way the debt should be < original borrow.
    assert!(pos.usdc_debt < borrow_amount);
}
