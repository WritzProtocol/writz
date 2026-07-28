use soroban_sdk::{Bytes, BytesN, Env, U256};

use crate::error::SPVError;
use crate::header::{bits_of, hash_header};

/// How many bits easier than the checkpoint's difficulty a submitted
/// header's target is allowed to be. `6` (64×) is a compiled
/// constant, not an admin-configurable value, so the admin cannot relax the
/// band far enough to defeat the anchor: real Bitcoin consensus caps
/// difficulty *decrease* at 4× per 2016-block retarget period, so 64× is
/// already a generous multi-period buffer for checkpoint staleness, not a
/// value that should routinely need tuning.
pub const MAX_DIFFICULTY_EASE_SHIFT: u32 = 6;

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
/// that same hash — an ordinary big-endian number, exactly as a human would
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
/// including its negative/overflow edge cases — a naive
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
