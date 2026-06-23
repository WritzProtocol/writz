/// Bitcoin transaction output parser for Soroban (`no_std`).
///
/// All byte access goes through `soroban_sdk::Bytes::get(index)` which
/// crosses the host-contract ABI boundary.  This is intentionally slower
/// than slice-based parsing — we call this at most once per deposit and
/// the overhead is negligible compared to the SPV cross-contract call.

use soroban_sdk::Bytes;

/// Scans the outputs of a raw Bitcoin transaction and returns the satoshi
/// value of the first output whose scriptPubKey equals `expected_spk`.
///
/// Returns `None` if no matching output is found, or if the transaction
/// bytes are malformed / truncated.
///
/// Accepts both legacy (pre-SegWit) and SegWit serializations; any SegWit
/// marker+flag bytes found at offset 4 are skipped defensively.
pub fn find_p2wsh_output(raw_tx: &Bytes, expected_spk: &Bytes) -> Option<u64> {
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
    // Bytes::get returns Option<u32>; the value is always in the u8 range.
    Some(data.get(offset)? as u8)
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;
    use std::vec;
    use std::vec::Vec;

    use soroban_sdk::{Bytes, Env};

    use super::find_p2wsh_output;

    fn env() -> Env {
        Env::default()
    }

    // Build a minimal legacy Bitcoin transaction with the given outputs.
    fn build_legacy_tx(outputs: &[(u64, &[u8])]) -> Vec<u8> {
        let mut tx = Vec::new();
        tx.extend_from_slice(&1u32.to_le_bytes()); // version
        tx.push(0x01); // 1 input
        tx.extend_from_slice(&[0u8; 32]); // prev hash
        tx.extend_from_slice(&0xffff_ffffu32.to_le_bytes()); // prev index
        tx.push(0x00); // empty scriptSig
        tx.extend_from_slice(&0xffff_fffeu32.to_le_bytes()); // sequence
        push_varint(&mut tx, outputs.len() as u64);
        for (value, spk) in outputs {
            tx.extend_from_slice(&value.to_le_bytes());
            push_varint(&mut tx, spk.len() as u64);
            tx.extend_from_slice(spk);
        }
        tx.extend_from_slice(&0u32.to_le_bytes()); // locktime
        tx
    }

    fn push_varint(buf: &mut Vec<u8>, n: u64) {
        if n < 0xfd {
            buf.push(n as u8);
        } else {
            buf.push(0xfd);
            buf.extend_from_slice(&(n as u16).to_le_bytes());
        }
    }

    fn fake_p2wsh_spk(hash_byte: u8) -> Vec<u8> {
        let mut spk = vec![0x00u8, 0x20];
        spk.extend(core::iter::repeat(hash_byte).take(32));
        spk
    }

    fn to_bytes(env: &Env, v: &[u8]) -> Bytes {
        Bytes::from_slice(env, v)
    }

    // ── find_p2wsh_output ────────────────────────────────────────────────────

    #[test]
    fn finds_single_p2wsh_output() {
        let env = env();
        let spk = fake_p2wsh_spk(0xab);
        let tx = build_legacy_tx(&[(100_000, &spk)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk)),
            Some(100_000)
        );
    }

    #[test]
    fn finds_second_output_when_first_does_not_match() {
        let env = env();
        let spk_a = fake_p2wsh_spk(0xaa);
        let spk_b = fake_p2wsh_spk(0xbb);
        let tx = build_legacy_tx(&[(50_000, &spk_a), (200_000, &spk_b)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk_b)),
            Some(200_000)
        );
    }

    #[test]
    fn returns_first_match_when_duplicate_outputs() {
        let env = env();
        let spk = fake_p2wsh_spk(0xcc);
        let tx = build_legacy_tx(&[(111, &spk), (999, &spk)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk)),
            Some(111)
        );
    }

    #[test]
    fn returns_none_when_script_not_present() {
        let env = env();
        let spk_a = fake_p2wsh_spk(0xaa);
        let spk_b = fake_p2wsh_spk(0xbb);
        let tx = build_legacy_tx(&[(100_000, &spk_a)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk_b)),
            None
        );
    }

    #[test]
    fn returns_none_for_empty_input() {
        let env = env();
        let spk = fake_p2wsh_spk(0xaa);
        assert_eq!(
            find_p2wsh_output(&Bytes::new(&env), &to_bytes(&env, &spk)),
            None
        );
    }

    #[test]
    fn returns_none_for_truncated_transaction() {
        let env = env();
        let spk = fake_p2wsh_spk(0xab);
        let tx = build_legacy_tx(&[(100_000, &spk)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx[..tx.len() / 2]), &to_bytes(&env, &spk)),
            None
        );
    }

    #[test]
    fn skips_segwit_marker_and_flag_if_present() {
        let env = env();
        let spk = fake_p2wsh_spk(0xde);
        let normal_tx = build_legacy_tx(&[(77_777, &spk)]);
        // Inject SegWit marker+flag after the 4-byte version.
        let mut segwit_tx = normal_tx[..4].to_vec();
        segwit_tx.extend_from_slice(&[0x00, 0x01]);
        segwit_tx.extend_from_slice(&normal_tx[4..]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &segwit_tx), &to_bytes(&env, &spk)),
            Some(77_777)
        );
    }

    #[test]
    fn zero_satoshi_value_is_returned_correctly() {
        let env = env();
        let spk = fake_p2wsh_spk(0x01);
        let tx = build_legacy_tx(&[(0, &spk)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk)),
            Some(0)
        );
    }

    #[test]
    fn large_satoshi_value_roundtrips() {
        let env = env();
        let spk = fake_p2wsh_spk(0xff);
        let big = 21_000_000 * 100_000_000u64; // 21M BTC in satoshis
        let tx = build_legacy_tx(&[(big, &spk)]);
        assert_eq!(
            find_p2wsh_output(&to_bytes(&env, &tx), &to_bytes(&env, &spk)),
            Some(big)
        );
    }
}
