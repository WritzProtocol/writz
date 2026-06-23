#![cfg(test)]

extern crate std;

use soroban_sdk::{Bytes, BytesN, Env, Vec};

use crate::{BitcoinSpvContract, BitcoinSpvContractClient, SPVError, VerificationResult};
use crate::crypto::{hash_merkle_pair, sha256d};
use crate::header::{hash_header, validate_header_chain};
use crate::merkle::verify_merkle_inclusion;

// ══════════════════════════════════════════════════════════════════════════════
// Test helpers
// ══════════════════════════════════════════════════════════════════════════════

/// Builds an 80-byte Bitcoin block header. Bytes not covered by arguments are zero.
///
/// Layout:
///   [0..4]   version       (little-endian i32)
///   [4..36]  prev_hash     (32 bytes, internal byte order)
///   [36..68] merkle_root   (32 bytes, internal byte order)
///   [68..72] time          (little-endian u32)
///   [72..80] bits, nonce   (zeroed)
fn make_header(
    env: &Env,
    version: i32,
    prev_hash: &[u8; 32],
    merkle_root: &[u8; 32],
    time: u32,
) -> BytesN<80> {
    let mut buf = [0u8; 80];
    buf[0..4].copy_from_slice(&version.to_le_bytes());
    buf[4..36].copy_from_slice(prev_hash);
    buf[36..68].copy_from_slice(merkle_root);
    buf[68..72].copy_from_slice(&time.to_le_bytes());
    BytesN::<80>::from_array(env, &buf)
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

/// Builds a complete, self-consistent SPV scenario and runs `verify_transaction`.
///
/// - `tx_count`: number of transactions in the block.
/// - `tx_index`: which transaction to prove (0-based).
/// - `extra_headers`: confirmation headers appended after the block header.
/// - `min_confirmations`: value passed to the contract.
fn run_full_verification(
    env: &Env,
    tx_count: usize,
    tx_index: usize,
    extra_headers: u32,
    min_confirmations: u32,
) -> Result<VerificationResult, SPVError> {
    let contract_id = env.register(BitcoinSpvContract, ());
    let client = BitcoinSpvContractClient::new(env, &contract_id);

    // Build minimal raw transactions.
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

    // Block header (genesis-style prev_hash = zeroes).
    let h0 = make_header(env, 1, &[0u8; 32], &merkle_root, 1_700_000_000);

    let mut headers: Vec<BytesN<80>> = Vec::new(env);
    headers.push_back(h0.clone());

    let mut prev_hash = hash_header(env, &h0).to_array();
    for k in 0..extra_headers {
        let conf = make_header(env, 1, &prev_hash, &[k as u8; 32], 1_700_000_001 + k);
        prev_hash = hash_header(env, &conf).to_array();
        headers.push_back(conf);
    }

    let raw_tx_sdk = Bytes::from_slice(env, &raw_txs[tx_index]);
    let proof_sdk = to_sdk_proof(env, &merkle_proof);

    // SDK 26: try_* returns Result<Result<T, ConversionError>, Result<E, InvokeError>>.
    // Flatten to Result<T, E>, panicking on unexpected invocation errors.
    match client.try_verify_transaction(
        &headers,
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
// Header chain unit tests
// ══════════════════════════════════════════════════════════════════════════════

/// Single header: trivially valid; returned value equals SHA256d of that header.
#[test]
fn header_chain_single_header() {
    let env = Env::default();
    let h = make_header(&env, 1, &[0u8; 32], &[1u8; 32], 1_700_000_000);
    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(h.clone());

    let result = validate_header_chain(&env, &headers).expect("single header must validate");
    assert_eq!(result, hash_header(&env, &h));
}

/// Two headers with a correct `prev_block_hash` link must validate.
#[test]
fn header_chain_two_valid_headers() {
    let env = Env::default();
    let h0 = make_header(&env, 1, &[0u8; 32], &[1u8; 32], 1_700_000_000);
    let h0_hash = hash_header(&env, &h0).to_array();
    let h1 = make_header(&env, 1, &h0_hash, &[2u8; 32], 1_700_000_001);

    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(h0.clone());
    headers.push_back(h1);

    let block_hash = validate_header_chain(&env, &headers)
        .expect("two headers with correct link must validate");
    assert_eq!(block_hash, hash_header(&env, &h0));
}

/// Incorrect `prev_block_hash` in h1 must return HeaderChainBroken.
#[test]
fn header_chain_broken_link_rejected() {
    let env = Env::default();
    let h0 = make_header(&env, 1, &[0u8; 32], &[1u8; 32], 1_700_000_000);
    let wrong_prev = [0xdeu8; 32]; // ≠ SHA256d(h0)
    let h1 = make_header(&env, 1, &wrong_prev, &[2u8; 32], 1_700_000_001);

    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(h0);
    headers.push_back(h1);

    assert_eq!(
        validate_header_chain(&env, &headers),
        Err(SPVError::HeaderChainBroken)
    );
}

/// Break only the last link in a three-header chain.
#[test]
fn header_chain_last_link_broken() {
    let env = Env::default();
    let h0 = make_header(&env, 1, &[0u8; 32], &[1u8; 32], 1_700_000_000);
    let h0_hash = hash_header(&env, &h0).to_array();
    let h1 = make_header(&env, 1, &h0_hash, &[2u8; 32], 1_700_000_001);
    // h2 incorrectly points to h0 instead of h1.
    let h2 = make_header(&env, 1, &h0_hash, &[3u8; 32], 1_700_000_002);

    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(h0);
    headers.push_back(h1);
    headers.push_back(h2);

    assert_eq!(
        validate_header_chain(&env, &headers),
        Err(SPVError::HeaderChainBroken)
    );
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
// Error path tests via the contract client
// ══════════════════════════════════════════════════════════════════════════════

fn new_client(env: &Env) -> BitcoinSpvContractClient<'_> {
    let id = env.register(BitcoinSpvContract, ());
    BitcoinSpvContractClient::new(env, &id)
}

#[test]
fn error_zero_min_confirmations() {
    let env = Env::default();
    let client = new_client(&env);
    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    let root = sha256d_bytes(&env, b"tx");
    headers.push_back(make_header(&env, 1, &[0u8; 32], &root, 0));
    let raw_tx = Bytes::from_slice(&env, b"tx");
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &raw_tx, &0),
        Err(Ok(SPVError::ZeroMinConfirmations)),
    );
}

#[test]
fn error_no_headers() {
    let env = Env::default();
    let client = new_client(&env);
    let headers: Vec<BytesN<80>> = Vec::new(&env);
    let raw_tx = Bytes::from_slice(&env, b"tx");
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &raw_tx, &1),
        Err(Ok(SPVError::NoHeaders)),
    );
}

#[test]
fn error_insufficient_confirmations() {
    let env = Env::default();
    let client = new_client(&env);
    let txid = sha256d_bytes(&env, b"tx");
    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(make_header(&env, 1, &[0u8; 32], &txid, 0));
    let raw_tx = Bytes::from_slice(&env, b"tx");
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    // 1 header supplied, but 6 required.
    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &raw_tx, &6),
        Err(Ok(SPVError::InsufficientConfirmations)),
    );
}

#[test]
fn error_empty_transaction() {
    let env = Env::default();
    let client = new_client(&env);
    let root = sha256d_bytes(&env, b"tx");
    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(make_header(&env, 1, &[0u8; 32], &root, 0));
    let empty_tx = Bytes::new(&env);
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &empty_tx, &1),
        Err(Ok(SPVError::EmptyTransaction)),
    );
}

#[test]
fn error_merkle_proof_invalid() {
    let env = Env::default();
    let client = new_client(&env);
    let raw_tx = b"some_bitcoin_transaction";
    // Header declares a different Merkle root than SHA256d(raw_tx) — proof will fail.
    let wrong_root = [0xabu8; 32];
    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(make_header(&env, 1, &[0u8; 32], &wrong_root, 0));
    let raw_tx_sdk = Bytes::from_slice(&env, raw_tx);
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &raw_tx_sdk, &1),
        Err(Ok(SPVError::MerkleProofInvalid)),
    );
}

#[test]
fn error_header_chain_broken() {
    let env = Env::default();
    let client = new_client(&env);

    let raw_tx = b"btc_tx";
    let txid = sha256d_bytes(&env, raw_tx);

    let h0 = make_header(&env, 1, &[0u8; 32], &txid, 0);
    // h1 references a random prev_hash, not SHA256d(h0).
    let h1 = make_header(&env, 1, &[0xbbu8; 32], &txid, 1);

    let mut headers: Vec<BytesN<80>> = Vec::new(&env);
    headers.push_back(h0);
    headers.push_back(h1);

    let raw_tx_sdk = Bytes::from_slice(&env, raw_tx);
    let proof: Vec<BytesN<32>> = Vec::new(&env);

    assert_eq!(
        client.try_verify_transaction(&headers, &proof, &0, &raw_tx_sdk, &2),
        Err(Ok(SPVError::HeaderChainBroken)),
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Invariant tests
// ══════════════════════════════════════════════════════════════════════════════

/// `result.confirmations` must always equal the number of headers supplied.
#[test]
fn confirmations_equals_header_count() {
    let env = Env::default();
    for extra in [0u32, 1, 5, 11] {
        let result = run_full_verification(&env, 1, 0, extra, 1 + extra)
            .expect("should succeed");
        assert_eq!(result.confirmations, 1 + extra, "extra={}", extra);
    }
}

/// `result.block_hash` must equal SHA256d of `headers[0]`.
#[test]
fn block_hash_equals_sha256d_of_first_header() {
    let env = Env::default();

    // Reconstruct what the first header looks like inside `run_full_verification`.
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
    let h0 = make_header(&env, 1, &[0u8; 32], &root, 1_700_000_000);

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
