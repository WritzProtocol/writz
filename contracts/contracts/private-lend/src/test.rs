#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env, Vec,
};

use spv_types::SpvVerificationResult;

use crate::{
    error::PrivateLendError,
    types::{Position, PositionStatus},
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
        _block_hash: BytesN<32>,
        _merkle_proof: Vec<BytesN<32>>,
        _tx_index: u32,
        _raw_tx: Bytes,
        _min_confirmations: u32,
    ) -> SpvVerificationResult {
        SpvVerificationResult {
            txid: BytesN::from_array(&env, &[0xdeu8; 32]),
            block_hash: BytesN::from_array(&env, &[0xadu8; 32]),
            block_height: 2_900_000,
            confirmations: 6,
        }
    }
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
    let mut buf = [0x22u8; 33];
    buf[0] = 0x02;
    BytesN::from_array(env, &buf)
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
    crate::script::p2wsh_script_pubkey(
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
    client: PrivateLendContractClient<'static>,
    usdc: Address,
    /// Default mock Reflector oracle's address, kept for any future test
    /// that wants to switch back to it after swapping in a different mock
    /// via `set_oracle` - none of the current tests read it back.
    #[allow(dead_code)]
    oracle: Address,
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

    // Deploy PrivateLend.
    let pl = env.register(PrivateLendContract, ());
    let client = PrivateLendContractClient::new(&env, &pl);

    client.initialize(&admin, &spv, &usdc, &oracle, &keeper, &relayer, &fake_protocol_pubkey(&env));

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
        .initialize(&s.admin, &spv2, &s.usdc, &s.admin, &s.keeper, &s.relayer, &fake_protocol_pubkey(&s.env));
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
) -> Result<BytesN<32>, PrivateLendError> {
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
        Err(PrivateLendError::ScriptPubKeyMismatch),
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
        Err(PrivateLendError::ScriptPubKeyMismatch),
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
        Err(PrivateLendError::ScriptPubKeyMismatch),
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
        Err(PrivateLendError::InvalidScriptPubKey),
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
        Err(PrivateLendError::InvalidUserPubkey),
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
            assert_eq!(result, Err(PrivateLendError::InvalidTimelock), "offset {}", offset);
        }
    }
}

#[test]
fn initialize_rejects_protocol_pubkey_that_is_not_compressed() {
    let env = Env::default();
    env.mock_all_auths();
    let pl = env.register(PrivateLendContract, ());
    let client = PrivateLendContractClient::new(&env, &pl);
    let a = Address::generate(&env);
    let mut buf = [0x11u8; 33];
    buf[0] = 0x05;

    assert_eq!(
        client.try_initialize(&a, &a, &a, &a, &a, &a, &BytesN::<33>::from_array(&env, &buf)),
        Err(Ok(PrivateLendError::InvalidProtocolPubkey)),
    );
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
            crate::script::redeem_script(&env, &protocol, &user, timelock),
            hex(&env, script_hex),
            "redeem script for timelock {}",
            timelock
        );
        assert_eq!(
            crate::script::p2wsh_script_pubkey(&env, &protocol, &user, timelock),
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
    );
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
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let no_price_oracle = s.env.register(MockReflectorNoPrice, ());
    s.client.set_oracle(&s.admin, &no_price_oracle);

    let result = s.client.try_borrow(&s.depositor, &txid, &100_000_000_i128);
    assert_eq!(
        result,
        Err(Ok(PrivateLendError::OraclePriceUnavailable))
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
    );
    s.client.supply_usdc(&s.supplier, &1_000_000_000_000_i128);

    let stale_oracle = s.env.register(MockReflectorStale, ());
    s.client.set_oracle(&s.admin, &stale_oracle);
    s.env
        .ledger()
        .set_timestamp(crate::oracle::MAX_PRICE_STALENESS_SECS + 1);

    let result = s.client.try_borrow(&s.depositor, &txid, &100_000_000_i128);
    assert_eq!(result, Err(Ok(PrivateLendError::OraclePriceStale)));
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
