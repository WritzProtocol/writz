use soroban_sdk::{Bytes, BytesN, Env, U256};

use crate::error::SPVError;
use crate::header::{bits_of, hash_header};
use crate::types::HeaderEntry;

/// Blocks per difficulty period (Bitcoin consensus).
pub const RETARGET_INTERVAL: u32 = 2016;

/// Intended duration of a difficulty period, in seconds (two weeks).
const TARGET_TIMESPAN: i64 = 14 * 24 * 60 * 60;

/// Converts a raw SHA256d digest into a `U256` using the same integer
/// interpretation Bitcoin's consensus rules use for the proof-of-work check.
///
/// A SHA256d digest, as produced by [`crate::header::hash_header`], is in
/// "internal" byte order: byte 0 of the digest is the **least-significant**
/// byte of the 256-bit integer Bitcoin compares against the difficulty
/// target. This is the reverse of the conventional, human-readable hex
/// string shown on a block explorer (which prints the digest bytes
/// most-significant-first). `soroban-sdk`'s `U256::from_be_bytes` expects
/// its input most-significant-byte-first, so the digest must be reversed
/// before conversion.
///
/// Equivalently: `hash_as_u256(hash)` is defined to equal
/// `U256::from_be_bytes` applied to the conventional/display hex string of
/// that same hash - an ordinary big-endian number, exactly as a human would
/// read a block hash from an explorer.
pub fn hash_as_u256(env: &Env, hash: &BytesN<32>) -> U256 {
    let mut arr = hash.to_array();
    arr.reverse();
    U256::from_be_bytes(env, &Bytes::from_array(env, &arr))
}

/// Decodes Bitcoin's "compact" difficulty representation (the `bits` header
/// field) into the full 256-bit target a block hash must be below.
///
/// This replicates Bitcoin Core's `arith_uint256::SetCompact` exactly,
/// including its negative/overflow edge cases - a naive
/// `mantissa << 8*(exponent-3)` shift is not sufficient, since it would
/// silently miscompute (rather than reject) a malformed `bits` value.
/// `U256::checked_shl` in this SDK only guards against `bits >= 256`; it
/// does not detect magnitude overflow of the shifted value (excess high
/// bits are simply dropped). The overflow/negative checks below therefore
/// run in plain `u32` arithmetic *before* any `U256` operation, so the
/// eventual shift is only ever performed once it's proven safe.
///
/// Returns [`SPVError::InvalidDifficultyBits`] for a negative or
/// overflowing target, matching bitcoind's own validation.
pub fn bits_to_target(env: &Env, bits: u32) -> Result<U256, SPVError> {
    let exponent = (bits >> 24) & 0xff;
    let mantissa = bits & 0x007f_ffff;
    let sign_bit_set = bits & 0x0080_0000 != 0;

    if mantissa != 0 && sign_bit_set {
        return Err(SPVError::InvalidDifficultyBits);
    }

    let overflow = mantissa != 0
        && (exponent > 34 || (mantissa > 0xff && exponent > 33) || (mantissa > 0xffff && exponent > 32));
    if overflow {
        return Err(SPVError::InvalidDifficultyBits);
    }

    if mantissa == 0 {
        // Inherited from Bitcoin Core: a header can syntactically encode a
        // zero target. No hash can ever satisfy `hash < 0`, so this is
        // correctly rejected downstream by InsufficientProofOfWork, not
        // treated as malformed input here.
        return Ok(U256::from_u32(env, 0));
    }

    let mantissa_u256 = U256::from_u32(env, mantissa);
    Ok(if exponent <= 3 {
        mantissa_u256.shr(8 * (3 - exponent))
    } else {
        mantissa_u256.shl(8 * (exponent - 3))
    })
}

/// Verifies that a header's proof-of-work satisfies its own declared
/// difficulty target: `SHA256d(header) < target(header.bits)`.
///
/// This is the check that prevents an attacker from fabricating a chain of
/// headers with no real Bitcoin mining behind them.
pub fn validate_proof_of_work(env: &Env, header: &BytesN<80>) -> Result<(), SPVError> {
    let target = bits_to_target(env, bits_of(header))?;
    let hash_int = hash_as_u256(env, &hash_header(env, header));

    if hash_int < target {
        Ok(())
    } else {
        Err(SPVError::InsufficientProofOfWork)
    }
}

/// Work represented by a target: `floor(2^256 / (target + 1))`, computed as
/// `(MAX - target) / (target + 1) + 1` so it never overflows 256 bits
/// (same formula as Bitcoin Core's `GetBlockProof`).
pub fn work_from_target(env: &Env, target: &U256) -> U256 {
    let max = U256::from_be_bytes(env, &Bytes::from_array(env, &[0xffu8; 32]));
    let one = U256::from_u32(env, 1);
    max.sub(target).div(&target.add(&one)).add(&one)
}

/// Encodes a 256-bit target into Bitcoin's compact `bits` form, mirroring
/// `arith_uint256::GetCompact` (including its mantissa truncation and the
/// sign-bit adjustment). Retargets must reproduce this exactly, otherwise a
/// valid header would not match the expected `bits`.
pub fn target_to_bits(target: &U256) -> u32 {
    let mut arr = [0u8; 32];
    target.to_be_bytes().copy_into_slice(&mut arr);

    let first_nonzero = arr.iter().position(|b| *b != 0);
    let Some(first) = first_nonzero else {
        return 0;
    };
    let bit_len = (32 - first) * 8 - arr[first].leading_zeros() as usize;
    let mut size = bit_len.div_ceil(8) as u32;

    let mut compact: u32 = if size <= 3 {
        let low = target.to_u128().unwrap_or(0) as u32;
        low << (8 * (3 - size))
    } else {
        let shifted = target.shr(8 * (size - 3));
        shifted.to_u128().unwrap_or(0) as u32
    };

    if compact & 0x0080_0000 != 0 {
        compact >>= 8;
        size += 1;
    }
    compact | (size << 24)
}

/// The `bits` a header at `height` must carry given its parent, per
/// Bitcoin's difficulty rules: unchanged inside a period, and at each
/// 2016-block boundary `parent_target * clamp(timespan, 1/4, 4x) / 2 weeks`,
/// capped at the network's proof-of-work limit.
///
/// Does not model testnet3/testnet4's minimum-difficulty exception; only
/// mainnet and signet are supported. If `parent_target * timespan` overflows
/// 256 bits (targets above ~2^233, which real mainnet and signet targets are
/// far below) the result is capped at the proof-of-work limit.
pub fn expected_bits(
    env: &Env,
    parent: &HeaderEntry,
    height: u32,
    pow_limit: &U256,
) -> Result<u32, SPVError> {
    if height % RETARGET_INTERVAL != 0 {
        return Ok(parent.bits);
    }

    let timespan = (parent.time as i64 - parent.period_start_time as i64)
        .clamp(TARGET_TIMESPAN / 4, TARGET_TIMESPAN * 4);

    let parent_target = bits_to_target(env, parent.bits)?;
    let scaled = parent_target
        .checked_mul(&U256::from_u32(env, timespan as u32))
        .map(|v| v.div(&U256::from_u32(env, TARGET_TIMESPAN as u32)));

    let new_target = match scaled {
        Some(t) if t <= *pow_limit => t,
        _ => pow_limit.clone(),
    };
    Ok(target_to_bits(&new_target))
}
