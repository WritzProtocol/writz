//! Checks this crate against the real `bitcoin-spv` source: the types decode
//! by field name, the error codes and names match, the generated client calls
//! the contract, and the parser agrees with the one Writz Lend runs.
extern crate std;

use super::*;
use bitcoin_spv::{BitcoinSpvContract, BitcoinSpvContractClient};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    Address, Env, IntoVal, TryFromVal, Val,
};

/// The signet transaction used in the docs and examples: one output of
/// 199,948,796 sats to a P2WPKH scriptPubKey.
const RAW_TX: &str = "0200000001b537900472b560534e675775bb97d3cc4c74147887e34174e7b838cfa8bfa5d60000000000b801000001fcf9ea0b00000000160014c56f8649634e03d02308be1d660aa7959fdf643a00000000";
const SPK: &str = "0014c56f8649634e03d02308be1d660aa7959fdf643a";
/// Its txid in internal byte order, as `verify_transaction` returned it on
/// testnet (display order: 1fef7b54...ccb718b1).
const TXID_INTERNAL: &str = "b118b7cc60c2bb03b3898f9bfb2605882251ff45ec9d71cce89a81a1547bef1f";

/// Regtest-style proof-of-work limit, so any checkpoint bits are accepted.
const EASY_BITS: u32 = 0x207f_ffff;

fn hex(s: &str) -> std::vec::Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn bytes(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, &hex(s))
}

fn roundtrip<A, B>(env: &Env, a: &A) -> B
where
    A: IntoVal<Env, Val> + Clone,
    B: TryFromVal<Env, Val>,
{
    let v: Val = a.clone().into_val(env);
    B::try_from_val(env, &v).unwrap_or_else(|_| panic!("type does not decode by field name"))
}

#[test]
fn verification_result_matches_contract_type() {
    let env = Env::default();
    let theirs = spv_types::SpvVerificationResult {
        txid: BytesN::random(&env),
        block_hash: BytesN::random(&env),
        block_height: 327_600,
        confirmations: 71,
    };
    let ours: SpvVerificationResult = roundtrip(&env, &theirs);
    assert_eq!(ours.txid, theirs.txid);
    assert_eq!(ours.block_hash, theirs.block_hash);
    assert_eq!(ours.block_height, 327_600);
    assert_eq!(ours.confirmations, 71);
    let back: spv_types::SpvVerificationResult = roundtrip(&env, &ours);
    assert_eq!(back, theirs);
}

#[test]
fn tip_and_header_match_contract_types() {
    let env = Env::default();
    let tip = spv_types::BestTip {
        hash: BytesN::random(&env),
        height: 327_670,
        chainwork: U256::from_u32(&env, 42),
    };
    let ours: BestTip = roundtrip(&env, &tip);
    assert_eq!(
        (ours.hash, ours.height, ours.chainwork),
        (tip.hash, tip.height, tip.chainwork)
    );

    let header = spv_types::HeaderEntry {
        prev: BytesN::random(&env),
        merkle_root: BytesN::random(&env),
        height: 1,
        bits: 2,
        time: 3,
        period_start_time: 4,
        chainwork: U256::from_u32(&env, 5),
    };
    let ours: HeaderEntry = roundtrip(&env, &header);
    assert_eq!(ours.merkle_root, header.merkle_root);
    assert_eq!(
        (ours.height, ours.bits, ours.time, ours.period_start_time),
        (1, 2, 3, 4)
    );
}

#[test]
fn error_codes_and_names_match_contract() {
    for code in 1..=40u32 {
        let e = soroban_sdk::Error::from_contract_error(code);
        let theirs = bitcoin_spv::SPVError::try_from(e);
        let ours = SPVError::try_from(e);
        match (theirs, ours) {
            (Ok(t), Ok(o)) => {
                assert_eq!(std::format!("{t:?}"), std::format!("{o:?}"), "code {code}")
            }
            (Err(_), Err(_)) => {}
            _ => panic!("code {code} exists on one side only"),
        }
    }
}

#[test]
fn client_calls_the_real_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(BitcoinSpvContract, (admin.clone(), EASY_BITS));
    let spv = BitcoinSpvClient::new(&env, &id);

    assert_eq!(spv.get_best_tip(), None);
    assert_eq!(spv.get_checkpoint(), None);

    let cp_hash = BytesN::<32>::random(&env);
    BitcoinSpvContractClient::new(&env, &id).set_checkpoint(
        &admin,
        &100,
        &cp_hash,
        &EASY_BITS,
        &1_700_000_000,
        &1_699_000_000,
    );

    let cp = spv.get_checkpoint().unwrap();
    assert_eq!(
        (cp.height, cp.block_hash.clone(), cp.bits),
        (100, cp_hash.clone(), EASY_BITS)
    );
    let tip = spv.get_best_tip().unwrap();
    assert_eq!((tip.hash, tip.height), (cp_hash.clone(), 100));
    assert_eq!(spv.get_canonical_hash(&100), Some(cp_hash.clone()));
    assert!(spv.get_header(&cp_hash).is_some());
    assert!(!spv.is_deposit_consumed(&BytesN::random(&env)));

    let raw_tx = bytes(&env, RAW_TX);
    let proof = Vec::new(&env);
    let err = |r: Result<
        Result<SpvVerificationResult, soroban_sdk::ConversionError>,
        Result<SPVError, soroban_sdk::InvokeError>,
    >| match r {
        Err(Ok(e)) => e,
        other => panic!("expected a contract error, got {other:?}"),
    };

    assert_eq!(
        err(spv.try_verify_transaction(&cp_hash, &proof, &0, &raw_tx, &0)),
        SPVError::ZeroMinConfirmations
    );
    assert_eq!(
        err(spv.try_verify_transaction(&cp_hash, &proof, &0, &Bytes::new(&env), &1)),
        SPVError::EmptyTransaction
    );
    assert_eq!(
        err(spv.try_verify_transaction(&BytesN::random(&env), &proof, &0, &raw_tx, &1)),
        SPVError::HeaderNotFound
    );
    assert_eq!(
        err(spv.try_verify_transaction(&cp_hash, &proof, &0, &raw_tx, &1)),
        SPVError::BlockNotAfterCheckpoint
    );
}

#[test]
fn parser_finds_the_signet_payment() {
    let env = Env::default();
    assert_eq!(
        find_output_value(&bytes(&env, RAW_TX), &bytes(&env, SPK)),
        Some(199_948_796)
    );
    assert_eq!(
        find_output_value(&bytes(&env, RAW_TX), &bytes(&env, "0014")),
        None
    );
}

#[test]
fn parser_agrees_with_writz_lend_parser() {
    let env = Env::default();
    let spk_a = std::format!("0020{}", "ab".repeat(32));
    let spk_b = std::format!("5120{}", "cd".repeat(32));
    let cases: [(&str, &str); 6] = [
        (RAW_TX, SPK),
        (RAW_TX, &spk_a),
        (&RAW_TX[..RAW_TX.len() / 2], SPK),
        ("", SPK),
        ("0100000000", SPK),
        (RAW_TX, &spk_b),
    ];
    for (tx, spk) in cases {
        let (tx, spk) = (bytes(&env, tx), bytes(&env, spk));
        assert_eq!(
            find_output_value(&tx, &spk),
            spv_types::btc_parser::find_p2wsh_output(&tx, &spk)
        );
    }
}

#[test]
fn txid_is_internal_order_sha256d() {
    let env = Env::default();
    let id = txid(&env, &bytes(&env, RAW_TX));
    assert_eq!(std::vec::Vec::from(id.to_array()), hex(TXID_INTERNAL));
}
