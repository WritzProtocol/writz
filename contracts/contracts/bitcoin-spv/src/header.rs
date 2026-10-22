use soroban_sdk::{Bytes, BytesN, Env};

use crate::crypto::sha256d;

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
const TIME_OFFSET: usize = 68;
const BITS_OFFSET: usize = 72;
const HASH_LEN: usize = 32;

/// Computes SHA256d of an 80-byte block header, returning the block hash in
/// internal (little-endian) byte order - the format used in the
/// `prev_block_hash` field of the subsequent header.
pub fn hash_header(env: &Env, header: &BytesN<80>) -> BytesN<32> {
    let raw: Bytes = header.clone().into();
    sha256d(env, &raw)
}

/// Extracts a 32-byte sub-field from a fixed offset within an 80-byte header.
///
/// # Panics
///
/// Panics if the slice bounds are out of range - impossible given a valid
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

/// Returns the `time` field (bytes 68..72) of a header as a little-endian
/// `u32` Unix timestamp.
pub fn time_of(header: &BytesN<80>) -> u32 {
    let arr: [u8; HEADER_LEN] = header.to_array();
    u32::from_le_bytes([
        arr[TIME_OFFSET],
        arr[TIME_OFFSET + 1],
        arr[TIME_OFFSET + 2],
        arr[TIME_OFFSET + 3],
    ])
}

/// Returns the `bits` field (bytes 72..76) of a header as a little-endian
/// `u32` - the packed "compact" difficulty target. Unlike `extract_32_bytes`,
/// this returns a plain integer rather than an SDK wrapper type, so it needs
/// no `env` parameter. See [`crate::difficulty::bits_to_target`] for decoding
/// this into an actual 256-bit target.
pub fn bits_of(header: &BytesN<80>) -> u32 {
    let arr: [u8; HEADER_LEN] = header.to_array();
    u32::from_le_bytes([
        arr[BITS_OFFSET],
        arr[BITS_OFFSET + 1],
        arr[BITS_OFFSET + 2],
        arr[BITS_OFFSET + 3],
    ])
}
