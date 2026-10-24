//! Unit tests against a mock `bitcoin-spv`. The live check against the real
//! testnet contract is in this example's README.
extern crate std;

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::BytesN as _, Bytes, BytesN, Env, Vec};

// The signet transaction used in the README: one output of 199,948,796 sats
// to a P2WPKH scriptPubKey.
const RAW_TX: &str = "0200000001b537900472b560534e675775bb97d3cc4c74147887e34174e7b838cfa8bfa5d60000000000b801000001fcf9ea0b00000000160014c56f8649634e03d02308be1d660aa7959fdf643a00000000";
const SPK: &str = "0014c56f8649634e03d02308be1d660aa7959fdf643a";
const SATS: u64 = 199_948_796;

fn bytes(env: &Env, hex: &str) -> Bytes {
    let v: std::vec::Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    Bytes::from_slice(env, &v)
}

/// Accepts any proof whose `tx_index` is 1, as the real contract would for a
/// valid proof; rejects everything else with `MerkleProofInvalid` (5).
#[contract]
struct MockSpv;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum MockError {
    MerkleProofInvalid = 5,
}

#[contractimpl]
impl MockSpv {
    pub fn verify_transaction(
        env: Env,
        block_hash: BytesN<32>,
        _merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        _min_confirmations: u32,
    ) -> Result<SpvVerificationResult, MockError> {
        if tx_index != 1 {
            return Err(MockError::MerkleProofInvalid);
        }
        Ok(SpvVerificationResult {
            txid: env
                .crypto()
                .sha256(&env.crypto().sha256(&raw_tx).into())
                .into(),
            block_hash,
            block_height: 327_600,
            confirmations: 10,
        })
    }
}

fn setup(env: &Env) -> SpvPaymentCheckClient<'_> {
    let spv = env.register(MockSpv, ());
    let id = env.register(SpvPaymentCheck, (spv, 6u32));
    SpvPaymentCheckClient::new(env, &id)
}

#[test]
fn accepts_payment_once() {
    let env = Env::default();
    let c = setup(&env);
    let bh = BytesN::random(&env);
    let proof = Vec::new(&env);
    let p = c.check_payment(
        &bh,
        &proof,
        &1,
        &bytes(&env, RAW_TX),
        &bytes(&env, SPK),
        &1_000,
    );
    assert_eq!(p.sats, SATS);
    assert!(c.is_used(&p.txid));
    assert_eq!(
        c.try_check_payment(
            &bh,
            &proof,
            &1,
            &bytes(&env, RAW_TX),
            &bytes(&env, SPK),
            &1_000
        ),
        Err(Ok(Error::AlreadyUsed))
    );
}

#[test]
fn rejects_bad_proof_wrong_output_and_low_amount() {
    let env = Env::default();
    let c = setup(&env);
    let bh = BytesN::random(&env);
    let proof = Vec::new(&env);
    let tx = bytes(&env, RAW_TX);
    assert_eq!(
        c.try_check_payment(&bh, &proof, &2, &tx, &bytes(&env, SPK), &1_000),
        Err(Ok(Error::ProofRejected))
    );
    assert_eq!(
        c.try_check_payment(
            &bh,
            &proof,
            &1,
            &tx,
            &bytes(&env, "0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            &1_000
        ),
        Err(Ok(Error::OutputNotFound))
    );
    assert_eq!(
        c.try_check_payment(&bh, &proof, &1, &tx, &bytes(&env, SPK), &(SATS + 1)),
        Err(Ok(Error::AmountTooLow))
    );
}
