use soroban_sdk::{Bytes, BytesN, Env, Vec};

use crate::crypto::sha256d;
use crate::error::SPVError;

// ── Bitcoin block header layout (80 bytes) ──────────────────────────────────
//  Offset  Length  Field
//  0       4       version         (little-endian i32)
//  4       32      prev_block_hash (internal byte order)
//  36      32      merkle_root     (internal byte order)
//  68      4       time            (little-endian u32, Unix timestamp)
//  72      4       bits            (compact difficulty target)
//  76      4       nonce           (little-endian u32)
// ────────────────────────────────────────────────────────────────────────────

const HEADER_LEN: usize = 80;
const PREV_HASH_OFFSET: usize = 4;
const MERKLE_ROOT_OFFSET: usize = 36;
const HASH_LEN: usize = 32;

/// Computes SHA256d of an 80-byte block header, returning the block hash in
/// internal (little-endian) byte order — the format used in the
/// `prev_block_hash` field of the subsequent header.
pub fn hash_header(env: &Env, header: &BytesN<80>) -> BytesN<32> {
    let raw: Bytes = header.clone().into();
    sha256d(env, &raw)
}

/// Extracts a 32-byte sub-field from a fixed offset within an 80-byte header.
///
/// # Panics
///
/// Panics if the slice bounds are out of range — impossible given a valid
/// `BytesN<80>` and offsets defined as constants in this module.
fn extract_32_bytes(env: &Env, header: &BytesN<80>, offset: usize) -> BytesN<32> {
    let arr: [u8; HEADER_LEN] = header.to_array();
    let mut buf = [0u8; HASH_LEN];
    buf.copy_from_slice(&arr[offset..offset + HASH_LEN]);
    BytesN::<32>::from_array(env, &buf)
}

/// Returns the `prev_block_hash` field (bytes 4..36) of a header.
pub fn prev_hash_of(env: &Env, header: &BytesN<80>) -> BytesN<32> {
    extract_32_bytes(env, header, PREV_HASH_OFFSET)
}

/// Returns the `merkle_root` field (bytes 36..68) of a header.
pub fn merkle_root_of(env: &Env, header: &BytesN<80>) -> BytesN<32> {
    extract_32_bytes(env, header, MERKLE_ROOT_OFFSET)
}

/// Validates a chain of block headers and returns the hash of `headers[0]`.
///
/// Each header's `prev_block_hash` must equal SHA256d of the preceding
/// header. This binds every header to real proof-of-work expended on
/// Bitcoin, making fabrication computationally infeasible.
///
/// # Arguments
///
/// - `headers`: One or more 80-byte Bitcoin block headers ordered oldest
///   (the block containing the proven transaction) to newest.
///
/// # Returns
///
/// SHA256d of `headers[0]` — the hash of the block containing the transaction.
/// Returns [`SPVError::HeaderChainBroken`] if any link is invalid.
pub fn validate_header_chain(
    env: &Env,
    headers: &Vec<BytesN<80>>,
) -> Result<BytesN<32>, SPVError> {
    let first = headers.get(0).unwrap();
    let first_hash = hash_header(env, &first);

    // prev_of_next must equal the hash we just computed.
    let mut expected_prev = first_hash.clone();

    for i in 1..headers.len() {
        let header = headers.get(i).unwrap();
        let declared_prev = prev_hash_of(env, &header);

        if declared_prev != expected_prev {
            return Err(SPVError::HeaderChainBroken);
        }

        expected_prev = hash_header(env, &header);
    }

    Ok(first_hash)
}
