//! On-chain reconstruction of the Writz P2WSH locking script.
//!
//! Must stay byte-for-byte identical to `buildRedeemScript` in
//! `bitcoin-script/src/script.ts`:
//!
//! ```text
//! OP_IF
//!   <protocol_pubkey> OP_CHECKSIGVERIFY <user_pubkey> OP_CHECKSIG
//! OP_ELSE
//!   <timelock_height> OP_CHECKLOCKTIMEVERIFY OP_DROP <user_pubkey> OP_CHECKSIG
//! OP_ENDIF
//! ```
//!
//! `deposit` derives the expected scriptPubKey from the configured protocol
//! key, the depositor's key and the timelock, so an output can only count as
//! collateral if it really is locked under the protocol's co-signing key.

use soroban_sdk::{Bytes, BytesN, Env};

const OP_IF: u8 = 0x63;
const OP_ELSE: u8 = 0x67;
const OP_ENDIF: u8 = 0x68;
const OP_DROP: u8 = 0x75;
const OP_CHECKSIG: u8 = 0xac;
const OP_CHECKSIGVERIFY: u8 = 0xad;
const OP_CHECKLOCKTIMEVERIFY: u8 = 0xb1;
const PUSH_33_BYTES: u8 = 0x21;

/// True for a compressed secp256k1 public key encoding (`02`/`03` prefix).
/// Only the prefix is checked; the point itself is not validated on-chain.
pub fn is_compressed_pubkey(key: &BytesN<33>) -> bool {
    let prefix = key.to_array()[0];
    prefix == 0x02 || prefix == 0x03
}

/// Appends `n` as a minimally-encoded Bitcoin script number push (little
/// endian, with a zero pad byte when the top bit would read as a sign bit).
/// `n` must be non-zero: zero encodes as `OP_0`, not a data push, and a
/// timelock is validated to be far above zero before this is reached.
fn push_script_number(script: &mut Bytes, n: u32) {
    let le = n.to_le_bytes();
    let mut len = le.len();
    while len > 1 && le[len - 1] == 0 {
        len -= 1;
    }
    let needs_pad = le[len - 1] & 0x80 != 0;
    script.push_back((len + needs_pad as usize) as u8);
    script.extend_from_slice(&le[..len]);
    if needs_pad {
        script.push_back(0x00);
    }
}

/// Builds the Writz redeem (witness) script.
pub fn redeem_script(
    env: &Env,
    protocol_pubkey: &BytesN<33>,
    user_pubkey: &BytesN<33>,
    timelock_height: u32,
) -> Bytes {
    let mut script = Bytes::new(env);

    script.push_back(OP_IF);
    script.push_back(PUSH_33_BYTES);
    script.extend_from_slice(&protocol_pubkey.to_array());
    script.push_back(OP_CHECKSIGVERIFY);
    script.push_back(PUSH_33_BYTES);
    script.extend_from_slice(&user_pubkey.to_array());
    script.push_back(OP_CHECKSIG);

    script.push_back(OP_ELSE);
    push_script_number(&mut script, timelock_height);
    script.push_back(OP_CHECKLOCKTIMEVERIFY);
    script.push_back(OP_DROP);
    script.push_back(PUSH_33_BYTES);
    script.extend_from_slice(&user_pubkey.to_array());
    script.push_back(OP_CHECKSIG);

    script.push_back(OP_ENDIF);
    script
}

/// The 34-byte P2WSH scriptPubKey (`OP_0 0x20 SHA256(redeem_script)`) that a
/// valid Writz deposit output must carry.
pub fn p2wsh_script_pubkey(
    env: &Env,
    protocol_pubkey: &BytesN<33>,
    user_pubkey: &BytesN<33>,
    timelock_height: u32,
) -> Bytes {
    let script = redeem_script(env, protocol_pubkey, user_pubkey, timelock_height);
    let script_hash: BytesN<32> = env.crypto().sha256(&script).into();

    let mut spk = Bytes::new(env);
    spk.push_back(0x00);
    spk.push_back(0x20);
    spk.append(&script_hash.into());
    spk
}
