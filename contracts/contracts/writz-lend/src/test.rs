#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    symbol_short, Address, Bytes, BytesN, Env, Vec,
};

use spv_types::SpvVerificationResult;

use crate::{
    error::WritzLendError,
    types::{Position, PositionStatus},
    WritzLendContract, WritzLendContractClient,
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
        _block_hash: BytesN<32>,
        _merkle_proof: Vec<BytesN<32>>,
        _tx_index: u32,
        _raw_tx: Bytes,
        min_confirmations: u32,
    ) -> SpvVerificationResult {
        env.storage().instance().set(&symbol_short!("min_conf"), &min_confirmations);
        SpvVerificationResult {
            txid: BytesN::from_array(&env, &[0xdeu8; 32]),
            block_hash: BytesN::from_array(&env, &[0xadu8; 32]),
            block_height: 2_900_000,
            confirmations: 6,
        }
    }

    /// The `min_confirmations` the last `verify_transaction` call asked for.
    pub fn last_min_confirmations(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("min_conf")).unwrap_or(0)
    }

    /// The shared registry is tested in bitcoin-spv; this mock only accepts the call.
    pub fn consume_deposit(_env: Env, _consumer: Address, _txid: BytesN<32>) {}
}

// ── Mock Reflector oracle ──────────────────────────────────────────────────
// Mirrors the real Reflector external-prices instance's confirmed shape
// (decimals=14, see docs/research/oracle-design.md and
// contracts/scripts/verify-oracles.sh). The price is scaled so it converts
// to exactly 600_000_000_000 USDC-stroops-per-BTC -
// 6_000_000_000_000_000_000 / 10^(14-7) = 600_000_000_000 - the same value
// this test suite's collateral math was already written against under the
// old stub, so no existing assertion needs to change.
//
// Returns the *current* ledger timestamp on every call, not a fixed one, so
// the price never goes stale no matter how far other tests advance
// `env.ledger().timestamp()` - tests that need a stale or missing price use
// the dedicated mocks below instead.

#[contract]
struct MockReflector;

#[contractimpl]
impl MockReflector {
    pub fn lastprice(env: Env, _asset: crate::oracle::Asset) -> Option<crate::oracle::PriceData> {
        Some(crate::oracle::PriceData {
            price: 6_000_000_000_000_000_000,
            timestamp: env.ledger().timestamp(),
        })
    }

    pub fn decimals(_env: Env) -> u32 {
        14
    }
}

/// Same price as `MockReflector` but at 7 decimals instead of 14, with the
/// raw price already in USDC-stroops units (no scaling needed) - exercises
/// the `decimals >= USDC_DECIMALS` branch of `get_btc_price_stroops`'s
/// conversion math at the `decimals == USDC_DECIMALS` boundary, where the
/// divisor is `10^0 = 1` (no actual scaling), proving the scaling reads
/// `decimals()` live rather than assuming 14.
#[contract]
struct MockReflectorSevenDecimals;

#[contractimpl]
impl MockReflectorSevenDecimals {
    pub fn lastprice(
        env: Env,
        _asset: crate::oracle::Asset,
    ) -> Option<crate::oracle::PriceData> {
        Some(crate::oracle::PriceData {
            price: 600_000_000_000,
            timestamp: env.ledger().timestamp(),
        })
    }

    pub fn decimals(_env: Env) -> u32 {
        7
    }
}

/// Exercises the decimals < USDC_DECIMALS (multiply) branch of
/// get_btc_price_stroops's scaling math - no existing mock does, since
/// Reflector's real decimals() (14) and the USDC_DECIMALS constant (7)
/// both take the >= branch. price=6_000_000 at decimals=2 scales to
/// 6_000_000 * 10^(7-2) = 600_000_000_000 stroops/BTC, the same effective
/// price every other mock in this file uses.
#[contract]
struct MockReflectorTwoDecimals;

#[contractimpl]
impl MockReflectorTwoDecimals {
    pub fn lastprice(
        env: Env,
        _asset: crate::oracle::Asset,
    ) -> Option<crate::oracle::PriceData> {
        Some(crate::oracle::PriceData {
            price: 6_000_000,
            timestamp: env.ledger().timestamp(),
        })
    }

    pub fn decimals(_env: Env) -> u32 {
        2
    }
}

#[contract]
struct MockReflectorNoPrice;

#[contractimpl]
impl MockReflectorNoPrice {
    pub fn lastprice(
        _env: Env,
        _asset: crate::oracle::Asset,
    ) -> Option<crate::oracle::PriceData> {
        None
    }

    pub fn decimals(_env: Env) -> u32 {
        14
    }
}

/// Always reports a fixed timestamp of 0, regardless of when it's called -
/// paired with advancing `env.ledger().timestamp()` past
/// `oracle::MAX_PRICE_STALENESS_SECS` in a test, this simulates an oracle
/// that stopped updating.
#[contract]
struct MockReflectorStale;

#[contractimpl]
impl MockReflectorStale {
    pub fn lastprice(
        _env: Env,
        _asset: crate::oracle::Asset,
    ) -> Option<crate::oracle::PriceData> {
        Some(crate::oracle::PriceData {
            price: 6_000_000_000_000_000_000,
            timestamp: 0,
        })
    }

    pub fn decimals(_env: Env) -> u32 {
        14
    }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

/// Builds a minimal legacy Bitcoin transaction with a single output paying
/// `value_sat` to the given scriptPubKey.
fn build_deposit_tx(value_sat: u64, spk: &Bytes) -> std::vec::Vec<u8> {
    let mut spk_bytes = std::vec![0u8; spk.len() as usize];
    spk.copy_into_slice(&mut spk_bytes);
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
    tx.push(spk_bytes.len() as u8); // scriptPubKey len
    tx.extend_from_slice(&spk_bytes);
    // locktime
    tx.extend_from_slice(&0u32.to_le_bytes());
    tx
}

fn fake_p2wsh_spk(hash_byte: u8, env: &Env) -> Bytes {
    let mut spk = std::vec![0x00u8, 0x20];
    spk.extend_from_slice(&[hash_byte; 32]);
    Bytes::from_slice(env, &spk)
}

fn fake_block_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xadu8; 32])
}

fn fake_proof(env: &Env) -> Vec<BytesN<32>> {
    Vec::new(env)
}

/// A fake 33-byte compressed Bitcoin public key (compressed-prefix byte +
/// 32 arbitrary bytes) - this test suite never validates curve membership.
fn fake_user_pubkey(env: &Env) -> BytesN<33> {
    real_user_pubkey(env)
}

/// Block height the mock SPV reports for the block holding the deposit.
const MOCK_BLOCK_HEIGHT: u32 = 2_900_000;

/// A valid default timelock: 5,328 blocks above the mock deposit block.
const TEST_TIMELOCK: u32 = 2_905_328;

/// A fake 33-byte compressed key standing in for the protocol co-signing key.
fn fake_protocol_pubkey(env: &Env) -> BytesN<33> {
    let mut buf = [0x11u8; 33];
    buf[0] = 0x03;
    BytesN::from_array(env, &buf)
}

/// The scriptPubKey a correct Writz deposit output carries for `timelock`.
fn writz_spk(env: &Env, timelock: u32) -> Bytes {
    spv_types::script::p2wsh_script_pubkey(
        env,
        &fake_protocol_pubkey(env),
        &fake_user_pubkey(env),
        timelock,
    )
}

struct Setup {
    env: Env,
    admin: Address,
    supplier: Address,
    depositor: Address,
    keeper: Address,
    relayer: Address,
    client: WritzLendContractClient<'static>,
    usdc: Address,
    /// Default mock Reflector oracle's address, kept for any future test
    /// that wants to switch back to it after swapping in a different mock
    /// via `set_oracle` - none of the current tests read it back.
    #[allow(dead_code)]
    oracle: Address,
    /// The mock `bitcoin-spv` this pool calls.
    spv: Address,
    /// The 34-byte P2WSH scriptPubKey used in test deposit transactions.
    spk: Bytes,
    /// Raw transaction bytes matching `spk` with 500_000 sats deposited.
    raw_tx: Bytes,
}

/// Mainnet deposit parameters, the ones every test runs under unless it says otherwise.
const MAINNET_MIN_CONFIRMATIONS: u32 = 6;
const MAINNET_MIN_DEPOSIT_SATS: u64 = 100_000;

fn setup() -> Setup {
    setup_with(MAINNET_MIN_CONFIRMATIONS, MAINNET_MIN_DEPOSIT_SATS)
}

fn setup_with(min_confirmations: u32, min_deposit_satoshis: u64) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(1_000);

    let admin = Address::generate(&env);
    let supplier = Address::generate(&env);
    let depositor = Address::generate(&env);
    let keeper = Address::generate(&env);
    let relayer = Address::generate(&env);

    // Deploy USDC stellar asset contract.
    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = usdc_id.address();
    let usdc_admin = StellarAssetClient::new(&env, &usdc);

    // Mint USDC for supplier and keeper.
    usdc_admin.mint(&supplier, &10_000_000_000_000_i128); // 1_000_000 USDC
    usdc_admin.mint(&keeper, &10_000_000_000_i128);       // 1_000 USDC

    // Deploy mock SPV and mock Reflector oracle.
    let spv = env.register(MockSpv, ());
    let oracle = env.register(MockReflector, ());

    // Deploy WritzLend.
    let pl = env.register(
        WritzLendContract,
        (
            admin.clone(),
            spv.clone(),
            usdc.clone(),
            oracle.clone(),
            keeper.clone(),
            relayer.clone(),
            fake_protocol_pubkey(&env),
            min_confirmations,
            min_deposit_satoshis,
        ),
    );
    let client = WritzLendContractClient::new(&env, &pl);


    // Pre-build deposit transaction artifacts.
    let sat_amount = 500_000u64; // 0.005 BTC
    let spk = writz_spk(&env, TEST_TIMELOCK);
    let raw_bytes = build_deposit_tx(sat_amount, &spk);
    let raw_tx = Bytes::from_slice(&env, &raw_bytes);

    Setup {
        env,
        admin,
        supplier,
        depositor,
        keeper,
        relayer,
        client,
        usdc,
        oracle,
        spv,
        spk,
        raw_tx,
    }
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_config() {
    let s = setup();
    let state = s.client.get_protocol_state();
    assert_eq!(state.total_scaled_supply, 0);
    assert_eq!(state.supply_index, crate::rates::INDEX_ONE);
    assert_eq!(state.total_borrowed, 0);
}

// ── deposit ───────────────────────────────────────────────────────────────────

fn do_deposit(s: &Setup) -> BytesN<32> {
    s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &s.raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(s),
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

/// Deposits an output with `spk` for `timelock` and returns the result.
fn try_deposit_with(
    s: &Setup,
    spk: &Bytes,
    timelock: u32,
    user_pubkey: &BytesN<33>,
) -> Result<BytesN<32>, WritzLendError> {
    let raw_tx = Bytes::from_slice(&s.env, &build_deposit_tx(500_000, spk));
    match s.client.try_deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &raw_tx,
        spk,
        &timelock,
        user_pubkey,
        &sign_deposit(s),
    ) {
        Ok(Ok(txid)) => Ok(txid),
        Err(Ok(err)) => Err(err),
        other => panic!("unexpected deposit result: {:?}", other),
    }
}

/// The advisories' PoC: pledging BTC the depositor can spend alone. A P2WSH
/// over `OP_TRUE` carries no protocol key, so it must be refused.
#[test]
fn deposit_rejects_output_the_depositor_can_spend_alone() {
    let s = setup();
    let op_true_hash: BytesN<32> = s.env.crypto().sha256(&Bytes::from_slice(&s.env, &[0x51u8])).into();
    let mut spk = Bytes::from_slice(&s.env, &[0x00, 0x20]);
    spk.append(&op_true_hash.into());

    assert_eq!(
        try_deposit_with(&s, &spk, TEST_TIMELOCK, &fake_user_pubkey(&s.env)),
        Err(WritzLendError::ScriptPubKeyMismatch),
    );
}

/// A well-formed P2WSH that simply is not the Writz script for these
/// arguments (e.g. someone else's UTXO) is refused.
#[test]
fn deposit_rejects_script_pubkey_not_derived_from_the_arguments() {
    let s = setup();
    let other = fake_p2wsh_spk(0xffu8, &s.env);

    assert_eq!(
        try_deposit_with(&s, &other, TEST_TIMELOCK, &fake_user_pubkey(&s.env)),
        Err(WritzLendError::ScriptPubKeyMismatch),
    );
}

/// The script commits to the timelock: the same output cannot be registered
/// under a different timelock than the one it was funded with.
#[test]
fn deposit_rejects_timelock_that_differs_from_the_funded_script() {
    let s = setup();
    let funded_for_other_timelock = writz_spk(&s.env, TEST_TIMELOCK + 1);

    assert_eq!(
        try_deposit_with(&s, &funded_for_other_timelock, TEST_TIMELOCK, &fake_user_pubkey(&s.env)),
        Err(WritzLendError::ScriptPubKeyMismatch),
    );
}

/// A 34-byte Taproot-style scriptPubKey (`OP_1 0x20 <32>`) is not P2WSH.
#[test]
fn deposit_rejects_non_p2wsh_script_pubkey() {
    let s = setup();
    let mut buf = std::vec![0x51u8, 0x20];
    buf.extend_from_slice(&[0xabu8; 32]);
    let taproot = Bytes::from_slice(&s.env, &buf);

    assert_eq!(
        try_deposit_with(&s, &taproot, TEST_TIMELOCK, &fake_user_pubkey(&s.env)),
        Err(WritzLendError::InvalidScriptPubKey),
    );
}

#[test]
fn deposit_rejects_user_pubkey_that_is_not_compressed() {
    let s = setup();
    let mut buf = [0x22u8; 33];
    buf[0] = 0x04;
    let uncompressed_prefix = BytesN::<33>::from_array(&s.env, &buf);

    assert_eq!(
        try_deposit_with(&s, &s.spk, TEST_TIMELOCK, &uncompressed_prefix),
        Err(WritzLendError::InvalidUserPubkey),
    );
}

/// The escape hatch may not be an instant exit: it must unlock at least
/// 1,008 blocks after the deposit block, and at most 105,000.
#[test]
fn deposit_enforces_timelock_window() {
    for (offset, ok) in [
        (0u32, false),
        (1_007, false),
        (1_008, true),
        (105_000, true),
        (105_001, false),
    ] {
        let s = setup();
        let user = fake_user_pubkey(&s.env);
        let timelock = MOCK_BLOCK_HEIGHT + offset;
        let spk = writz_spk(&s.env, timelock);
        let result = try_deposit_with(&s, &spk, timelock, &user);
        if ok {
            assert!(result.is_ok(), "offset {} must be accepted: {:?}", offset, result);
        } else {
            assert_eq!(result, Err(WritzLendError::InvalidTimelock), "offset {}", offset);
        }
    }
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn constructor_rejects_protocol_pubkey_that_is_not_compressed() {
    let env = Env::default();
    let a = Address::generate(&env);
    let mut buf = [0x11u8; 33];
    buf[0] = 0x05;
    env.register(
        WritzLendContract,
        (a.clone(), a.clone(), a.clone(), a.clone(), a.clone(), a.clone(), BytesN::<33>::from_array(&env, &buf), 6u32, 100_000u64),
    );
}

fn register_with_deposit_params(min_confirmations: u32, min_deposit_satoshis: u64) {
    let env = Env::default();
    let a = Address::generate(&env);
    env.register(
        WritzLendContract,
        (a.clone(), a.clone(), a.clone(), a.clone(), a.clone(), a.clone(), fake_protocol_pubkey(&env), min_confirmations, min_deposit_satoshis),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #27)")]
fn constructor_rejects_zero_confirmations() {
    register_with_deposit_params(0, 100_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #27)")]
fn constructor_rejects_confirmations_above_the_maximum() {
    register_with_deposit_params(crate::MAX_MIN_CONFIRMATIONS + 1, 100_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #27)")]
fn constructor_rejects_a_minimum_deposit_below_the_floor() {
    register_with_deposit_params(6, crate::MIN_DEPOSIT_FLOOR_SATS - 1);
}

#[test]
fn constructor_accepts_the_bounds() {
    register_with_deposit_params(1, crate::MIN_DEPOSIT_FLOOR_SATS);
    register_with_deposit_params(crate::MAX_MIN_CONFIRMATIONS, 100_000);
}

fn hex(env: &Env, s: &str) -> Bytes {
    let raw: std::vec::Vec<u8> = (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect();
    Bytes::from_slice(env, &raw)
}

/// Reference vectors generated by `buildRedeemScript` in
/// `bitcoin-script/src/script.ts` (bitcoinjs-lib) with the secp256k1
/// generator `G` as the protocol key and `2G` as the user key. The on-chain
/// derivation must match it byte for byte, including the zero-pad byte a
/// timelock with its top bit set needs (8,388,608 = 0x800000).
#[test]
fn script_derivation_matches_the_typescript_builder() {
    let env = Env::default();
    let mut protocol = [0u8; 33];
    hex(&env, "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798").copy_into_slice(&mut protocol);
    let mut user = [0u8; 33];
    hex(&env, "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5").copy_into_slice(&mut user);
    let protocol = BytesN::<33>::from_array(&env, &protocol);
    let user = BytesN::<33>::from_array(&env, &user);

    let vectors = [
        (
            900_000u32,
            "63210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad2102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac6703a0bb0db1752102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac68",
            "00205c98f3165dbd13c2cdbba2e08e7f0248ec137889b58979b2fb7ac58705fe37ba",
        ),
        (
            8_388_608,
            "63210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad2102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac670400008000b1752102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac68",
            "00209203bc0b2a102072fb51a5c655b32fc3f6e8a303b7fbf86c4d31f57691f2397d",
        ),
        (
            100_000,
            "63210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad2102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac6703a08601b1752102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac68",
            "00202f0918371e3189114a80a20b3e13694cd4610520ea13dcc344b6898d11013557",
        ),
    ];

    for (timelock, script_hex, spk_hex) in vectors {
        assert_eq!(
            spv_types::script::redeem_script(&env, &protocol, &user, timelock),
            hex(&env, script_hex),
            "redeem script for timelock {}",
            timelock
        );
        assert_eq!(
            spv_types::script::p2wsh_script_pubkey(&env, &protocol, &user, timelock),
            hex(&env, spk_hex),
            "scriptPubKey for timelock {}",
            timelock
        );
    }
}

#[test]
#[should_panic]
fn deposit_too_small_panics() {
    let s = setup();
    // Build a tx with only 1_000 satoshis (below 100_000 minimum).
    let raw_bytes = build_deposit_tx(1_000, &s.spk);
    let raw_tx = Bytes::from_slice(&s.env, &raw_bytes);
    s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0u32,
        &raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(&s),
    );
}

/// Deposits `sats` into a fresh setup with the given parameters.
fn deposit_sats(s: &Setup, sats: u64) -> Result<BytesN<32>, Result<WritzLendError, soroban_sdk::InvokeError>> {
    let raw_tx = Bytes::from_slice(&s.env, &build_deposit_tx(sats, &s.spk));
    s.client
        .try_deposit(
            &s.depositor,
            &fake_block_hash(&s.env),
            &fake_proof(&s.env),
            &0u32,
            &raw_tx,
            &s.spk,
            &TEST_TIMELOCK,
            &fake_user_pubkey(&s.env),
            &sign_deposit(s),
        )
        .map(|r| r.unwrap())
}

#[test]
fn deposit_minimum_comes_from_the_constructor() {
    let s = setup_with(1, 5_000);
    assert_eq!(deposit_sats(&s, 4_999), Err(Ok(WritzLendError::DepositTooSmall)));
    let s = setup_with(1, 5_000);
    let txid = deposit_sats(&s, 5_000).unwrap();
    assert_eq!(s.client.get_position(&txid).unwrap().btc_satoshis, 5_000);
}

#[test]
fn deposit_rejects_below_the_mainnet_minimum() {
    let s = setup();
    assert_eq!(deposit_sats(&s, 99_999), Err(Ok(WritzLendError::DepositTooSmall)));
}

#[test]
fn deposit_asks_spv_for_the_configured_confirmations() {
    for confirmations in [1u32, 6] {
        let s = setup_with(confirmations, MAINNET_MIN_DEPOSIT_SATS);
        do_deposit(&s);
        assert_eq!(MockSpvClient::new(&s.env, &s.spv).last_min_confirmations(), confirmations);
    }
}

#[test]
fn deposit_stores_user_pubkey() {
    let s = setup();
    let expected = fake_user_pubkey(&s.env);
    let txid = do_deposit(&s);
    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.user_pubkey, expected);
}

// ── release PSBT / relayer ──────────────────────────────────────────────────────

#[test]
fn get_release_psbt_returns_none_before_publish() {
    let s = setup();
    let txid = do_deposit(&s);
    assert_eq!(s.client.get_release_psbt(&txid), None);
}

#[test]
fn publish_release_psbt_by_relayer_succeeds() {
    let s = setup();
    let txid = do_deposit(&s);
    let psbt = Bytes::from_slice(&s.env, &[0xaa, 0xbb, 0xcc]);
    s.client.publish_release_psbt(&s.relayer, &txid, &psbt);
    assert_eq!(s.client.get_release_psbt(&txid), Some(psbt));
}

#[test]
#[should_panic]
fn publish_release_psbt_by_non_relayer_panics() {
    let s = setup();
    let txid = do_deposit(&s);
    let rando = Address::generate(&s.env);
    let psbt = Bytes::from_slice(&s.env, &[0xaa]);
    s.client.publish_release_psbt(&rando, &txid, &psbt);
}

#[test]
#[should_panic]
fn publish_release_psbt_for_unknown_txid_panics() {
    let s = setup();
    let unknown_txid = BytesN::from_array(&s.env, &[0x99u8; 32]);
    let psbt = Bytes::from_slice(&s.env, &[0xaa]);
    s.client.publish_release_psbt(&s.relayer, &unknown_txid, &psbt);
}

#[test]
fn refresh_release_psbt_ttl_returns_true_after_publish() {
    let s = setup();
    let txid = do_deposit(&s);
    let psbt = Bytes::from_slice(&s.env, &[0xaa, 0xbb, 0xcc]);
    s.client.publish_release_psbt(&s.relayer, &txid, &psbt);
    assert!(s.client.refresh_release_psbt_ttl(&txid));
}

#[test]
fn refresh_release_psbt_ttl_returns_false_before_publish() {
    let s = setup();
    let txid = do_deposit(&s);
    // No release PSBT has been published for this txid yet.
    assert!(!s.client.refresh_release_psbt_ttl(&txid));
}

// ── TTL refresh (permissionless) ────────────────────────────────────────────

#[test]
fn refresh_position_ttl_returns_true_for_existing_position() {
    let s = setup();
    let txid = do_deposit(&s);
    assert!(s.client.refresh_position_ttl(&txid));
}

#[test]
fn refresh_position_ttl_returns_false_for_unknown_txid() {
    let s = setup();
    let unknown_txid = BytesN::from_array(&s.env, &[0x77u8; 32]);
    assert!(!s.client.refresh_position_ttl(&unknown_txid));
}

#[test]
fn refresh_supply_balance_ttl_returns_true_after_supply() {
    let s = setup();
    s.client.supply_usdc(&s.supplier, &1_000_i128);
    assert!(s.client.refresh_supply_balance_ttl(&s.supplier));
}

#[test]
fn refresh_supply_balance_ttl_returns_false_for_lender_with_no_balance() {
    let s = setup();
    let rando = Address::generate(&s.env);
    assert!(!s.client.refresh_supply_balance_ttl(&rando));
}

#[test]
fn refresh_protocol_ttl_does_not_panic() {
    let s = setup();
    // Permissionless and unconditional after initialization - asserting it
    // simply doesn't panic is the whole contract here (storage.rs's own
    // `.has()` guards are exercised, but there's no caller-visible signal
    // beyond "the call completed").
    s.client.refresh_protocol_ttl();
}

#[test]
fn set_relayer_by_admin_succeeds() {
    let s = setup();
    let txid = do_deposit(&s);
    let new_relayer = Address::generate(&s.env);
    s.client.set_relayer(&s.admin, &new_relayer);

    let psbt = Bytes::from_slice(&s.env, &[0xaa]);
    // Old relayer is no longer authorized.
    let old_result = s.client.try_publish_release_psbt(&s.relayer, &txid, &psbt);
    assert!(old_result.is_err());

    s.client.publish_release_psbt(&new_relayer, &txid, &psbt);
}

#[test]
#[should_panic]
fn set_relayer_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_relayer(&rando, &rando);
}

#[test]
fn set_oracle_by_admin_succeeds() {
    let s = setup();
    let new_oracle = Address::generate(&s.env);
    s.client.set_oracle(&s.admin, &new_oracle);
    // No panic = success. (No public config getter exists to assert the
    // stored value directly - see set_relayer_by_admin_succeeds for the
    // pattern used when behavioral verification is worth the setup cost.)
}

#[test]
#[should_panic]
fn set_oracle_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_oracle(&rando, &rando);
}

#[test]
fn set_spv_contract_by_admin_succeeds() {
    let s = setup();
    let new_spv = Address::generate(&s.env);
    s.client.set_spv_contract(&s.admin, &new_spv);
}

#[test]
#[should_panic]
fn set_spv_contract_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_spv_contract(&rando, &rando);
}

// ── paused ───────────────────────────────────────────────────────────────────

#[test]
fn set_paused_by_admin_succeeds() {
    let s = setup();
    s.client.set_paused(&s.admin, &true);
    s.client.set_paused(&s.admin, &false);
}

#[test]
#[should_panic]
fn set_paused_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_paused(&rando, &true);
}

#[test]
#[should_panic]
fn deposit_while_paused_panics() {
    let s = setup();
    s.client.set_paused(&s.admin, &true);
    do_deposit(&s);
}

#[test]
#[should_panic]
fn borrow_while_paused_panics() {
    let s = setup();
    let supply = 10_000_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    s.client.set_paused(&s.admin, &true);
    s.client.borrow(&s.depositor, &txid, &1_000_000_000_i128);
}

#[test]
#[should_panic]
fn supply_usdc_while_paused_panics() {
    let s = setup();
    s.client.set_paused(&s.admin, &true);
    s.client.supply_usdc(&s.supplier, &1_000_000_000_i128);
}

#[test]
fn withdraw_supply_works_while_paused() {
    let s = setup();
    let amount = 1_000_000_000_i128;
    s.client.supply_usdc(&s.supplier, &amount);
    s.client.set_paused(&s.admin, &true);
    // Exiting is never blocked by a pause - only new deposits/borrows/supply are.
    s.client.withdraw_supply(&s.supplier, &amount);
}

#[test]
fn repay_works_while_paused() {
    let s = setup();
    let supply = 10_000_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    let debt = 1_000_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &debt);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &debt);
    s.client.set_paused(&s.admin, &true);
    s.client.repay(&s.depositor, &txid, &debt);
}

// ── supply_usdc / withdraw_supply ─────────────────────────────────────────────

#[test]
fn supply_increases_pool_and_balance() {
    let s = setup();
    let amount = 1_000_000_000_i128; // 100 USDC
    s.client.supply_usdc(&s.supplier, &amount);
    let state = s.client.get_protocol_state();
    assert_eq!(state.total_scaled_supply, amount);
    assert_eq!(s.client.get_supply_balance(&s.supplier), amount);
}

#[test]
fn withdraw_supply_decreases_pool_and_balance() {
    let s = setup();
    let amount = 2_000_000_000_i128;
    s.client.supply_usdc(&s.supplier, &amount);
    s.client.withdraw_supply(&s.supplier, &1_000_000_000);
    assert_eq!(s.client.get_supply_balance(&s.supplier), 1_000_000_000);
    assert_eq!(s.client.get_protocol_state().total_scaled_supply, 1_000_000_000);
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

// ── Oracle failure modes ────────────────────────────────────────────────────────

#[test]
fn borrow_fails_when_oracle_has_no_price() {
    let s = setup();
    let txid = s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0,
        &s.raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(&s),
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let no_price_oracle = s.env.register(MockReflectorNoPrice, ());
    s.client.set_oracle(&s.admin, &no_price_oracle);

    let result = s.client.try_borrow(&s.depositor, &txid, &100_000_000_i128);
    assert_eq!(
        result,
        Err(Ok(WritzLendError::OraclePriceUnavailable))
    );
}

#[test]
fn borrow_fails_when_oracle_price_is_stale() {
    let s = setup();
    let txid = s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0,
        &s.raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(&s),
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let stale_oracle = s.env.register(MockReflectorStale, ());
    s.client.set_oracle(&s.admin, &stale_oracle);
    s.env
        .ledger()
        .set_timestamp(crate::oracle::MAX_PRICE_STALENESS_SECS + 1);

    let result = s.client.try_borrow(&s.depositor, &txid, &100_000_000_i128);
    assert_eq!(result, Err(Ok(WritzLendError::OraclePriceStale)));
}

#[test]
fn borrow_succeeds_with_a_seven_decimal_oracle() {
    let s = setup();
    let txid = s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0,
        &s.raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(&s),
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let seven_decimal_oracle = s.env.register(MockReflectorSevenDecimals, ());
    s.client.set_oracle(&s.admin, &seven_decimal_oracle);

    // Same collateral (500_000 sats) and same effective price
    // (600_000_000_000 stroops/BTC) as the default-mock test at
    // `health_ratio_at_150_pct_after_max_borrow` - borrowing the same
    // 2_000_000_000 should land at the same 150% health ratio, proving the
    // 7-decimal path produces an identical result to the 14-decimal path.
    s.client.borrow(&s.depositor, &txid, &2_000_000_000_i128);
    let health = s.client.get_health_ratio_bp(&txid);
    assert_eq!(health, 15_000);
}

#[test]
fn borrow_succeeds_with_a_two_decimal_oracle() {
    let s = setup();
    let txid = s.client.deposit(
        &s.depositor,
        &fake_block_hash(&s.env),
        &fake_proof(&s.env),
        &0,
        &s.raw_tx,
        &s.spk,
        &TEST_TIMELOCK,
        &fake_user_pubkey(&s.env),
        &sign_deposit(&s),
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let two_decimal_oracle = s.env.register(MockReflectorTwoDecimals, ());
    s.client.set_oracle(&s.admin, &two_decimal_oracle);

    // Same effective price (600_000_000_000 stroops/BTC) as every other
    // oracle-decimals test in this file, via the multiply branch this
    // time (decimals=2 < USDC_DECIMALS=7) - proves that branch is correct
    // too, not just the divide branch every other mock exercises.
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
    // Borrow $199 (1_990_000_000 stroops) - just under the limit.
    // Supply = borrow / 0.75 ≈ 2_654_000_000 to put utilization near optimal (75%).
    let supply = 2_654_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);

    // Advance 1 year of ledgers - at ~75% utilization, rate = 800 bp (8% APR).
    // Expected interest ≈ 1_990_000_000 × 8% = 159_200_000 stroops.
    s.env.ledger().set_sequence_number(1_000 + 6_311_520);

    // Trigger accrual via a minimal partial repay.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert!(pos.usdc_debt > borrow, "interest should have accrued after 1 year");
    // The protocol keeps PROTOCOL_FEE_BP (15%) of accrued interest as reserve.
    // pos.usdc_debt is after the 1-stroop repay, so add it back for the accrued interest.
    let interest = pos.usdc_debt + 1 - borrow;
    let reserve = s.client.get_protocol_state().reserve_usdc;
    assert!(reserve > 0, "accrual must fund the protocol reserve");
    assert_eq!(reserve, interest * 1_500 / 10_000);
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
    let token = TokenClient::new(&s.env, &s.usdc);
    let reserve_before = s.client.get_protocol_state().reserve_usdc;
    let keeper_before = token.balance(&s.keeper);
    let debt = s.client.get_position(&txid).unwrap().usdc_debt;
    s.client.liquidate(&s.keeper, &txid);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Liquidated);
    assert_eq!(pos.usdc_debt, 0);
    assert_eq!(s.client.get_protocol_state().total_borrowed, 0);

    // The keeper's bonus comes from the reserve, which accrual fills inside
    // `liquidate`. Here the reserve is below the 10% bonus, so the cap applies
    // and the reserve is left empty; the keeper's net outflow stays well
    // under two times the debt.
    assert!(reserve_before == 0, "reserve starts empty for this position");
    assert_eq!(s.client.get_protocol_state().reserve_usdc, 0);
    assert!(keeper_before - token.balance(&s.keeper) < 2 * debt);
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

// ── keeper stale-window fallback ─────────────────────────────────────────────────

/// Builds an undercollateralized position, mirroring
/// `liquidation_of_undercollateralized_position`'s exact numbers, but lets
/// the caller control the ledger timestamp independently of the sequence
/// number (interest accrual runs off sequence number; the stale-keeper
/// check runs off timestamp - the two clocks are orthogonal).
fn setup_undercollateralized_at(s: &Setup, timestamp: u64) -> BytesN<32> {
    s.env.ledger().set_timestamp(timestamp);
    let supply = 2_654_000_000_i128;
    let txid = setup_with_supply_and_deposit(s, supply);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);
    s.env.ledger().set_sequence_number(1_000 + 25_000_000);
    txid
}

#[test]
#[should_panic]
fn liquidate_by_non_keeper_fails_before_stale_window() {
    let s = setup();
    let txid = setup_undercollateralized_at(&s, 1_000_000);
    // Timestamp unchanged since the position's first protocol-state access
    // above - well within the default 24h (86_400s) stale window.
    let rando = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&rando, &10_000_000_000_i128);
    s.client.liquidate(&rando, &txid);
}

#[test]
fn liquidate_by_non_keeper_succeeds_after_stale_window() {
    let s = setup();
    let txid = setup_undercollateralized_at(&s, 1_000_000);

    // Advance well past the 24h default stale window with no keeper
    // heartbeat - liquidation now opens to any caller.
    s.env.ledger().set_timestamp(1_000_000 + 86_400 + 1);

    let rando = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&rando, &10_000_000_000_i128);
    s.client.liquidate(&rando, &txid);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Liquidated);
}

#[test]
fn keeper_heartbeat_resets_stale_window() {
    let s = setup();
    let txid = setup_undercollateralized_at(&s, 1_000_000);

    // Keeper checks in partway through the window...
    s.env.ledger().set_timestamp(1_000_000 + 80_000);
    s.client.keeper_heartbeat(&s.keeper);

    // ...so 24h after the ORIGINAL baseline is no longer stale relative to
    // the refreshed heartbeat.
    s.env.ledger().set_timestamp(1_000_000 + 86_400 + 1);
    let rando = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&rando, &10_000_000_000_i128);
    let result = s.client.try_liquidate(&rando, &txid);
    assert!(result.is_err(), "non-keeper must still be unauthorized after a fresh heartbeat");
}

#[test]
fn liquidate_by_designated_keeper_refreshes_heartbeat() {
    let s = setup();
    let txid = setup_undercollateralized_at(&s, 1_000_000);

    // Some time later, still well within the stale window.
    s.env.ledger().set_timestamp(1_050_000);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.keeper, &10_000_000_000_i128);
    s.client.liquidate(&s.keeper, &txid);

    let state = s.client.get_protocol_state();
    assert_eq!(
        state.last_keeper_heartbeat, 1_050_000,
        "a successful designated-keeper liquidation must refresh the heartbeat"
    );
}

#[test]
fn set_keeper_by_admin_reassigns_keeper_authority() {
    let s = setup();
    let new_keeper = Address::generate(&s.env);
    s.client.set_keeper(&s.admin, &new_keeper);

    // The old keeper is no longer the designated keeper: a heartbeat from
    // them should not count as the designated-keeper's liveness signal.
    // `keeper_heartbeat` itself checks `keeper == config.keeper`, so calling
    // it as the old keeper now fails auth.
    let old_result = s.client.try_keeper_heartbeat(&s.keeper);
    assert!(old_result.is_err(), "old keeper must lose heartbeat authority after set_keeper");

    // The new keeper can heartbeat successfully.
    s.client.keeper_heartbeat(&new_keeper);
    let state = s.client.get_protocol_state();
    assert_eq!(state.last_keeper_heartbeat, s.env.ledger().timestamp());
}

#[test]
#[should_panic]
fn set_keeper_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_keeper(&rando, &rando);
}

#[test]
#[should_panic]
fn set_keeper_stale_window_by_non_admin_panics() {
    let s = setup();
    let rando = Address::generate(&s.env);
    s.client.set_keeper_stale_window(&rando, &3_600);
}

#[test]
fn set_keeper_stale_window_by_admin_changes_fallback_timing() {
    let s = setup();
    s.client.set_keeper_stale_window(&s.admin, &3_600); // 1h instead of 24h

    let txid = setup_undercollateralized_at(&s, 1_000_000);
    s.env.ledger().set_timestamp(1_000_000 + 3_600 + 1);

    let rando = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&rando, &10_000_000_000_i128);
    s.client.liquidate(&rando, &txid);

    let pos: Position = s.client.get_position(&txid).unwrap();
    assert_eq!(pos.status, PositionStatus::Liquidated);
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

#[test]
fn supply_rate_zero_when_nothing_borrowed() {
    let s = setup();
    assert_eq!(s.client.get_supply_rate_bp(), 0);
}

#[test]
fn supply_rate_at_optimal_utilization_is_510bp() {
    let s = setup();
    // Same pool state as borrow_rate_at_optimal_utilization_is_slope1
    // (borrow=800bp, U=75%, fee=15%): supply = 800 × 0.75 × 0.85 = 510 bp,
    // matching rates::supply_rate_at_optimal_approximately_510_bp.
    s.client.supply_usdc(&s.supplier, &100_000_i128);
    let txid = do_deposit(&s);
    s.client.borrow(&s.depositor, &txid, &75_000_i128);
    assert_eq!(s.client.get_supply_rate_bp(), 510);
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

// GHSA-5rxp-7f9g-r66x (#193): total borrowing is capped, so a price crash that
// leaves unliquidatable debt is bounded by the cap.
#[test]
fn borrow_past_exposure_cap_fails() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 10_000_000_000_i128);
    s.client.set_max_total_borrowed(&s.admin, &400_000_000_i128);
    assert_eq!(
        s.client.try_borrow(&s.depositor, &txid, &500_000_000_i128),
        Err(Ok(WritzLendError::ExposureCapExceeded)),
    );
    s.client.borrow(&s.depositor, &txid, &400_000_000_i128);
}

#[test]
fn set_max_total_borrowed_by_non_admin_fails() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_set_max_total_borrowed(&stranger, &1_i128),
        Err(Ok(WritzLendError::Unauthorized)),
    );
}

// ── Bitcoin key-control proof (GHSA-862g-739q-x6h8) ───────────────────────────

/// The depositor's Bitcoin signing key. Fixed so the derived scripts are stable.
fn user_signing_key() -> k256::ecdsa::SigningKey {
    k256::ecdsa::SigningKey::from_slice(&[0x42u8; 32]).unwrap()
}

/// Compressed public key of `user_signing_key`.
fn real_user_pubkey(env: &Env) -> BytesN<33> {
    let point = user_signing_key().verifying_key().to_encoded_point(true);
    let mut out = [0u8; 33];
    out.copy_from_slice(point.as_bytes());
    BytesN::from_array(env, &out)
}

/// A BIP-137 signature by `key` over the deposit message for `contract`,
/// `depositor` and `txid`, as a wallet would produce it.
fn sign_with(env: &Env, key: &k256::ecdsa::SigningKey, contract: &Address, depositor: &Address, txid: &BytesN<32>) -> BytesN<65> {
    let msg = spv_types::key_proof::deposit_message(env, contract, depositor, txid);
    let digest = spv_types::key_proof::signed_message_digest(env, &msg).to_array();
    let (sig, recid) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut out = [0u8; 65];
    out[0] = 31 + recid.to_byte(); // compressed-key P2PKH header
    out[1..].copy_from_slice(&sig.to_bytes());
    BytesN::from_array(env, &out)
}

/// The txid the mock SPV reports for every deposit.
fn mock_txid(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xdeu8; 32])
}

fn sign_deposit(s: &Setup) -> BytesN<65> {
    sign_with(&s.env, &user_signing_key(), &s.client.address, &s.depositor, &mock_txid(&s.env))
}

fn try_deposit_signed(s: &Setup, key_sig: &BytesN<65>) -> Result<BytesN<32>, WritzLendError> {
    match s.client.try_deposit(
        &s.depositor, &fake_block_hash(&s.env), &fake_proof(&s.env), &0u32,
        &s.raw_tx, &s.spk, &TEST_TIMELOCK, &fake_user_pubkey(&s.env), key_sig,
    ) {
        Ok(Ok(txid)) => Ok(txid),
        Err(Ok(err)) => Err(err),
        other => panic!("unexpected deposit result: {:?}", other),
    }
}

#[test]
fn deposit_signed_by_the_depositors_bitcoin_key_succeeds() {
    let s = setup();
    assert!(try_deposit_signed(&s, &sign_deposit(&s)).is_ok());
}

#[test]
fn deposit_signed_by_another_key_is_rejected() {
    // GHSA-862g: someone else's Writz output, claimed without its key.
    let s = setup();
    let attacker = k256::ecdsa::SigningKey::from_slice(&[0x77u8; 32]).unwrap();
    let sig = sign_with(&s.env, &attacker, &s.client.address, &s.depositor, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(WritzLendError::InvalidKeyProof));
}

#[test]
fn a_key_proof_for_another_depositor_is_rejected() {
    // The victim's genuine signature, replayed by a different Stellar account.
    let s = setup();
    let victim = Address::generate(&s.env);
    let sig = sign_with(&s.env, &user_signing_key(), &s.client.address, &victim, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(WritzLendError::InvalidKeyProof));
}

#[test]
fn a_key_proof_for_another_contract_is_rejected() {
    // A signature made for the other lender (or another deployment).
    let s = setup();
    let other_contract = Address::generate(&s.env);
    let sig = sign_with(&s.env, &user_signing_key(), &other_contract, &s.depositor, &mock_txid(&s.env));
    assert_eq!(try_deposit_signed(&s, &sig), Err(WritzLendError::InvalidKeyProof));
}

#[test]
fn a_key_proof_for_another_txid_is_rejected() {
    let s = setup();
    let sig = sign_with(&s.env, &user_signing_key(), &s.client.address, &s.depositor, &BytesN::from_array(&s.env, &[0x01u8; 32]));
    assert_eq!(try_deposit_signed(&s, &sig), Err(WritzLendError::InvalidKeyProof));
}

#[test]
fn a_signature_with_an_uncompressed_key_header_is_rejected() {
    let s = setup();
    let mut sig = sign_deposit(&s).to_array();
    sig[0] = 27; // uncompressed-key header
    assert_eq!(try_deposit_signed(&s, &BytesN::from_array(&s.env, &sig)), Err(WritzLendError::InvalidKeyProof));
}

// ── Interest is priced per interval (GHSA-c9gg-c476-9vc8, GHSA-frj5-5wmv-wvm3) ──

/// One year at ~75% utilization, then a borrower floods the pool with supply
/// right before a 1-stroop repay, trying to reprice the whole year at the
/// crashed rate. Returns the interest charged.
fn interest_after_year(flash_supply: i128) -> i128 {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_654_000_000_i128);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);
    s.env.ledger().set_sequence_number(1_000 + 6_311_520);

    let usdc = StellarAssetClient::new(&s.env, &s.usdc);
    if flash_supply > 0 {
        usdc.mint(&s.depositor, &flash_supply);
        s.client.supply_usdc(&s.depositor, &flash_supply);
    }
    usdc.mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);
    if flash_supply > 0 {
        // Rounding favours the pool, so the supply is worth up to 1 stroop less.
        let value = s.client.get_supply_balance(&s.depositor);
        s.client.withdraw_supply(&s.depositor, &value);
    }
    let pos: Position = s.client.get_position(&txid).unwrap();
    pos.usdc_debt + 1 - borrow
}

#[test]
fn a_flash_supply_before_repaying_does_not_erase_past_interest() {
    let honest = interest_after_year(0);
    // ~8% APR on $199: about 159.2 USDC of interest.
    assert!(honest > 150_000_000, "honest interest {honest}");
    let attacked = interest_after_year(1_000_000_000_000_i128); // 100,000 USDC dumped in
    assert_eq!(attacked, honest, "the past year must be priced at the rate that applied during it");
}

#[test]
fn a_rate_change_only_reprices_the_time_after_it() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_654_000_000_i128);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);
    let rate_before = s.client.get_borrow_rate_bp();

    // Half a year at ~75% utilization (~8% APR)...
    s.env.ledger().set_sequence_number(1_000 + 6_311_520 / 2);
    s.client.supply_usdc(&s.supplier, &2_654_000_000_i128); // ...then utilization halves.
    let rate_after = s.client.get_borrow_rate_bp();
    assert!(rate_after < 800, "rate after more supply: {rate_after}");

    // ...then half a year at the lower rate.
    s.env.ledger().set_sequence_number(1_000 + 6_311_520);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);

    let pos: Position = s.client.get_position(&txid).unwrap();
    let interest = pos.usdc_debt + 1 - borrow;
    let first_half = borrow * rate_before / 10_000 / 2;
    // Second half grows the already-accrued debt at the lower rate.
    let second_half = (borrow + first_half) * rate_after / 10_000 / 2;
    let expected = first_half + second_half;
    assert!((interest - expected).abs() <= 2, "interest {interest}, expected {expected}");
}

// ── Lender yield: supply index and scaled balances (#255) ─────────────────────

const YEAR: u32 = 6_311_520;

/// Supplies 265.4 USDC, borrows 199 (75% utilization), lets a year pass, then
/// repays everything. Returns the setup, the txid and the interest paid.
fn lender_year_fully_repaid() -> (Setup, i128) {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_654_000_000_i128);
    let borrow = 1_990_000_000_i128;
    s.client.borrow(&s.depositor, &txid, &borrow);
    s.env.ledger().set_sequence_number(1_000 + YEAR);

    let usdc = StellarAssetClient::new(&s.env, &s.usdc);
    usdc.mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);
    let debt = s.client.get_position(&txid).unwrap().usdc_debt;
    usdc.mint(&s.depositor, &debt);
    s.client.repay(&s.depositor, &txid, &debt);
    (s, debt + 1 - borrow)
}

#[test]
fn lender_earns_85_percent_of_the_interest_and_the_reserve_15() {
    let (s, interest) = lender_year_fully_repaid();
    assert!(interest > 150_000_000, "interest {interest}");

    let principal = 2_654_000_000_i128;
    let value = s.client.get_supply_balance(&s.supplier);
    let fee = interest * 1_500 / 10_000;
    assert!((value - (principal + interest - fee)).abs() <= 2, "value {value}");

    let reserve = s.client.get_protocol_state().reserve_usdc;
    assert!((reserve - fee).abs() <= 2, "reserve {reserve}, fee {fee}");
}

#[test]
fn lender_withdraws_more_than_they_supplied() {
    let (s, _) = lender_year_fully_repaid();
    let usdc = TokenClient::new(&s.env, &s.usdc);
    let before = usdc.balance(&s.supplier);

    // Withdrawing exactly the displayed value never fails on rounding.
    let value = s.client.get_supply_balance(&s.supplier);
    s.client.withdraw_supply(&s.supplier, &value);

    assert_eq!(usdc.balance(&s.supplier) - before, value);
    assert!(value > 2_654_000_000_i128);
    assert_eq!(s.client.get_supply_balance(&s.supplier), 0);
    assert_eq!(s.client.get_protocol_state().total_scaled_supply, 0);
}

#[test]
fn a_supply_in_the_ledger_of_an_accrual_earns_nothing_from_the_past() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_654_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &1_990_000_000_i128);
    s.env.ledger().set_sequence_number(1_000 + YEAR);

    let late = s.depositor.clone();
    let amount = 1_000_000_000_i128;
    StellarAssetClient::new(&s.env, &s.usdc).mint(&late, &amount);
    s.client.supply_usdc(&late, &amount);

    let value = s.client.get_supply_balance(&late);
    assert!(value <= amount && amount - value <= 1, "value {value}");
}

#[test]
fn a_supply_that_mints_no_scaled_units_is_rejected() {
    let (s, _) = lender_year_fully_repaid();
    // The index is above 1 now, so one stroop rounds down to zero units.
    assert_eq!(
        s.client.try_supply_usdc(&s.supplier, &1_i128),
        Err(Ok(WritzLendError::ZeroShareAmount)),
    );
}

#[test]
fn withdrawing_more_than_the_value_is_rejected() {
    let (s, _) = lender_year_fully_repaid();
    let value = s.client.get_supply_balance(&s.supplier);
    assert_eq!(
        s.client.try_withdraw_supply(&s.supplier, &(value + 1)),
        Err(Ok(WritzLendError::InsufficientSupply)),
    );
}

#[test]
fn lenders_cannot_withdraw_what_is_lent_out() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 1_000_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &600_000_000_i128);
    assert_eq!(
        s.client.try_withdraw_supply(&s.supplier, &500_000_000_i128),
        Err(Ok(WritzLendError::InsufficientLiquidity)),
    );
    s.client.withdraw_supply(&s.supplier, &400_000_000_i128);
}

#[test]
fn utilization_counts_accrued_supply_not_principal_only() {
    // After a year of interest the lenders' assets exceed the principal, so
    // utilization (and the rate) must be lower than on principal alone.
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_654_000_000_i128);
    s.client.borrow(&s.depositor, &txid, &1_990_000_000_i128);
    s.env.ledger().set_sequence_number(1_000 + YEAR);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.depositor, &1_i128);
    s.client.repay(&s.depositor, &txid, &1_i128);

    let p = s.client.get_protocol_state();
    let assets = crate::rates::total_supply_assets(&p, p.supply_index);
    assert!(assets > 2_654_000_000_i128);
    assert_eq!(
        s.client.get_borrow_rate_bp(),
        crate::rates::borrow_rate_bp(p.total_borrowed, assets),
    );
}

/// Lender claims plus the reserve never exceed what the contract holds plus
/// what borrowers still owe it.
fn assert_solvent(s: &Setup) {
    let p = s.client.get_protocol_state();
    let held = TokenClient::new(&s.env, &s.usdc).balance(&s.client.address);
    let claims = crate::rates::total_supply_assets(&p, p.supply_index) + p.reserve_usdc;
    assert!(held + p.total_borrowed >= claims, "held {held} + borrowed {} < claims {claims}", p.total_borrowed);
}

#[test]
fn two_lenders_share_interest_in_proportion_to_when_they_joined() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 2_000_000_000_i128); // lender A, from the start
    s.client.borrow(&s.depositor, &txid, &1_000_000_000_i128);
    s.env.ledger().set_sequence_number(1_000 + YEAR / 2);

    let b = s.depositor.clone(); // lender B joins half a year in with the same amount
    StellarAssetClient::new(&s.env, &s.usdc).mint(&b, &2_000_000_000_i128);
    s.client.supply_usdc(&b, &2_000_000_000_i128);
    s.env.ledger().set_sequence_number(1_000 + YEAR);

    // Touch the pool so the index is current, then compare.
    StellarAssetClient::new(&s.env, &s.usdc).mint(&b, &1_i128);
    s.client.repay(&b, &txid, &1_i128);

    let a_gain = s.client.get_supply_balance(&s.supplier) - 2_000_000_000;
    let b_gain = s.client.get_supply_balance(&b) - 2_000_000_000;
    assert!(a_gain > 0 && b_gain > 0);
    // A earned over a full year and the first half alone; B only the second half.
    assert!(a_gain > b_gain, "a {a_gain}, b {b_gain}");
    assert_solvent(&s);
}

#[test]
fn partial_withdrawals_round_in_the_pools_favour_and_stay_solvent() {
    let (s, _) = lender_year_fully_repaid();
    let mut withdrawn = 0_i128;
    let before = s.client.get_supply_balance(&s.supplier);
    for amt in [1_i128, 7, 333_333_333, 1, 999_999_999] {
        s.client.withdraw_supply(&s.supplier, &amt);
        withdrawn += amt;
        // The balance falls by at least what was taken: no free USDC from rounding.
        let left = s.client.get_supply_balance(&s.supplier);
        assert!(before - left >= withdrawn, "left {left}, withdrawn {withdrawn}");
        assert_solvent(&s);
    }
}

#[test]
fn solvency_holds_across_a_mixed_sequence() {
    let s = setup();
    let txid = setup_with_supply_and_deposit(&s, 5_000_000_000_i128);
    let usdc = StellarAssetClient::new(&s.env, &s.usdc);
    let b = s.depositor.clone();
    usdc.mint(&b, &10_000_000_000_i128);
    s.client.borrow(&b, &txid, &1_000_000_000_i128);
    assert_solvent(&s);

    let mut seq = 1_000_u32;
    for step in 0..12_u32 {
        seq += 400_000 + step * 37_001;
        s.env.ledger().set_sequence_number(seq);
        match step % 4 {
            0 => s.client.supply_usdc(&b, &(123_456_789 + step as i128)),
            1 => s.client.repay(&b, &txid, &(10_000_001 + step as i128)),
            2 => {
                let v = s.client.get_supply_balance(&s.supplier);
                s.client.withdraw_supply(&s.supplier, &(v / 5));
            }
            _ => s.client.borrow(&b, &txid, &(5_000_000 + step as i128)),
        }
        assert_solvent(&s);
    }
}

#[test]
fn liquidation_keeps_the_pool_solvent_and_the_lender_gains() {
    let s = setup();
    let supply = 10_000_000_000_i128;
    let txid = setup_with_supply_and_deposit(&s, supply);
    s.client.borrow(&s.depositor, &txid, &1_999_000_000_i128);
    s.env.ledger().set_sequence_number(1_000 + 80_000_000);
    StellarAssetClient::new(&s.env, &s.usdc).mint(&s.keeper, &100_000_000_000_i128);

    s.client.liquidate(&s.keeper, &txid);

    assert_solvent(&s);
    assert!(s.client.get_supply_balance(&s.supplier) > supply);
    let v = s.client.get_supply_balance(&s.supplier);
    s.client.withdraw_supply(&s.supplier, &v);
}
