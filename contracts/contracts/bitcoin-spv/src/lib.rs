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
pub use spv_types::SpvVerificationResult;
pub use types::{BestTip, Checkpoint, Config, HeaderEntry};

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec, U256};

use crate::crypto::sha256d;
use crate::difficulty::{
    bits_to_target, expected_bits, validate_proof_of_work, work_from_target, RETARGET_INTERVAL,
};
use crate::header::{bits_of, hash_header, merkle_root_of, prev_hash_of, time_of};
use crate::merkle::verify_merkle_inclusion;
use crate::storage::{
    get_best_tip, get_canonical, get_checkpoint, get_config, get_header, set_best_tip,
    set_canonical, set_checkpoint, set_config, set_header,
};

/// Most headers one `submit_headers` call accepts. Keeps the call inside
/// Soroban's per-transaction ledger-entry write limit.
const MAX_HEADERS_PER_SUBMIT: u32 = 16;

/// Most blocks one call may re-point in the canonical chain when a heavier
/// fork takes over.
const MAX_REORG_DEPTH: u32 = 20;

/// Bitcoin rejects headers more than two hours ahead of network time.
const MAX_FUTURE_DRIFT_SECS: u64 = 2 * 60 * 60;

/// Writz Protocol - Bitcoin SPV light client.
///
/// Stores Bitcoin block headers that descend from an admin-set checkpoint,
/// validating proof-of-work, hash linkage, Bitcoin's exact difficulty
/// retargeting and cumulative chainwork, and tracks the most-work chain.
/// `verify_transaction` then proves a transaction against a *stored* header,
/// so a caller can no longer present a header chain it mined privately.
///
/// `PrivateLend` and `CommitmentTree` call `verify_transaction` to confirm a
/// user's BTC deposit has the required confirmations before crediting USDC.
#[contract]
pub struct BitcoinSpvContract;

#[contractimpl]
impl BitcoinSpvContract {
    // ── Initialization / admin ───────────────────────────────────────────────

    /// One-time contract initialization. Can only be called once.
    ///
    /// `pow_limit_bits` is the tracked network's compact proof-of-work limit
    /// (mainnet `0x1d00ffff`, signet `0x1e0377ae`). Header submission starts
    /// permissionless; call `set_submitter` to restrict it.
    pub fn initialize(env: Env, admin: Address, pow_limit_bits: u32) -> Result<(), SPVError> {
        if get_config(&env).is_some() {
            return Err(SPVError::AlreadyInitialized);
        }
        bits_to_target(&env, pow_limit_bits)?;
        set_config(
            &env,
            &Config {
                admin,
                pow_limit_bits,
                submitter: None,
            },
        );
        Ok(())
    }

    /// Sets the trust-root checkpoint. Admin-gated and callable exactly once:
    /// after this the chain only grows through `submit_headers`, so the admin
    /// cannot later rewrite which chain is trusted.
    ///
    /// - `height`/`block_hash`/`bits`/`time`: the checkpoint block's header
    ///   fields.
    /// - `period_start_time`: timestamp of the block at
    ///   `height - height % 2016` (first block of the checkpoint's difficulty
    ///   period), needed to compute the next retarget exactly.
    pub fn set_checkpoint(
        env: Env,
        caller: Address,
        height: u32,
        block_hash: BytesN<32>,
        bits: u32,
        time: u32,
        period_start_time: u32,
    ) -> Result<(), SPVError> {
        caller.require_auth();
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        if get_checkpoint(&env).is_some() {
            return Err(SPVError::CheckpointAlreadySet);
        }

        let target = bits_to_target(&env, bits)?;
        let pow_limit = bits_to_target(&env, config.pow_limit_bits)?;
        if target > pow_limit || period_start_time > time {
            return Err(SPVError::InvalidCheckpoint);
        }

        set_checkpoint(
            &env,
            &Checkpoint {
                height,
                block_hash: block_hash.clone(),
                bits,
                time,
                period_start_time,
                set_at_ledger: env.ledger().sequence(),
            },
        );
        set_header(
            &env,
            &block_hash,
            &HeaderEntry {
                prev: BytesN::from_array(&env, &[0u8; 32]),
                merkle_root: BytesN::from_array(&env, &[0u8; 32]),
                height,
                bits,
                time,
                period_start_time,
                chainwork: U256::from_u32(&env, 0),
            },
        );
        set_canonical(&env, height, &block_hash);
        set_best_tip(
            &env,
            &BestTip {
                hash: block_hash,
                height,
                chainwork: U256::from_u32(&env, 0),
            },
        );
        Ok(())
    }

    /// Restricts `submit_headers` to `submitter`, or reopens it to everyone
    /// with `None`. Admin-gated.
    ///
    /// Restrict it on signet: signet blocks are authenticated by a block
    /// signature this contract does not verify, so its proof-of-work alone
    /// does not prove a header is real.
    pub fn set_submitter(
        env: Env,
        caller: Address,
        submitter: Option<Address>,
    ) -> Result<(), SPVError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        config.submitter = submitter;
        set_config(&env, &config);
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

    // ── Reads ────────────────────────────────────────────────────────────────

    /// Returns the checkpoint, or `None` if never set.
    pub fn get_checkpoint(env: Env) -> Option<Checkpoint> {
        get_checkpoint(&env)
    }

    /// Returns the tip of the most-work chain, or `None` before the
    /// checkpoint is set.
    pub fn get_best_tip(env: Env) -> Option<BestTip> {
        get_best_tip(&env)
    }

    /// Returns the stored header for `block_hash`, if any.
    pub fn get_header(env: Env, block_hash: BytesN<32>) -> Option<HeaderEntry> {
        get_header(&env, &block_hash)
    }

    /// Returns the most-work chain's block hash at `height`, if known.
    pub fn get_canonical_hash(env: Env, height: u32) -> Option<BytesN<32>> {
        get_canonical(&env, height)
    }

    /// Extends the TTL of the Config, Checkpoint and best-tip entries.
    /// Permissionless - anyone can call this to keep an inactive deployment
    /// from expiring.
    pub fn refresh_ttl(env: Env) {
        storage::refresh_ttl(&env)
    }

    // ── Header ingestion ─────────────────────────────────────────────────────

    /// Adds a run of contiguous block headers to the light client.
    ///
    /// Each header must descend from a header already stored (ultimately the
    /// checkpoint), satisfy its own proof-of-work, carry exactly the `bits`
    /// Bitcoin's difficulty rules require at its height, and not be more than
    /// two hours ahead of ledger time. Headers already stored are skipped.
    /// If the run makes a heavier chain than the current best, the best tip
    /// and the height-to-hash index switch to it.
    ///
    /// Permissionless unless a submitter is configured (see `set_submitter`).
    /// Returns the height of the best tip afterwards.
    pub fn submit_headers(env: Env, headers: Vec<BytesN<80>>) -> Result<u32, SPVError> {
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;

        if let Some(submitter) = &config.submitter {
            submitter.require_auth();
        }
        if headers.is_empty() {
            return Err(SPVError::NoHeaders);
        }
        if headers.len() > MAX_HEADERS_PER_SUBMIT {
            return Err(SPVError::TooManyHeaders);
        }

        let pow_limit = bits_to_target(&env, config.pow_limit_bits)?;
        let now = env.ledger().timestamp();

        let mut last: Option<(BytesN<32>, HeaderEntry)> = None;
        for header in headers.iter() {
            let hash = hash_header(&env, &header);
            if let Some(existing) = get_header(&env, &hash) {
                last = Some((hash, existing));
                continue;
            }

            let parent = get_header(&env, &prev_hash_of(&env, &header))
                .ok_or(SPVError::UnknownParent)?;

            validate_proof_of_work(&env, &header)?;

            let height = parent.height + 1;
            let bits = bits_of(&header);
            if bits != expected_bits(&env, &parent, height, &pow_limit)? {
                return Err(SPVError::UnexpectedDifficulty);
            }

            let time = time_of(&header);
            if time as u64 > now.saturating_add(MAX_FUTURE_DRIFT_SECS) {
                return Err(SPVError::TimestampTooFarInFuture);
            }

            let work = work_from_target(&env, &bits_to_target(&env, bits)?);
            let entry = HeaderEntry {
                prev: prev_hash_of(&env, &header),
                merkle_root: merkle_root_of(&env, &header),
                height,
                bits,
                time,
                period_start_time: if height % RETARGET_INTERVAL == 0 {
                    time
                } else {
                    parent.period_start_time
                },
                chainwork: parent.chainwork.add(&work),
            };
            set_header(&env, &hash, &entry);
            last = Some((hash, entry));
        }

        let (tip_hash, tip_entry) = last.ok_or(SPVError::NoHeaders)?;
        let mut best = get_best_tip(&env).ok_or(SPVError::CheckpointNotSet)?;

        if tip_entry.chainwork > best.chainwork {
            let mut hash = tip_hash.clone();
            let mut entry = tip_entry.clone();
            let mut rewritten = 0u32;
            while get_canonical(&env, entry.height).as_ref() != Some(&hash) {
                rewritten += 1;
                if rewritten > MAX_REORG_DEPTH {
                    return Err(SPVError::ReorgTooDeep);
                }
                set_canonical(&env, entry.height, &hash);
                let parent_hash = entry.prev.clone();
                entry = get_header(&env, &parent_hash).ok_or(SPVError::UnknownParent)?;
                hash = parent_hash;
            }
            best = BestTip {
                hash: tip_hash,
                height: tip_entry.height,
                chainwork: tip_entry.chainwork,
            };
            set_best_tip(&env, &best);
        }

        Ok(best.height)
    }

    // ── Verification ─────────────────────────────────────────────────────────

    /// Verify that a Bitcoin transaction is included in a confirmed block of
    /// the most-work chain this contract tracks.
    ///
    /// # Parameters
    ///
    /// - `block_hash`
    ///   Hash (internal byte order) of the block claimed to contain the
    ///   transaction. It must already have been stored with `submit_headers`
    ///   and be on the most-work chain.
    ///
    /// - `merkle_proof`
    ///   Sibling hashes for the Merkle inclusion proof, ordered from leaf
    ///   level up to the level just below the root. An empty vector is valid
    ///   for a single-transaction block (where txid == merkle_root).
    ///
    /// - `tx_index`
    ///   The 0-based index of the transaction within the block.
    ///
    /// - `raw_tx`
    ///   Raw transaction bytes **without witness data**. The txid is
    ///   SHA256d(raw_tx). Exactly 64 bytes is rejected: that is the size of a
    ///   Merkle inner-node preimage.
    ///
    /// - `min_confirmations`
    ///   Minimum depth of the block below the best tip (the tip itself counts
    ///   as 1). Must be ≥ 1.
    ///
    /// # Returns
    ///
    /// A [`SpvVerificationResult`] with the txid, the block hash and the
    /// block's actual confirmation depth.
    pub fn verify_transaction(
        env: Env,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> Result<SpvVerificationResult, SPVError> {
        if min_confirmations == 0 {
            return Err(SPVError::ZeroMinConfirmations);
        }
        if raw_tx.is_empty() {
            return Err(SPVError::EmptyTransaction);
        }
        // A Merkle inner node is SHA256d of exactly 64 bytes (left || right),
        // so only a 64-byte preimage can collide with one. Rejecting that
        // length closes the inner-node-as-transaction attack.
        if raw_tx.len() == 64 {
            return Err(SPVError::AmbiguousTransactionLength);
        }

        get_config(&env).ok_or(SPVError::NotInitialized)?;
        let checkpoint = get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;

        let entry = get_header(&env, &block_hash).ok_or(SPVError::HeaderNotFound)?;
        if entry.height <= checkpoint.height {
            return Err(SPVError::BlockNotAfterCheckpoint);
        }

        let best = get_best_tip(&env).ok_or(SPVError::CheckpointNotSet)?;
        if entry.height > best.height
            || get_canonical(&env, entry.height).as_ref() != Some(&block_hash)
        {
            return Err(SPVError::NotOnBestChain);
        }

        let confirmations = best.height - entry.height + 1;
        if confirmations < min_confirmations {
            return Err(SPVError::InsufficientConfirmations);
        }

        let txid: BytesN<32> = sha256d(&env, &raw_tx);
        verify_merkle_inclusion(&env, &txid, tx_index, &merkle_proof, &entry.merkle_root)?;

        Ok(SpvVerificationResult {
            txid,
            block_hash,
            confirmations,
        })
    }
}
