use soroban_sdk::{BytesN, Env, Vec};

use crate::crypto::hash_merkle_pair;
use crate::error::SPVError;

/// Verifies that a transaction is included in a Bitcoin block via its Merkle proof.
///
/// # Algorithm
///
/// Bitcoin's Merkle tree is a binary tree whose leaves are transaction IDs.
/// Each internal node is SHA256d(left_child || right_child). The root of this
/// tree is committed to in the block header's `merkle_root` field.
///
/// To prove a leaf `txid` is in the tree:
///
/// 1. Start with `current = txid`.
/// 2. For each sibling hash in `proof` (bottom of tree → top):
///    - If the current node is a **left** child (index bit = 0):
///        `current = SHA256d(current || sibling)`
///    - If the current node is a **right** child (index bit = 1):
///        `current = SHA256d(sibling || current)`
///    - Shift `tx_index` right by one to move to the parent level.
/// 3. The final `current` must equal `merkle_root`.
///
/// # Handling a single-transaction block
///
/// When `proof` is empty and `tx_index == 0`, the txid IS the Merkle root.
/// The loop does not execute, and the equality check `current == merkle_root`
/// must be satisfied by the caller providing matching values.
///
/// # Arguments
///
/// - `txid`:        SHA256d of the transaction (non-witness serialization).
/// - `tx_index`:    0-based index of the transaction within the block.
/// - `proof`:       Sibling hashes ordered leaf-to-root. The length in hashes
///                  must equal ⌈log₂(block_tx_count)⌉.
/// - `merkle_root`: The Merkle root from the block header.
///
/// # Returns
///
/// `Ok(())` on success, [`SPVError::MerkleProofInvalid`] otherwise.
pub fn verify_merkle_inclusion(
    env: &Env,
    txid: &BytesN<32>,
    tx_index: u32,
    proof: &Vec<BytesN<32>>,
    merkle_root: &BytesN<32>,
) -> Result<(), SPVError> {
    let mut current = txid.clone();
    let mut index = tx_index;

    for i in 0..proof.len() {
        let sibling = proof.get(i).unwrap();

        // index & 1 == 1 means we are the right child of our parent.
        current = if index & 1 == 1 {
            hash_merkle_pair(env, &sibling, &current)
        } else {
            hash_merkle_pair(env, &current, &sibling)
        };

        // Move up one level in the tree.
        index >>= 1;
    }

    if current == *merkle_root {
        Ok(())
    } else {
        Err(SPVError::MerkleProofInvalid)
    }
}
