//! Bitcoin transaction output parser for Soroban (`no_std`).
//!
//! The same parser Writz Lend runs on chain (`spv-types::btc_parser` in the
//! Writz repository); the tests check that both return the same values.

use soroban_sdk::Bytes;

/// Scans the outputs of a raw Bitcoin transaction and returns the satoshi
/// value of the first output whose scriptPubKey equals `expected_spk`.
///
/// It compares raw scriptPubKey bytes, so it works for any script type
/// (P2WPKH `0014...`, P2WSH `0020...`, P2TR `5120...`, P2PKH, ...).
///
/// Returns `None` if no matching output is found, or if the transaction
/// bytes are malformed / truncated.
///
/// Accepts both legacy (pre-SegWit) and SegWit serializations; any SegWit
/// marker+flag bytes found at offset 4 are skipped defensively.
pub fn find_output_value(raw_tx: &Bytes, expected_spk: &Bytes) -> Option<u64> {
    let len = raw_tx.len();
    let mut pos: u32 = 0;

    if len < 5 {
        return None;
    }
    pos += 4; // skip version (4 bytes)

    // SegWit marker (0x00) + flag (0x01).
    if get_byte(raw_tx, pos)? == 0x00 && get_byte(raw_tx, pos + 1)? == 0x01 {
        pos += 2;
    }

    // Input count.
    let (input_count, sz) = read_varint(raw_tx, pos)?;
    pos += sz;

    // Skip inputs: prev_hash (32) + prev_index (4) + scriptSig + sequence (4).
    for _ in 0..input_count {
        if pos + 36 > len {
            return None;
        }
        pos += 36;
        let (script_len, sz) = read_varint(raw_tx, pos)?;
        pos += sz;
        pos = pos.checked_add(script_len)?;
        if pos + 4 > len {
            return None;
        }
        pos += 4;
    }

    // Output count.
    let (output_count, sz) = read_varint(raw_tx, pos)?;
    pos += sz;

    // Parse outputs.
    for _ in 0..output_count {
        // value: 8-byte little-endian u64.
        if pos + 8 > len {
            return None;
        }
        let value = read_u64_le(raw_tx, pos)?;
        pos += 8;

        // scriptPubKey: varint length + bytes.
        let (spk_len, sz) = read_varint(raw_tx, pos)?;
        pos += sz;
        let spk_end = pos.checked_add(spk_len)?;
        if spk_end > len {
            return None;
        }

        let spk_slice = raw_tx.slice(pos..spk_end);
        if spk_slice == *expected_spk {
            return Some(value);
        }
        pos = spk_end;
    }

    None
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Returns the byte at `offset` in `data`, or `None` if out of range.
fn get_byte(data: &Bytes, offset: u32) -> Option<u8> {
    data.get(offset)
}

/// Reads a Bitcoin variable-length integer from `data` at `offset`.
/// Returns `(value, byte_count)` or `None` on truncation.
fn read_varint(data: &Bytes, offset: u32) -> Option<(u32, u32)> {
    let first = get_byte(data, offset)?;
    match first {
        0x00..=0xfc => Some((first as u32, 1)),
        0xfd => {
            let lo = get_byte(data, offset + 1)? as u32;
            let hi = get_byte(data, offset + 2)? as u32;
            Some(((hi << 8) | lo, 3))
        }
        // 0xfe / 0xff: 4- or 8-byte varints not expected in tx I/O counts.
        _ => None,
    }
}

/// Reads an 8-byte little-endian u64 from `data` at `offset`.
fn read_u64_le(data: &Bytes, offset: u32) -> Option<u64> {
    let mut val = 0u64;
    for i in 0..8u32 {
        val |= (get_byte(data, offset + i)? as u64) << (i * 8);
    }
    Some(val)
}
