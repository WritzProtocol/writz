use soroban_sdk::{Bytes, BytesN, Env};

/// Computes SHA256d (double-SHA256), Bitcoin's primary hash function.
///
/// Bitcoin uses SHA256(SHA256(data)) for block hashes, transaction IDs,
/// and Merkle tree nodes. Two sequential calls to `env.crypto().sha256()`
/// are used since there is no host-level SHA256d primitive.
pub fn sha256d(env: &Env, data: &Bytes) -> BytesN<32> {
    // SDK 26: sha256() returns Hash<32>, which converts Into<BytesN<32>>.
    let first_pass: BytesN<32> = env.crypto().sha256(data).into();
    let second_input: Bytes = first_pass.into();
    env.crypto().sha256(&second_input).into()
}

/// Hashes a pair of 32-byte values as a Merkle tree node.
///
/// Bitcoin Merkle nodes are defined as:
///   node = SHA256d(left || right)
///
/// Both `left` and `right` are consumed in internal byte order (no reversal).
pub fn hash_merkle_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.append(&left.clone().into());
    combined.append(&right.clone().into());
    sha256d(env, &combined)
}
