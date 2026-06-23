#![no_std]

mod crypto;
mod error;
mod header;
mod merkle;
mod types;

#[cfg(test)]
mod test;

pub use error::SPVError;
pub use types::VerificationResult;

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Vec};

use crate::crypto::sha256d;
use crate::header::{merkle_root_of, validate_header_chain};
use crate::merkle::verify_merkle_inclusion;

/// Writz Protocol — Bitcoin SPV Verification Contract.
///
/// Provides stateless verification that a Bitcoin transaction was included in
/// a confirmed block. "Stateless" means the caller supplies all necessary data
/// (headers, Merkle proof, raw transaction) at call time; nothing is stored
/// on-chain by this contract.
///
/// This contract is the trust-minimized foundation of the Writz lending
/// protocol. `verify_transaction` is called by `PrivateLend` to confirm that
/// a user's BTC deposit has reached the required number of confirmations
/// before USDC credit is issued.
#[contract]
pub struct BitcoinSpvContract;

#[contractimpl]
impl BitcoinSpvContract {
    /// Verify that a Bitcoin transaction is included in a confirmed block.
    ///
    /// # Parameters
    ///
    /// - `headers`
    ///   A sequence of 80-byte Bitcoin block headers. `headers[0]` is the
    ///   block that contains the transaction. Subsequent headers extend the
    ///   chain, providing additional confirmations. Must have at least
    ///   `min_confirmations` entries.
    ///
    ///   Each header must pass the chain-continuity check: the
    ///   `prev_block_hash` field (bytes 4–35) of `headers[i]` must equal
    ///   SHA256d(`headers[i-1]`).
    ///
    /// - `merkle_proof`
    ///   Sibling hashes for the Merkle inclusion proof, ordered from leaf
    ///   level up to the level just below the root. An empty vector is valid
    ///   for a single-transaction block (where txid == merkle_root).
    ///
    /// - `tx_index`
    ///   The 0-based index of the transaction within the block. Used to
    ///   determine the left/right direction at each Merkle level.
    ///
    /// - `raw_tx`
    ///   Raw transaction bytes **without witness data** (the non-witness
    ///   serialization). For legacy (pre-SegWit) transactions this is the
    ///   complete serialization. For SegWit transactions, the caller or the
    ///   Writz relayer service must strip the 2-byte segwit marker/flag and
    ///   all witness fields before passing. The txid is SHA256d(raw_tx).
    ///
    ///   Rationale: Bitcoin's block Merkle tree uses non-witness txids.
    ///   Including witness data would produce the wrong hash (wtxid ≠ txid).
    ///
    /// - `min_confirmations`
    ///   Minimum number of block headers required. Must be ≥ 1.
    ///   Writz Protocol uses 6 for standard deposits and 3 for the fast lane
    ///   (smaller amounts only).
    ///
    /// # Returns
    ///
    /// On success: a [`VerificationResult`] with the txid, block hash, and
    /// the number of confirmations supplied.
    ///
    /// On failure: an [`SPVError`] describing what went wrong.
    pub fn verify_transaction(
        env: Env,
        headers: Vec<BytesN<80>>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> Result<VerificationResult, SPVError> {
        // ── Input guards ──────────────────────────────────────────────────────
        if min_confirmations == 0 {
            return Err(SPVError::ZeroMinConfirmations);
        }
        if headers.is_empty() {
            return Err(SPVError::NoHeaders);
        }
        if headers.len() < min_confirmations {
            return Err(SPVError::InsufficientConfirmations);
        }
        if raw_tx.is_empty() {
            return Err(SPVError::EmptyTransaction);
        }

        // ── Step 1: Validate header chain ─────────────────────────────────────
        // Returns the hash of headers[0] (the block containing our transaction).
        // Fails with HeaderChainBroken if any link is invalid.
        let block_hash = validate_header_chain(&env, &headers)?;

        // ── Step 2: Compute txid ──────────────────────────────────────────────
        // txid = SHA256d(non-witness raw transaction bytes)
        let txid: BytesN<32> = sha256d(&env, &raw_tx);

        // ── Step 3: Extract Merkle root from headers[0] ───────────────────────
        let expected_merkle_root = merkle_root_of(&env, &headers.get(0).unwrap());

        // ── Step 4: Verify Merkle inclusion proof ─────────────────────────────
        // Walks from txid up to the Merkle root using the supplied sibling hashes.
        verify_merkle_inclusion(
            &env,
            &txid,
            tx_index,
            &merkle_proof,
            &expected_merkle_root,
        )?;

        Ok(VerificationResult {
            txid,
            block_hash,
            confirmations: headers.len(),
        })
    }
}
