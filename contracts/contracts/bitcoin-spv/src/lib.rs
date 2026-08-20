#![no_std]

mod crypto;
mod difficulty;
mod error;
mod header;
mod merkle;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use error::SPVError;
pub use types::{Checkpoint, Config};
pub use spv_types::SpvVerificationResult;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

use crate::crypto::sha256d;
use crate::difficulty::{bits_to_target, MAX_DIFFICULTY_EASE_SHIFT};
use crate::header::{bits_of, merkle_root_of, validate_header_chain};
use crate::merkle::verify_merkle_inclusion;
use crate::storage::{get_checkpoint, get_config, set_checkpoint, set_config};

/// Writz Protocol - Bitcoin SPV Verification Contract.
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
    // ── Initialization / admin ───────────────────────────────────────────────

    /// One-time contract initialization. Can only be called once.
    ///
    /// `verify_transaction` will not succeed until both `initialize` and
    /// `set_checkpoint` have been called - the contract fails closed rather
    /// than allowing an unanchored header chain through.
    pub fn initialize(env: Env, admin: Address) -> Result<(), SPVError> {
        if get_config(&env).is_some() {
            return Err(SPVError::AlreadyInitialized);
        }
        set_config(&env, &Config { admin });
        Ok(())
    }

    /// Sets the difficulty-anchor checkpoint used to reject headers mined at
    /// a historically low (e.g. 2009-era) difficulty. Admin-gated.
    ///
    /// `bits` is validated up front (rejecting a malformed admin-supplied
    /// value) so a bad checkpoint can never itself brick `verify_transaction`
    /// with an opaque error.
    ///
    /// Operational requirement: the checkpoint should be refreshed
    /// periodically (recommended: weekly, matching Bitcoin's own retarget
    /// cadence) - this is a live operational dependency, not "set and
    /// forget". See `docs/security/security-model.md` for the full
    /// trust-model discussion, including the recommendation to hold this
    /// admin address as a 2-of-3 Stellar multisig before mainnet.
    pub fn set_checkpoint(
        env: Env,
        caller: Address,
        height: u32,
        block_hash: BytesN<32>,
        bits: u32,
    ) -> Result<(), SPVError> {
        caller.require_auth();
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        bits_to_target(&env, bits)?;
        set_checkpoint(
            &env,
            &Checkpoint {
                height,
                block_hash,
                bits,
                set_at_ledger: env.ledger().sequence(),
            },
        );
        Ok(())
    }

    /// Rotates the admin address. Admin-gated.
    pub fn set_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), SPVError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        config.admin = new_admin;
        set_config(&env, &config);
        Ok(())
    }

    /// Returns the current checkpoint, or `None` if never set.
    pub fn get_checkpoint(env: Env) -> Option<Checkpoint> {
        get_checkpoint(&env)
    }

    /// Extends the TTL of the Config and Checkpoint storage entries.
    /// Permissionless - anyone can call this to keep an inactive deployment
    /// from expiring.
    pub fn refresh_ttl(env: Env) {
        storage::refresh_ttl(&env)
    }

    /// Verify that a Bitcoin transaction is included in a confirmed block.
    ///
    /// Requires `initialize` and `set_checkpoint` to have been called first;
    /// returns [`SPVError::NotInitialized`] or [`SPVError::CheckpointNotSet`]
    /// otherwise.
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
    /// On success: a [`SpvVerificationResult`] with the txid, block hash, and
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
    ) -> Result<SpvVerificationResult, SPVError> {
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

        // ── Step 0: Require initialization + a checkpoint ─────────────────────
        // `Config` is fetched only to enforce NotInitialized gating
        // consistently with sibling contracts; `admin` isn't itself needed
        // inside this call.
        get_config(&env).ok_or(SPVError::NotInitialized)?;
        let checkpoint = get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;

        // ── Step 1: Validate header chain ─────────────────────────────────────
        // Returns the hash of headers[0] (the block containing our transaction).
        // Fails with HeaderChainBroken if any link is invalid. Each header's
        // own proof-of-work is checked inside validate_header_chain.
        let block_hash = validate_header_chain(&env, &headers)?;

        // ── Step 1b: Difficulty-band check against the checkpoint ─────────────
        // Rejects a chain mined at a historically low difficulty, even if
        // each header individually satisfies its own declared (equally-low)
        // target. See MAX_DIFFICULTY_EASE_SHIFT's doc comment for why this
        // band can't be relaxed away by the admin.
        let checkpoint_target = bits_to_target(&env, checkpoint.bits)?;
        let max_allowed_target = checkpoint_target.shl(MAX_DIFFICULTY_EASE_SHIFT);
        for i in 0..headers.len() {
            let h = headers.get(i).unwrap();
            let header_target = bits_to_target(&env, bits_of(&h))?;
            if header_target > max_allowed_target {
                return Err(SPVError::DifficultyBelowCheckpointFloor);
            }
        }

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

        Ok(SpvVerificationResult {
            txid,
            block_hash,
            confirmations: headers.len(),
        })
    }
}
