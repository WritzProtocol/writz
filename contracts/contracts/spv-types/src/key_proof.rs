//! Proof that a depositor controls the Bitcoin key their deposit names
//! (GHSA-862g-739q-x6h8).
//!
//! A deposit's Writz script is rebuilt from the protocol key, a caller-supplied
//! `user_pubkey` and a timelock. That proves the output is locked under *some*
//! Writz script, not that the Stellar caller owns it: the user key appears in
//! the deposit transaction's own input witness and the timelock is guessable,
//! so anyone watching Bitcoin could register someone else's deposit as their
//! own position and borrow against it.
//!
//! The depositor therefore signs, with that Bitcoin key, a standard Bitcoin
//! signed message (BIP-137, what wallets produce for "sign message" with
//! ECDSA) naming this contract, their Stellar address and the deposit txid.
//! The contract recovers the signer and requires it to be `user_pubkey`. The
//! message names the contract and the depositor, so a signature cannot be
//! replayed into another lender, another deployment, or another account.
//!
//! Message (ASCII, `\n`-separated):
//!
//! ```text
//! Writz deposit
//! contract:<this contract's C... address>
//! depositor:<the depositor's address>
//! txid:<the txid in display (explorer) byte order, lowercase hex>
//! ```

use soroban_sdk::{crypto::Hash, Address, Bytes, BytesN, Env};

const MAGIC: &[u8] = b"Bitcoin Signed Message:\n";
const HEX: &[u8; 16] = b"0123456789abcdef";

/// Appends a Bitcoin CompactSize length.
fn push_varint(out: &mut Bytes, n: u32) {
    if n < 0xfd {
        out.push_back(n as u8);
    } else if n <= 0xffff {
        out.push_back(0xfd);
        out.extend_from_slice(&(n as u16).to_le_bytes());
    } else {
        out.push_back(0xfe);
        out.extend_from_slice(&n.to_le_bytes());
    }
}

fn push_address(out: &mut Bytes, address: &Address) {
    let s = address.to_string();
    let mut buf = [0u8; 128];
    let len = s.len() as usize;
    s.copy_into_slice(&mut buf[..len]);
    out.extend_from_slice(&buf[..len]);
}

/// The text the depositor signs, as bytes.
pub fn deposit_message(env: &Env, contract: &Address, depositor: &Address, txid: &BytesN<32>) -> Bytes {
    let mut msg = Bytes::from_slice(env, b"Writz deposit\ncontract:");
    push_address(&mut msg, contract);
    msg.extend_from_slice(b"\ndepositor:");
    push_address(&mut msg, depositor);
    msg.extend_from_slice(b"\ntxid:");
    // Display order is the reverse of the internal (hashing) order.
    let internal = txid.to_array();
    for byte in internal.iter().rev() {
        msg.push_back(HEX[(byte >> 4) as usize]);
        msg.push_back(HEX[(byte & 0x0f) as usize]);
    }
    msg
}

/// SHA256d of the BIP-137 framing of `msg`, the digest the wallet signed.
pub fn signed_message_digest(env: &Env, msg: &Bytes) -> Hash<32> {
    let mut framed = Bytes::new(env);
    push_varint(&mut framed, MAGIC.len() as u32);
    framed.extend_from_slice(MAGIC);
    push_varint(&mut framed, msg.len());
    framed.append(msg);
    let first: BytesN<32> = env.crypto().sha256(&framed).into();
    env.crypto().sha256(&first.into())
}

/// True when `signature` (65-byte BIP-137: header, r, s) over `msg` was made
/// by the compressed key `pubkey`.
///
/// Only compressed-key headers (31..=42: P2PKH, P2SH-P2WPKH and P2WPKH) are
/// accepted, since Writz scripts embed compressed keys. A malformed signature
/// makes the host's recovery fail, which aborts the transaction.
pub fn signed_by(env: &Env, msg: &Bytes, signature: &BytesN<65>, pubkey: &BytesN<33>) -> bool {
    let sig = signature.to_array();
    let header = sig[0];
    if !(31..=42).contains(&header) {
        return false;
    }
    let recovery_id = ((header - 27) & 3) as u32;
    let mut rs = [0u8; 64];
    rs.copy_from_slice(&sig[1..65]);

    let digest = signed_message_digest(env, msg);
    let recovered = env
        .crypto()
        .secp256k1_recover(&digest, &BytesN::from_array(env, &rs), recovery_id)
        .to_array();

    // Recovered key is uncompressed: 0x04 || x || y. Compress and compare.
    let mut compressed = [0u8; 33];
    compressed[0] = if recovered[64] & 1 == 0 { 0x02 } else { 0x03 };
    compressed[1..].copy_from_slice(&recovered[1..33]);
    compressed == pubkey.to_array()
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::String;

    /// Shared with frontend/app/src/lib/bitcoin/keyProof.test.ts: the app
    /// builds the message the wallet signs, this contract rebuilds it, and
    /// both must land on the same digest or no deposit verifies.
    #[test]
    fn the_message_and_digest_match_the_frontend_vector() {
        let env = Env::default();
        let contract = Address::from_string(&String::from_str(&env, "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM"));
        let depositor = Address::from_string(&String::from_str(&env, "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT"));
        // e80765d8...ee24 in display order, so internal order is reversed.
        let mut internal = [0u8; 32];
        let display = "e80765d874d4e31da59b6f30617cf7018fe635f836a892dc671d77bcb7c1ee24";
        for i in 0..32 {
            internal[31 - i] = u8::from_str_radix(&display[2 * i..2 * i + 2], 16).unwrap();
        }
        let msg = deposit_message(&env, &contract, &depositor, &BytesN::from_array(&env, &internal));
        let expected = std::format!(
            "Writz deposit\ncontract:CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM\ndepositor:GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT\ntxid:{display}"
        );
        assert_eq!(msg, Bytes::from_slice(&env, expected.as_bytes()));

        let digest = signed_message_digest(&env, &msg).to_array();
        let hex: std::string::String = digest.iter().map(|b| std::format!("{b:02x}")).collect();
        assert_eq!(hex, "0125d670b399e17a6b05d0a323ec534376f94b089e5470a14bc25687e42099ee");
    }
}
