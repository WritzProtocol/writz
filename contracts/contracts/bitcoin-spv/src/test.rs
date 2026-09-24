#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Bytes, BytesN, Env, Vec, U256};

use crate::{BitcoinSpvContract, BitcoinSpvContractClient, SPVError, SpvVerificationResult};
use crate::crypto::{hash_merkle_pair, sha256d};
use crate::difficulty::{bits_to_target, expected_bits, hash_as_u256, target_to_bits, validate_proof_of_work, work_from_target};
use crate::types::HeaderEntry;
use crate::header::hash_header;
use crate::merkle::verify_merkle_inclusion;

// ══════════════════════════════════════════════════════════════════════════════
// Test helpers
// ══════════════════════════════════════════════════════════════════════════════

/// Compact `bits` used by the default mined fixtures: the standard Bitcoin
/// "regtest" maximum-easiness target (~2^255), so a passing nonce takes ~2
/// hash attempts. It is also the proof-of-work limit of the test light client.
const EASY_TEST_BITS: u32 = 0x207f_ffff;

/// Height of the checkpoint in the default fixture. Far from a 2016-block
/// boundary so ordinary tests never trigger a retarget.
const CP_HEIGHT: u32 = 100;

/// Timestamp of the checkpoint block and base for mined headers.
const T0: u32 = 1_700_000_000;

/// Ledger time set on every test env, so headers are not "in the future".
const LEDGER_NOW: u64 = 1_800_000_000;

const CP_HASH: [u8; 32] = [0x77u8; 32];

/// Builds and mines a real, PoW-valid 80-byte header at `bits`: fills
/// version/prev_hash/merkle_root/time/bits, then brute-forces the nonce until
/// `difficulty::validate_proof_of_work` accepts it. This exercises the real,
/// unmodified proof-of-work path end to end. Deterministic: identical
/// arguments always mine an identical header.
fn mine_header(
    env: &Env,
    bits: u32,
    prev_hash: &[u8; 32],
    merkle_root: &[u8; 32],
    time: u32,
) -> BytesN<80> {
    let mut buf = [0u8; 80];
    buf[0..4].copy_from_slice(&1i32.to_le_bytes());
    buf[4..36].copy_from_slice(prev_hash);
    buf[36..68].copy_from_slice(merkle_root);
    buf[68..72].copy_from_slice(&time.to_le_bytes());
    buf[72..76].copy_from_slice(&bits.to_le_bytes());
    for nonce in 0u32..1_000_000 {
        buf[76..80].copy_from_slice(&nonce.to_le_bytes());
        let candidate = BytesN::<80>::from_array(env, &buf);
        if validate_proof_of_work(env, &candidate).is_ok() {
            return candidate;
        }
    }
    panic!("failed to mine a valid test header in 1,000,000 attempts - bits too hard for a unit test");
}

fn mine_valid_header(
    env: &Env,
    prev_hash: &[u8; 32],
    merkle_root: &[u8; 32],
    time: u32,
) -> BytesN<80> {
    mine_header(env, EASY_TEST_BITS, prev_hash, merkle_root, time)
}

/// Mines a contiguous chain of easy headers starting after `prev`, one per
/// entry in `roots`, with times `t0`, `t0 + 1`, ... Returns the headers.
fn mine_chain(env: &Env, prev: &[u8; 32], roots: &[[u8; 32]], t0: u32) -> std::vec::Vec<BytesN<80>> {
    let mut out = std::vec::Vec::new();
    let mut prev_hash = *prev;
    for (i, root) in roots.iter().enumerate() {
        let h = mine_valid_header(env, &prev_hash, root, t0 + i as u32);
        prev_hash = hash_header(env, &h).to_array();
        out.push(h);
    }
    out
}

fn to_sdk_headers(env: &Env, headers: &[BytesN<80>]) -> Vec<BytesN<80>> {
    let mut v: Vec<BytesN<80>> = Vec::new(env);
    for h in headers {
        v.push_back(h.clone());
    }
    v
}

/// Computes SHA256d over a byte slice, returning a `[u8; 32]`.
fn sha256d_bytes(env: &Env, data: &[u8]) -> [u8; 32] {
    let b = Bytes::from_slice(env, data);
    sha256d(env, &b).to_array()
}

/// Constructs a Bitcoin Merkle root over `txids`.
///
/// Duplicates the last node at each level when the count is odd, matching
/// Bitcoin's Merkle tree construction exactly.
fn compute_merkle_root(env: &Env, txids: &[[u8; 32]]) -> [u8; 32] {
    assert!(!txids.is_empty());
    let mut level: std::vec::Vec<[u8; 32]> = txids.to_vec();
    while level.len() > 1 {
        let mut next = std::vec::Vec::new();
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { level[i] };
            let l = BytesN::<32>::from_array(env, &left);
            let r = BytesN::<32>::from_array(env, &right);
            next.push(hash_merkle_pair(env, &l, &r).to_array());
            i += 2;
        }
        level = next;
    }
    level[0]
}

/// Returns the Merkle inclusion proof (sibling hashes, leaf → root) for
/// the transaction at `tx_index` in a block whose transactions are `txids`.
fn compute_merkle_proof(
    env: &Env,
    txids: &[[u8; 32]],
    tx_index: usize,
) -> std::vec::Vec<[u8; 32]> {
    let mut proof = std::vec::Vec::new();
    let mut level: std::vec::Vec<[u8; 32]> = txids.to_vec();
    let mut idx = tx_index;
    while level.len() > 1 {
        let sibling_idx = if idx % 2 == 0 {
            if idx + 1 < level.len() { idx + 1 } else { idx } // duplicate for odd level
        } else {
            idx - 1
        };
        proof.push(level[sibling_idx]);
        // Build parent level.
        let mut next = std::vec::Vec::new();
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { level[i] };
            let l = BytesN::<32>::from_array(env, &left);
            let r = BytesN::<32>::from_array(env, &right);
            next.push(hash_merkle_pair(env, &l, &r).to_array());
            i += 2;
        }
        idx /= 2;
        level = next;
    }
    proof
}

/// Converts a `std::vec::Vec<[u8; 32]>` into a Soroban `Vec<BytesN<32>>`.
fn to_sdk_proof(env: &Env, proof: &[[u8; 32]]) -> Vec<BytesN<32>> {
    let mut v: Vec<BytesN<32>> = Vec::new(env);
    for h in proof {
        v.push_back(BytesN::<32>::from_array(env, h));
    }
    v
}

/// A light client initialized on the easy test network and anchored to a
/// checkpoint at `CP_HEIGHT` (or a custom one, see `new_light_at`).
struct Light<'a> {
    client: BitcoinSpvContractClient<'a>,
    admin: Address,
}

fn new_light_at<'a>(
    env: &'a Env,
    cp_height: u32,
    cp_bits: u32,
    cp_time: u32,
    cp_period_start: u32,
) -> Light<'a> {
    env.mock_all_auths();
    env.ledger().set_timestamp(LEDGER_NOW);

    let id = env.register(BitcoinSpvContract, ());
    let client = BitcoinSpvContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&admin, &EASY_TEST_BITS);
    client.set_checkpoint(
        &admin,
        &cp_height,
        &BytesN::<32>::from_array(env, &CP_HASH),
        &cp_bits,
        &cp_time,
        &cp_period_start,
    );
    Light { client, admin }
}

fn new_light(env: &Env) -> Light<'_> {
    new_light_at(env, CP_HEIGHT, EASY_TEST_BITS, T0, T0)
}

/// A freshly registered client with no `initialize`/`set_checkpoint` calls -
/// for tests exercising the pre-setup error paths.
fn new_uninitialized_client(env: &Env) -> BitcoinSpvContractClient<'_> {
    env.ledger().set_timestamp(LEDGER_NOW);
    let id = env.register(BitcoinSpvContract, ());
    BitcoinSpvContractClient::new(env, &id)
}

/// Builds a self-consistent scenario on a fresh light client - a block with
/// `tx_count` transactions plus `extra_headers` blocks on top - submits the
/// headers, then runs `verify_transaction` for the tx at `tx_index`.
fn run_full_verification(
    env: &Env,
    tx_count: usize,
    tx_index: usize,
    extra_headers: u32,
    min_confirmations: u32,
) -> Result<SpvVerificationResult, SPVError> {
    let light = new_light(env);

    let raw_txs: std::vec::Vec<std::vec::Vec<u8>> = (0..tx_count)
        .map(|i| {
            let mut v = std::vec![0x01u8, 0x00, 0x00, 0x00]; // version = 1 LE
            v.extend_from_slice(&[i as u8; 8]);
            v
        })
        .collect();
    let txids: std::vec::Vec<[u8; 32]> =
        raw_txs.iter().map(|tx| sha256d_bytes(env, tx)).collect();
    let merkle_root = compute_merkle_root(env, &txids);
    let merkle_proof = compute_merkle_proof(env, &txids, tx_index);

    let mut roots = std::vec![merkle_root];
    for k in 0..extra_headers {
        roots.push([k as u8 + 1; 32]);
    }
    let headers = mine_chain(env, &CP_HASH, &roots, T0 + 1);
    light.client.submit_headers(&to_sdk_headers(env, &headers));

    let block_hash = hash_header(env, &headers[0]);
    let raw_tx_sdk = Bytes::from_slice(env, &raw_txs[tx_index]);
    let proof_sdk = to_sdk_proof(env, &merkle_proof);

    // SDK 26: try_* returns Result<Result<T, ConversionError>, Result<E, InvokeError>>.
    // Flatten to Result<T, E>, panicking on unexpected invocation errors.
    match light.client.try_verify_transaction(
        &block_hash,
        &proof_sdk,
        &(tx_index as u32),
        &raw_tx_sdk,
        &min_confirmations,
    ) {
        Ok(Ok(result)) => Ok(result),
        Err(Ok(err)) => Err(err),
        Ok(Err(e)) => panic!("unexpected conversion error: {:?}", e),
        Err(Err(_)) => panic!("unexpected invocation error"),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Crypto primitive tests
// ══════════════════════════════════════════════════════════════════════════════

/// SHA256d("") must match the well-known double-SHA256 of the empty string.
#[test]
fn sha256d_empty_string_known_vector() {
    let env = Env::default();
    // SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    // SHA256d("") = SHA256 of the above
    let expected = hex32("5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456");
    assert_eq!(sha256d_bytes(&env, b""), expected);
}

/// SHA256d("hello") must match a precomputed known value.
#[test]
fn sha256d_hello_known_vector() {
    let env = Env::default();
    // SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    // SHA256d("hello") = 9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50
    let expected = hex32("9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50");
    assert_eq!(sha256d_bytes(&env, b"hello"), expected);
}

/// hash_merkle_pair must be order-sensitive: (a,b) ≠ (b,a) for distinct inputs.
#[test]
fn hash_merkle_pair_order_matters() {
    let env = Env::default();
    let a = BytesN::<32>::from_array(&env, &[0x11u8; 32]);
    let b = BytesN::<32>::from_array(&env, &[0x22u8; 32]);
    assert_ne!(
        hash_merkle_pair(&env, &a, &b),
        hash_merkle_pair(&env, &b, &a),
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Merkle proof unit tests
// ══════════════════════════════════════════════════════════════════════════════

/// Single-transaction block: empty proof passes when txid == merkle_root.
#[test]
fn merkle_single_tx_empty_proof() {
    let env = Env::default();
    let txid_arr = sha256d_bytes(&env, b"genesis_coinbase");
    let txid = BytesN::<32>::from_array(&env, &txid_arr);
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    verify_merkle_inclusion(&env, &txid, 0, &proof, &txid)
        .expect("single-tx: txid == root with empty proof must succeed");
}

/// Two transactions: left leaf (index 0).
#[test]
fn merkle_two_tx_left_leaf() {
    let env = Env::default();
    let txids = [sha256d_bytes(&env, b"tx0"), sha256d_bytes(&env, b"tx1")];
    let root = compute_merkle_root(&env, &txids);
    let proof = compute_merkle_proof(&env, &txids, 0);

    verify_merkle_inclusion(
        &env,
        &BytesN::from_array(&env, &txids[0]),
        0,
        &to_sdk_proof(&env, &proof),
        &BytesN::from_array(&env, &root),
    )
    .expect("left leaf in 2-tx block must verify");
}

/// Two transactions: right leaf (index 1).
#[test]
fn merkle_two_tx_right_leaf() {
    let env = Env::default();
    let txids = [sha256d_bytes(&env, b"tx0"), sha256d_bytes(&env, b"tx1")];
    let root = compute_merkle_root(&env, &txids);
    let proof = compute_merkle_proof(&env, &txids, 1);

    verify_merkle_inclusion(
        &env,
        &BytesN::from_array(&env, &txids[1]),
        1,
        &to_sdk_proof(&env, &proof),
        &BytesN::from_array(&env, &root),
    )
    .expect("right leaf in 2-tx block must verify");
}

/// Four transactions: all four positions must verify independently.
#[test]
fn merkle_four_tx_all_positions() {
    let env = Env::default();
    let raw: [&[u8]; 4] = [b"tx_a", b"tx_b", b"tx_c", b"tx_d"];
    let txids: [[u8; 32]; 4] = core::array::from_fn(|i| sha256d_bytes(&env, raw[i]));
    let root = compute_merkle_root(&env, &txids);
    let root_sdk = BytesN::<32>::from_array(&env, &root);

    for i in 0..4usize {
        let proof = compute_merkle_proof(&env, &txids, i);
        verify_merkle_inclusion(
            &env,
            &BytesN::from_array(&env, &txids[i]),
            i as u32,
            &to_sdk_proof(&env, &proof),
            &root_sdk,
        )
        .unwrap_or_else(|e| panic!("index {} failed: {:?}", i, e));
    }
}

/// Eight transactions (odd count at parent level → duplication): all must verify.
#[test]
fn merkle_seven_tx_odd_count() {
    let env = Env::default();
    let txids: [[u8; 32]; 7] =
        core::array::from_fn(|i| sha256d_bytes(&env, &[i as u8; 4]));
    let root = compute_merkle_root(&env, &txids);
    let root_sdk = BytesN::<32>::from_array(&env, &root);

    for i in 0..7usize {
        let proof = compute_merkle_proof(&env, &txids, i);
        verify_merkle_inclusion(
            &env,
            &BytesN::from_array(&env, &txids[i]),
            i as u32,
            &to_sdk_proof(&env, &proof),
            &root_sdk,
        )
        .unwrap_or_else(|e| panic!("7-tx index {} failed: {:?}", i, e));
    }
}

/// Tampered txid must return MerkleProofInvalid.
#[test]
fn merkle_wrong_txid_rejected() {
    let env = Env::default();
    let txids = [sha256d_bytes(&env, b"tx0"), sha256d_bytes(&env, b"tx1")];
    let root = compute_merkle_root(&env, &txids);
    let proof = compute_merkle_proof(&env, &txids, 0);

    let mut bad = txids[0];
    bad[7] ^= 0xff;

    let result = verify_merkle_inclusion(
        &env,
        &BytesN::from_array(&env, &bad),
        0,
        &to_sdk_proof(&env, &proof),
        &BytesN::from_array(&env, &root),
    );
    assert_eq!(result, Err(SPVError::MerkleProofInvalid));
}

/// Wrong tx_index (correct txid, wrong path) must return MerkleProofInvalid.
#[test]
fn merkle_wrong_index_rejected() {
    let env = Env::default();
    let txids = [sha256d_bytes(&env, b"tx0"), sha256d_bytes(&env, b"tx1")];
    let root = compute_merkle_root(&env, &txids);
    // Proof is correct for index 0, but we pass index 1.
    let proof = compute_merkle_proof(&env, &txids, 0);

    let result = verify_merkle_inclusion(
        &env,
        &BytesN::from_array(&env, &txids[0]),
        1,
        &to_sdk_proof(&env, &proof),
        &BytesN::from_array(&env, &root),
    );
    assert_eq!(result, Err(SPVError::MerkleProofInvalid));
}

// ══════════════════════════════════════════════════════════════════════════════
// Proof-of-work / difficulty tests
// ══════════════════════════════════════════════════════════════════════════════

/// The genuine Bitcoin mainnet genesis block header, fetched independently
/// from Blockstream's Esplora API (`GET /block/<hash>/header`) rather than
/// transcribed from memory - a single transposed byte here would silently
/// produce a wrong-but-passing test. Cross-checked field-by-field against
/// well-known genesis facts (version=1, time=1231006505, bits=0x1d00ffff,
/// nonce=2083236893) before use.
const GENESIS_HEADER: [u8; 80] = [
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3b, 0xa3, 0xed, 0xfd, 0x7a, 0x7b, 0x12, 0xb2, 0x7a,
    0xc7, 0x2c, 0x3e, 0x67, 0x76, 0x8f, 0x61, 0x7f, 0xc8, 0x1b, 0xc3, 0x88, 0x8a, 0x51, 0x32,
    0x3a, 0x9f, 0xb8, 0xaa, 0x4b, 0x1e, 0x5e, 0x4a, 0x29, 0xab, 0x5f, 0x49, 0xff, 0xff, 0x00,
    0x1d, 0x1d, 0xac, 0x2b, 0x7c,
];

/// SHA256d of `GENESIS_HEADER`, in internal (little-endian-integer) byte
/// order - i.e. what `hash_header` must return. Independently cross-checked:
/// reversing this and hex-encoding it reproduces the famous display-order
/// genesis hash `000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f`.
const GENESIS_HASH: [u8; 32] = [
    0x6f, 0xe2, 0x8c, 0x0a, 0xb6, 0xf1, 0xb3, 0x72, 0xc1, 0xa6, 0xa2, 0x46, 0xae, 0x63, 0xf7,
    0x4f, 0x93, 0x1e, 0x83, 0x65, 0xe1, 0x5a, 0x08, 0x9c, 0x68, 0xd6, 0x19, 0x00, 0x00, 0x00,
    0x00, 0x00,
];

/// Strongest available correctness proof for PoW validation: real mainnet data,
/// not a synthetic fixture. The real genesis header must pass PoW validation,
/// and `hash_header` must reproduce the well-known genesis hash exactly.
#[test]
fn header_genesis_block_known_vector() {
    let env = Env::default();
    let h = BytesN::<80>::from_array(&env, &GENESIS_HEADER);
    let expected_hash = BytesN::<32>::from_array(&env, &GENESIS_HASH);

    assert_eq!(hash_header(&env, &h), expected_hash);
    validate_proof_of_work(&env, &h).expect("real genesis header must satisfy its own PoW");
}

/// bits=0x1d00ffff (genesis) must decode to the well-known genesis target.
/// The expected value is a hardcoded literal, not re-derived via the same
/// shift `bits_to_target` performs, so this test isn't circular.
#[test]
fn bits_to_target_genesis_known_vector() {
    let env = Env::default();
    let target = bits_to_target(&env, 0x1d00ffff).expect("genesis bits must decode");
    let expected_be: [u8; 32] = [
        0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ];
    let expected = U256::from_be_bytes(&env, &Bytes::from_array(&env, &expected_be));
    assert_eq!(target, expected);
}

/// A `bits` value with the sign bit set and a nonzero mantissa encodes a
/// negative target, which Bitcoin consensus rules reject outright.
#[test]
fn bits_to_target_rejects_negative_sign_bit() {
    let env = Env::default();
    assert_eq!(
        bits_to_target(&env, 0x0092_3456),
        Err(SPVError::InvalidDifficultyBits)
    );
}

/// A `bits` value whose exponent/mantissa combination overflows 256 bits
/// must be rejected, not silently miscomputed.
#[test]
fn bits_to_target_rejects_overflow() {
    let env = Env::default();
    assert_eq!(
        bits_to_target(&env, 0xff12_3456),
        Err(SPVError::InvalidDifficultyBits)
    );
}

/// A zero mantissa yields a zero target regardless of exponent - inherited
/// Bitcoin Core behavior. No hash can ever be less than zero, so this is
/// correctly rejected downstream by `InsufficientProofOfWork`, not treated
/// as malformed input here. This test documents that this is intentional,
/// so a future reader doesn't "fix" it into an eager rejection.
#[test]
fn bits_to_target_zero_mantissa_yields_zero_target() {
    let env = Env::default();
    let target = bits_to_target(&env, 0x2000_0000).expect("zero mantissa is not malformed");
    assert_eq!(target, U256::from_u32(&env, 0));
}

/// exponent <= 3 shifts the mantissa right instead of left.
#[test]
fn bits_to_target_exponent_le_3_shifts_right() {
    let env = Env::default();
    // exponent == 3: target equals the mantissa exactly (no shift).
    let target_eq = bits_to_target(&env, 0x0300_00ff).expect("valid bits");
    assert_eq!(target_eq, U256::from_u32(&env, 0xff));

    // exponent == 2: mantissa >> 8.
    let target_shr = bits_to_target(&env, 0x0200_ff00).expect("valid bits");
    assert_eq!(target_shr, U256::from_u32(&env, 0xff));
}

/// `hash_as_u256` must equal `U256::from_be_bytes` of the conventional,
/// display-order hex string of the same hash - verified against the real
/// genesis hash, sourced independently above (not re-derived from
/// `hash_header`, so this pins the byte-order convention itself).
#[test]
fn hash_as_u256_matches_display_order_known_vector() {
    let env = Env::default();
    let internal_order_hash = BytesN::<32>::from_array(&env, &GENESIS_HASH);
    let display_hex_bytes = {
        let mut reversed = GENESIS_HASH;
        reversed.reverse();
        reversed
    };
    let expected =
        U256::from_be_bytes(&env, &Bytes::from_array(&env, &display_hex_bytes));
    assert_eq!(hash_as_u256(&env, &internal_order_hash), expected);
}

// ══════════════════════════════════════════════════════════════════════════════
// Full verify_transaction integration tests
// ══════════════════════════════════════════════════════════════════════════════

#[test]
fn full_verify_single_tx_block() {
    let env = Env::default();
    run_full_verification(&env, 1, 0, 0, 1).expect("single-tx, 1 confirmation must succeed");
}

#[test]
fn full_verify_two_tx_block_both_indices() {
    let env = Env::default();
    for idx in 0..2 {
        run_full_verification(&env, 2, idx, 0, 1)
            .unwrap_or_else(|_| panic!("2-tx index {} must succeed", idx));
    }
}

#[test]
fn full_verify_four_tx_block_six_confirmations() {
    let env = Env::default();
    let result = run_full_verification(&env, 4, 2, 5, 6)
        .expect("4-tx block index 2, 6 confirmations must succeed");
    assert_eq!(result.confirmations, 6);
}

#[test]
fn full_verify_eight_tx_block_all_indices() {
    let env = Env::default();
    for idx in 0..8usize {
        run_full_verification(&env, 8, idx, 2, 3)
            .unwrap_or_else(|_| panic!("8-tx block index {} must verify", idx));
    }
}

#[test]
fn full_verify_seven_tx_block_odd_count() {
    let env = Env::default();
    for idx in 0..7usize {
        run_full_verification(&env, 7, idx, 0, 1)
            .unwrap_or_else(|_| panic!("7-tx (odd) block index {} must verify", idx));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// submit_headers: what the light client refuses to store
// ══════════════════════════════════════════════════════════════════════════════

/// A header with a deliberately impossible target (target = 1) must be
/// rejected with `InsufficientProofOfWork`. No mining is needed: the chance
/// of an unmined nonce satisfying `hash < 1` is `~2^-256`.
#[test]
fn submit_headers_rejects_insufficient_pow() {
    let env = Env::default();
    let light = new_light(&env);

    let mut buf = [0u8; 80];
    buf[0..4].copy_from_slice(&1i32.to_le_bytes());
    buf[4..36].copy_from_slice(&CP_HASH);
    buf[72..76].copy_from_slice(&0x0300_0001u32.to_le_bytes()); // target = 1
    let header = BytesN::<80>::from_array(&env, &buf);

    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[header])),
        Err(Ok(SPVError::InsufficientProofOfWork)),
    );
}

/// A header whose `bits` field overflows must be rejected with
/// `InvalidDifficultyBits`.
#[test]
fn submit_headers_rejects_malformed_bits() {
    let env = Env::default();
    let light = new_light(&env);

    let mut buf = [0u8; 80];
    buf[0..4].copy_from_slice(&1i32.to_le_bytes());
    buf[4..36].copy_from_slice(&CP_HASH);
    buf[72..76].copy_from_slice(&0xff12_3456u32.to_le_bytes()); // overflowing exponent
    let header = BytesN::<80>::from_array(&env, &buf);

    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[header])),
        Err(Ok(SPVError::InvalidDifficultyBits)),
    );
}

/// Regression for the fabricated-chain advisories: a chain a caller mined
/// privately, which never touched the checkpoint, must be rejected outright,
/// and the fake transaction inside it must not be provable.
#[test]
fn submit_headers_rejects_fabricated_chain_not_anchored_to_checkpoint() {
    let env = Env::default();
    let light = new_light(&env);

    let fake_tx = [0x11u8; 40];
    let root = sha256d_bytes(&env, &fake_tx);
    let roots = [root, [1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32], [5u8; 32]];
    let fabricated = mine_chain(&env, &[0u8; 32], &roots, T0 + 1);

    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &fabricated)),
        Err(Ok(SPVError::UnknownParent)),
    );

    let block_hash = hash_header(&env, &fabricated[0]);
    assert_eq!(
        light.client.try_verify_transaction(
            &block_hash,
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, &fake_tx),
            &1,
        ),
        Err(Ok(SPVError::HeaderNotFound)),
    );
}

/// The attack the old 64x "difficulty band" allowed: extending a real stored
/// header with easier-than-real difficulty. Exact difficulty rules reject it.
#[test]
fn submit_headers_rejects_easier_difficulty_than_parent() {
    let env = Env::default();
    let light = new_light_at(&env, CP_HEIGHT, 0x2007_ffff, T0, T0);

    let header = mine_header(&env, EASY_TEST_BITS, &CP_HASH, &[1u8; 32], T0 + 1);
    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[header])),
        Err(Ok(SPVError::UnexpectedDifficulty)),
    );
}

#[test]
fn submit_headers_rejects_timestamp_too_far_in_future() {
    let env = Env::default();
    let light = new_light(&env);

    let too_late = LEDGER_NOW as u32 + 7_201;
    let header = mine_valid_header(&env, &CP_HASH, &[1u8; 32], too_late);
    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[header])),
        Err(Ok(SPVError::TimestampTooFarInFuture)),
    );
}

#[test]
fn submit_headers_rejects_empty_and_oversized_batches() {
    let env = Env::default();
    let light = new_light(&env);

    assert_eq!(
        light.client.try_submit_headers(&Vec::new(&env)),
        Err(Ok(SPVError::NoHeaders)),
    );

    let roots: std::vec::Vec<[u8; 32]> = (0..17u8).map(|i| [i; 32]).collect();
    let headers = mine_chain(&env, &CP_HASH, &roots, T0 + 1);
    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &headers)),
        Err(Ok(SPVError::TooManyHeaders)),
    );
}

#[test]
fn submit_headers_is_idempotent() {
    let env = Env::default();
    let light = new_light(&env);

    let headers = mine_chain(&env, &CP_HASH, &[[1u8; 32], [2u8; 32]], T0 + 1);
    let sdk = to_sdk_headers(&env, &headers);

    assert_eq!(light.client.submit_headers(&sdk), CP_HEIGHT + 2);
    assert_eq!(light.client.submit_headers(&sdk), CP_HEIGHT + 2);
}

/// A run of headers can be split across calls as long as each call continues
/// from something already stored.
#[test]
fn submit_headers_accepts_a_chain_across_multiple_calls() {
    let env = Env::default();
    let light = new_light(&env);

    let headers = mine_chain(&env, &CP_HASH, &[[1u8; 32], [2u8; 32], [3u8; 32]], T0 + 1);
    assert_eq!(light.client.submit_headers(&to_sdk_headers(&env, &headers[0..2])), CP_HEIGHT + 2);
    assert_eq!(light.client.submit_headers(&to_sdk_headers(&env, &headers[2..3])), CP_HEIGHT + 3);

    let tip = light.client.get_best_tip().expect("best tip");
    assert_eq!(tip.height, CP_HEIGHT + 3);
    assert_eq!(tip.hash, hash_header(&env, &headers[2]));
}

// ══════════════════════════════════════════════════════════════════════════════
// Fork choice
// ══════════════════════════════════════════════════════════════════════════════

/// A heavier fork takes over the best chain; a transaction that was only in
/// the orphaned branch stops being provable.
#[test]
fn heavier_fork_replaces_best_chain_and_orphans_old_block() {
    let env = Env::default();
    let light = new_light(&env);

    let raw_a = std::vec![0xaau8; 30];
    let raw_b = std::vec![0xbbu8; 30];
    let root_a = sha256d_bytes(&env, &raw_a);
    let root_b = sha256d_bytes(&env, &raw_b);

    let chain_a = mine_chain(&env, &CP_HASH, &[root_a, [0xa1u8; 32]], T0 + 1);
    let chain_b = mine_chain(&env, &CP_HASH, &[root_b, [0xb1u8; 32], [0xb2u8; 32]], T0 + 100);

    light.client.submit_headers(&to_sdk_headers(&env, &chain_a));
    let a_block = hash_header(&env, &chain_a[0]);
    light
        .client
        .verify_transaction(&a_block, &Vec::new(&env), &0, &Bytes::from_slice(&env, &raw_a), &1);

    // Equal work does not displace the incumbent.
    assert_eq!(
        light.client.submit_headers(&to_sdk_headers(&env, &chain_b[0..2])),
        CP_HEIGHT + 2
    );
    assert_eq!(light.client.get_best_tip().unwrap().hash, hash_header(&env, &chain_a[1]));

    // Strictly more work does.
    assert_eq!(
        light.client.submit_headers(&to_sdk_headers(&env, &chain_b[2..3])),
        CP_HEIGHT + 3
    );
    assert_eq!(light.client.get_best_tip().unwrap().hash, hash_header(&env, &chain_b[2]));

    assert_eq!(
        light.client.try_verify_transaction(
            &a_block,
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, &raw_a),
            &1
        ),
        Err(Ok(SPVError::NotOnBestChain)),
    );
    let b_block = hash_header(&env, &chain_b[0]);
    let result = light.client.verify_transaction(
        &b_block,
        &Vec::new(&env),
        &0,
        &Bytes::from_slice(&env, &raw_b),
        &1,
    );
    assert_eq!(result.confirmations, 3);
}

// ══════════════════════════════════════════════════════════════════════════════
// Difficulty retargeting (Bitcoin consensus, exact)
// ══════════════════════════════════════════════════════════════════════════════

/// Expected `bits` at a retarget boundary, checked against compact values
/// derived by hand (not by the code under test) at real mainnet scale, where
/// the 256-bit multiplication cannot overflow.
fn boundary_bits(env: &Env, parent_bits: u32, timespan: u32, pow_limit_bits: u32) -> u32 {
    let parent = HeaderEntry {
        prev: BytesN::from_array(env, &[0u8; 32]),
        merkle_root: BytesN::from_array(env, &[0u8; 32]),
        height: 2015,
        bits: parent_bits,
        time: T0 + timespan,
        period_start_time: T0,
        chainwork: U256::from_u32(env, 0),
    };
    let pow_limit = bits_to_target(env, pow_limit_bits).unwrap();
    expected_bits(env, &parent, 2016, &pow_limit).unwrap()
}

/// A period that took exactly two weeks leaves the target unchanged.
#[test]
fn retarget_unchanged_when_period_took_exactly_two_weeks() {
    let env = Env::default();
    assert_eq!(boundary_bits(&env, 0x1d00_ffff, 1_209_600, 0x1d00_ffff), 0x1d00_ffff);
}

/// Half the time halves the target: `0xffff << 208` halved is `0x7fff80 << 200`.
#[test]
fn retarget_halves_target_when_period_took_half_the_time() {
    let env = Env::default();
    assert_eq!(boundary_bits(&env, 0x1d00_ffff, 604_800, 0x1d00_ffff), 0x1c7f_ff80);
}

/// A period that took 10 weeks is clamped to 4 weeks, so the target grows 4x:
/// `0x00ffff << 200` times 4 is `0x03fffc << 200`.
#[test]
fn retarget_clamps_slow_period_to_four_times_easier() {
    let env = Env::default();
    assert_eq!(boundary_bits(&env, 0x1c00_ffff, 6_048_000, 0x1d00_ffff), 0x1c03_fffc);
}

/// A period that took 100 seconds is clamped to a quarter of two weeks, so
/// the target shrinks 4x: `0xffff << 206` is `0x3fffc0 << 200`.
#[test]
fn retarget_clamps_fast_period_to_four_times_harder() {
    let env = Env::default();
    assert_eq!(boundary_bits(&env, 0x1d00_ffff, 100, 0x1d00_ffff), 0x1c3f_ffc0);
}

/// At the limit, a slow period would push the target past it; it is capped.
#[test]
fn retarget_never_exceeds_the_pow_limit() {
    let env = Env::default();
    assert_eq!(boundary_bits(&env, 0x1d00_ffff, 6_048_000, 0x1d00_ffff), 0x1d00_ffff);
}

/// Away from a boundary the parent's `bits` carry over untouched.
#[test]
fn expected_bits_is_the_parents_inside_a_period() {
    let env = Env::default();
    let parent = HeaderEntry {
        prev: BytesN::from_array(&env, &[0u8; 32]),
        merkle_root: BytesN::from_array(&env, &[0u8; 32]),
        height: 1000,
        bits: 0x1d00_ffff,
        time: T0,
        period_start_time: T0,
        chainwork: U256::from_u32(&env, 0),
    };
    let pow_limit = bits_to_target(&env, 0x1d00_ffff).unwrap();
    assert_eq!(expected_bits(&env, &parent, 1001, &pow_limit).unwrap(), 0x1d00_ffff);
}

/// End to end through `submit_headers`: at a boundary a header must carry the
/// retargeted `bits` (here the capped-at-limit value); anything else is
/// rejected.
#[test]
fn submit_headers_enforces_retargeted_bits_at_a_boundary() {
    let env = Env::default();
    let light = new_light_at(&env, 2015, EASY_TEST_BITS, T0 + 6_048_000, T0);
    let t = T0 + 6_048_001;

    let wrong = mine_header(&env, 0x207f_fffe, &CP_HASH, &[1u8; 32], t);
    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[wrong])),
        Err(Ok(SPVError::UnexpectedDifficulty)),
    );

    let right = mine_header(&env, EASY_TEST_BITS, &CP_HASH, &[1u8; 32], t);
    assert_eq!(light.client.submit_headers(&to_sdk_headers(&env, &[right])), 2016);
}

/// Inside a period the difficulty must not move at all.
#[test]
fn difficulty_must_not_change_inside_a_period() {
    let env = Env::default();
    let light = new_light(&env);

    let harder = mine_header(&env, 0x207f_fffe, &CP_HASH, &[1u8; 32], T0 + 1);
    assert_eq!(
        light.client.try_submit_headers(&to_sdk_headers(&env, &[harder])),
        Err(Ok(SPVError::UnexpectedDifficulty)),
    );
}

#[test]
fn target_to_bits_round_trips_genesis() {
    let env = Env::default();
    let target = bits_to_target(&env, 0x1d00_ffff).unwrap();
    assert_eq!(target_to_bits(&target), 0x1d00_ffff);
}

/// A mantissa whose top bit would read as a sign bit must be shifted down
/// and the exponent bumped: 0x80 encodes as 0x02008000, not 0x01800000.
#[test]
fn target_to_bits_avoids_the_sign_bit() {
    let env = Env::default();
    assert_eq!(target_to_bits(&U256::from_u32(&env, 0x80)), 0x0200_8000);
}

/// Difficulty-1 work is 4295032833 = 0x100010001 (well-known chainwork of one
/// difficulty-1 block).
#[test]
fn work_from_target_matches_difficulty_one() {
    let env = Env::default();
    let target = bits_to_target(&env, 0x1d00_ffff).unwrap();
    assert_eq!(
        work_from_target(&env, &target),
        U256::from_u128(&env, 0x1_0001_0001)
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Error path tests via the contract client
// ══════════════════════════════════════════════════════════════════════════════

/// Submits one block whose Merkle root is `root`; returns its hash.
fn submit_single_block(env: &Env, light: &Light<'_>, root: [u8; 32]) -> BytesN<32> {
    let headers = mine_chain(env, &CP_HASH, &[root], T0 + 1);
    light.client.submit_headers(&to_sdk_headers(env, &headers));
    hash_header(env, &headers[0])
}

#[test]
fn error_zero_min_confirmations() {
    let env = Env::default();
    let light = new_light(&env);
    let raw_tx = Bytes::from_slice(&env, b"tx");

    assert_eq!(
        light.client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &Vec::new(&env),
            &0,
            &raw_tx,
            &0
        ),
        Err(Ok(SPVError::ZeroMinConfirmations)),
    );
}

#[test]
fn error_insufficient_confirmations() {
    let env = Env::default();
    let light = new_light(&env);
    let raw_tx = b"btc_tx";
    let block_hash = submit_single_block(&env, &light, sha256d_bytes(&env, raw_tx));

    // 1 confirmation exists, but 6 are required.
    assert_eq!(
        light.client.try_verify_transaction(
            &block_hash,
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, raw_tx),
            &6
        ),
        Err(Ok(SPVError::InsufficientConfirmations)),
    );
}

#[test]
fn error_empty_transaction() {
    let env = Env::default();
    let light = new_light(&env);

    assert_eq!(
        light.client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &Vec::new(&env),
            &0,
            &Bytes::new(&env),
            &1
        ),
        Err(Ok(SPVError::EmptyTransaction)),
    );
}

#[test]
fn error_merkle_proof_invalid() {
    let env = Env::default();
    let light = new_light(&env);
    // The block declares a different Merkle root than SHA256d(raw_tx).
    let block_hash = submit_single_block(&env, &light, [0xabu8; 32]);

    assert_eq!(
        light.client.try_verify_transaction(
            &block_hash,
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, b"some_bitcoin_transaction"),
            &1
        ),
        Err(Ok(SPVError::MerkleProofInvalid)),
    );
}

#[test]
fn error_header_not_found() {
    let env = Env::default();
    let light = new_light(&env);

    assert_eq!(
        light.client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &[0x42u8; 32]),
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, b"tx"),
            &1
        ),
        Err(Ok(SPVError::HeaderNotFound)),
    );
}

#[test]
fn error_block_not_after_checkpoint() {
    let env = Env::default();
    let light = new_light(&env);

    assert_eq!(
        light.client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &CP_HASH),
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, b"tx"),
            &1
        ),
        Err(Ok(SPVError::BlockNotAfterCheckpoint)),
    );
}

/// Regression for the inner-node forgery: the 64-byte preimage of a real
/// Merkle inner node must never be accepted as a transaction, even when the
/// header chain is genuine.
#[test]
fn error_64_byte_raw_tx_rejected_as_merkle_inner_node() {
    let env = Env::default();
    let light = new_light(&env);

    let inner_node_preimage = [0x5au8; 64];
    let fake_txid = sha256d_bytes(&env, &inner_node_preimage);
    let block_hash = submit_single_block(&env, &light, fake_txid);

    assert_eq!(
        light.client.try_verify_transaction(
            &block_hash,
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, &inner_node_preimage),
            &1
        ),
        Err(Ok(SPVError::AmbiguousTransactionLength)),
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Invariant tests
// ══════════════════════════════════════════════════════════════════════════════

/// `result.confirmations` is the block's real depth under the best tip.
#[test]
fn confirmations_equals_depth_under_best_tip() {
    let env = Env::default();
    for extra in [0u32, 1, 5, 11] {
        let result = run_full_verification(&env, 1, 0, extra, 1).expect("should succeed");
        assert_eq!(result.confirmations, 1 + extra, "extra={}", extra);
    }
}

/// `result.block_hash` must equal the hash of the header that holds the tx.
#[test]
fn block_hash_equals_hash_of_containing_header() {
    let env = Env::default();

    let raw_txs: std::vec::Vec<std::vec::Vec<u8>> = (0..2usize)
        .map(|i| {
            let mut v = std::vec![0x01u8, 0x00, 0x00, 0x00];
            v.extend_from_slice(&[i as u8; 8]);
            v
        })
        .collect();
    let txids: std::vec::Vec<[u8; 32]> =
        raw_txs.iter().map(|tx| sha256d_bytes(&env, tx)).collect();
    let root = compute_merkle_root(&env, &txids);
    // mine_chain is deterministic for identical inputs, so this reproduces
    // exactly the block header built inside run_full_verification.
    let h0 = mine_chain(&env, &CP_HASH, &[root], T0 + 1).remove(0);

    let result = run_full_verification(&env, 2, 0, 0, 1).expect("should succeed");
    assert_eq!(result.block_hash, hash_header(&env, &h0));
}

/// `result.txid` must equal SHA256d of the raw transaction bytes.
#[test]
fn txid_equals_sha256d_of_raw_tx() {
    let env = Env::default();

    // tx_count=1, tx_index=0 → raw_tx = [0x01,0x00,0x00,0x00, 0x00,0x00,...0x00]
    let raw: std::vec::Vec<u8> = {
        let mut v = std::vec![0x01u8, 0x00, 0x00, 0x00];
        v.extend_from_slice(&[0u8; 8]);
        v
    };
    let expected_txid = sha256d_bytes(&env, &raw);

    let result = run_full_verification(&env, 1, 0, 0, 1).expect("should succeed");
    assert_eq!(result.txid.to_array(), expected_txid);
}

// ══════════════════════════════════════════════════════════════════════════════
// Admin / checkpoint / submitter tests
// ══════════════════════════════════════════════════════════════════════════════

#[test]
fn initialize_then_double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin, &EASY_TEST_BITS);
    assert_eq!(
        client.try_initialize(&admin, &EASY_TEST_BITS),
        Err(Ok(SPVError::AlreadyInitialized)),
    );
}

#[test]
fn initialize_rejects_invalid_pow_limit_bits() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);

    assert_eq!(
        client.try_initialize(&admin, &0xff12_3456u32),
        Err(Ok(SPVError::InvalidDifficultyBits)),
    );
}

#[test]
fn set_checkpoint_by_admin_seeds_the_light_client() {
    let env = Env::default();
    let light = new_light(&env);

    let checkpoint = light.client.get_checkpoint().expect("checkpoint must be set");
    assert_eq!(checkpoint.height, CP_HEIGHT);
    assert_eq!(checkpoint.block_hash, BytesN::<32>::from_array(&env, &CP_HASH));
    assert_eq!(checkpoint.bits, EASY_TEST_BITS);
    assert_eq!(checkpoint.time, T0);

    let tip = light.client.get_best_tip().expect("best tip");
    assert_eq!(tip.height, CP_HEIGHT);
    assert_eq!(tip.hash, BytesN::<32>::from_array(&env, &CP_HASH));
    assert_eq!(
        light.client.get_canonical_hash(&CP_HEIGHT),
        Some(BytesN::<32>::from_array(&env, &CP_HASH)),
    );
}

/// The trust root is set once; the admin cannot swap it for another chain
/// after headers have been accepted on top of it.
#[test]
fn set_checkpoint_twice_fails() {
    let env = Env::default();
    let light = new_light(&env);

    assert_eq!(
        light.client.try_set_checkpoint(
            &light.admin,
            &(CP_HEIGHT + 1),
            &BytesN::<32>::from_array(&env, &[0x99u8; 32]),
            &EASY_TEST_BITS,
            &T0,
            &T0,
        ),
        Err(Ok(SPVError::CheckpointAlreadySet)),
    );
}

#[test]
fn set_checkpoint_by_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    let rando = Address::generate(&env);
    client.initialize(&admin, &EASY_TEST_BITS);

    assert_eq!(
        client.try_set_checkpoint(
            &rando,
            &0u32,
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &EASY_TEST_BITS,
            &T0,
            &T0,
        ),
        Err(Ok(SPVError::Unauthorized)),
    );
}

#[test]
fn set_checkpoint_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);

    assert_eq!(
        client.try_set_checkpoint(
            &admin,
            &0u32,
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &EASY_TEST_BITS,
            &T0,
            &T0,
        ),
        Err(Ok(SPVError::NotInitialized)),
    );
}

#[test]
fn set_checkpoint_rejects_invalid_bits() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    client.initialize(&admin, &EASY_TEST_BITS);

    assert_eq!(
        client.try_set_checkpoint(
            &admin,
            &0u32,
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &0xff12_3456u32,
            &T0,
            &T0,
        ),
        Err(Ok(SPVError::InvalidDifficultyBits)),
    );
}

#[test]
fn set_checkpoint_rejects_bits_easier_than_pow_limit_and_bad_period_start() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    client.initialize(&admin, &0x2007_ffffu32);
    let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);

    assert_eq!(
        client.try_set_checkpoint(&admin, &0u32, &hash, &EASY_TEST_BITS, &T0, &T0),
        Err(Ok(SPVError::InvalidCheckpoint)),
    );
    assert_eq!(
        client.try_set_checkpoint(&admin, &0u32, &hash, &0x2007_ffffu32, &T0, &(T0 + 1)),
        Err(Ok(SPVError::InvalidCheckpoint)),
    );
}

#[test]
fn set_admin_by_admin_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &EASY_TEST_BITS);

    client.set_admin(&admin, &new_admin);

    // The old admin can no longer set the checkpoint; the new one can.
    let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
    assert_eq!(
        client.try_set_checkpoint(&admin, &0u32, &hash, &EASY_TEST_BITS, &T0, &T0),
        Err(Ok(SPVError::Unauthorized)),
    );
    client.set_checkpoint(&new_admin, &0u32, &hash, &EASY_TEST_BITS, &T0, &T0);
}

#[test]
fn set_admin_by_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    let rando = Address::generate(&env);
    client.initialize(&admin, &EASY_TEST_BITS);

    assert_eq!(
        client.try_set_admin(&rando, &rando),
        Err(Ok(SPVError::Unauthorized)),
    );
}

#[test]
fn set_submitter_by_non_admin_fails() {
    let env = Env::default();
    let light = new_light(&env);
    let rando = Address::generate(&env);

    assert_eq!(
        light.client.try_set_submitter(&rando, &Some(rando.clone())),
        Err(Ok(SPVError::Unauthorized)),
    );
}

/// With a submitter configured, `submit_headers` demands that address's
/// authorization; clearing it reopens submission to everyone.
#[test]
fn submit_headers_requires_submitter_auth_when_configured() {
    let env = Env::default();
    let light = new_light(&env);
    let submitter = Address::generate(&env);
    light.client.set_submitter(&light.admin, &Some(submitter.clone()));

    let headers = mine_chain(&env, &CP_HASH, &[[1u8; 32]], T0 + 1);
    light.client.submit_headers(&to_sdk_headers(&env, &headers));
    assert!(
        env.auths().iter().any(|(addr, _)| *addr == submitter),
        "submit_headers must require the configured submitter's auth"
    );

    light.client.set_submitter(&light.admin, &None);
    let more = mine_chain(
        &env,
        &hash_header(&env, &headers[0]).to_array(),
        &[[2u8; 32]],
        T0 + 2,
    );
    light.client.submit_headers(&to_sdk_headers(&env, &more));
    assert!(
        env.auths().is_empty(),
        "with no submitter configured, no authorization is required"
    );
}

#[test]
fn refresh_ttl_does_not_panic_before_any_state_is_set() {
    // Permissionless and unconditional: storage::refresh_ttl guards each
    // entry with `.has()` before extending, so calling it against a
    // freshly-deployed, uninitialized contract must be a no-op, not a panic.
    let env = Env::default();
    let client = new_uninitialized_client(&env);
    client.refresh_ttl();
}

#[test]
fn refresh_ttl_keeps_the_light_client_readable() {
    let env = Env::default();
    let light = new_light(&env);

    light.client.refresh_ttl();

    assert!(light.client.get_checkpoint().is_some());
    assert!(light.client.get_best_tip().is_some());
}

#[test]
fn verify_transaction_before_initialize_fails() {
    let env = Env::default();
    let client = new_uninitialized_client(&env);

    assert_eq!(
        client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, b"tx"),
            &1
        ),
        Err(Ok(SPVError::NotInitialized)),
    );
}

#[test]
fn verify_transaction_before_checkpoint_set_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let admin = Address::generate(&env);
    client.initialize(&admin, &EASY_TEST_BITS);

    assert_eq!(
        client.try_verify_transaction(
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
            &Vec::new(&env),
            &0,
            &Bytes::from_slice(&env, b"tx"),
            &1
        ),
        Err(Ok(SPVError::CheckpointNotSet)),
    );
}

#[test]
fn submit_headers_before_initialize_or_checkpoint_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = new_uninitialized_client(&env);
    let header = mine_valid_header(&env, &CP_HASH, &[1u8; 32], T0 + 1);
    let sdk = to_sdk_headers(&env, &[header]);

    assert_eq!(client.try_submit_headers(&sdk), Err(Ok(SPVError::NotInitialized)));

    client.initialize(&Address::generate(&env), &EASY_TEST_BITS);
    assert_eq!(client.try_submit_headers(&sdk), Err(Ok(SPVError::CheckpointNotSet)));
}

// ══════════════════════════════════════════════════════════════════════════════
// Utility
// ══════════════════════════════════════════════════════════════════════════════

/// Decodes a 64-character lowercase hex string into a `[u8; 32]`.
fn hex32(s: &str) -> [u8; 32] {
    assert_eq!(s.len(), 64);
    let mut out = [0u8; 32];
    for (i, c) in s.as_bytes().chunks(2).enumerate() {
        out[i] = (nibble(c[0]) << 4) | nibble(c[1]);
    }
    out
}

fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("bad hex char '{}'", c as char),
    }
}
