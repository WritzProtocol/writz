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
pub use types::{BestTip, Checkpoint, Config, HeaderEntry, PendingReorg};

use soroban_sdk::{
    contract, contractevent, contractimpl, panic_with_error, Address, Bytes, BytesN, Env, Vec, U256,
};

use crate::crypto::sha256d;
use crate::difficulty::{
    bits_to_target, expected_bits, validate_proof_of_work, work_from_target, RETARGET_INTERVAL,
};
use crate::header::{bits_of, hash_header, merkle_root_of, prev_hash_of, time_of};
use crate::merkle::verify_merkle_inclusion;
use crate::storage::{
    get_best_tip, get_canonical, get_checkpoint, get_config, get_header, get_pending_reorg,
    has_pending_reorg, header_ttl, remove_pending_reorg, set_best_tip, set_canonical,
    set_checkpoint, set_config, set_header, set_pending_reorg,
};
pub use crate::storage::{LEDGERS_PER_DAY, MAX_ENTRY_TTL_LEDGERS, MIN_ENTRY_TTL_LEDGERS};

/// Emitted when the admin changes the header or consumed-marker window. It
/// applies to entries written or touched after the change - see `set_ttls`.
#[contractevent(topics = ["ttls_set"])]
pub struct TtlsSetEvent {
    #[topic]
    pub admin: Address,
    pub header_ttl_ledgers: u32,
    pub consumed_ttl_ledgers: u32,
}

/// Most headers one `submit_headers` call accepts.
const MAX_HEADERS_PER_SUBMIT: u32 = 16;

/// Most height-index slots one `submit_headers` call writes when the best
/// chain changes. A switch that needs more is stored as a `PendingReorg`
/// and continues in later calls.
///
/// The binding limit is the transaction footprint: each slot written is a
/// read-write entry plus a read of its block's header, on top of up to 16
/// new headers, the 11 headers behind them and the singletons. With 16 the
/// worst case stays under the 100 footprint entries Soroban's SDK test
/// environment enforces (the network allows 400); `reorg_call_resources`
/// measures it.
const MAX_INDEX_WRITES_PER_SUBMIT: u32 = 16;

/// Most height-index slots one `continue_reorg` call writes. It stores no
/// header, so it can spend that footprint on the index instead.
const MAX_INDEX_WRITES_PER_CONTINUE: u32 = 28;

/// Bitcoin's median-time-past window: a header must be later than the
/// median timestamp of the 11 blocks before it.
const MEDIAN_TIME_SPAN: u32 = 11;

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
/// `WritzLend` calls `verify_transaction` to confirm a
/// user's BTC deposit has the required confirmations before crediting USDC.
#[contract]
pub struct BitcoinSpvContract;

#[contractimpl]
impl BitcoinSpvContract {
    // ── Initialization / admin ───────────────────────────────────────────────

    /// Runs exactly once, atomically, as part of deployment (`__constructor`):
    /// no separate initialize transaction exists for anyone to front-run
    /// (GHSA-422m-f73x-fh58).
    ///
    /// `pow_limit_bits` is the tracked network's compact proof-of-work limit
    /// (mainnet `0x1d00ffff`, signet `0x1e0377ae`). Header submission starts
    /// permissionless; call `set_submitter` to restrict it.
    ///
    /// `header_ttl_ledgers` is how long each stored header and its
    /// height-index entry are kept live, and `consumed_ttl_ledgers` how long
    /// each consumed-deposit marker is, in ledgers from when the entry is
    /// written or last topped up. The transaction that creates one pays rent
    /// for its window: 1,555,200 (90 days) for both on mainnet; a short
    /// window where rent is priced high (testnet). Both must lie in
    /// `MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS`. An entry that
    /// outlives its window is archived, not deleted, and is restored before
    /// any call can read it again, so neither window weakens the duplicate
    /// deposit guard.
    pub fn __constructor(
        env: Env,
        admin: Address,
        pow_limit_bits: u32,
        header_ttl_ledgers: u32,
        consumed_ttl_ledgers: u32,
    ) {
        bits_to_target(&env, pow_limit_bits).expect("invalid pow_limit_bits");
        let ttl_bounds = MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS;
        if !ttl_bounds.contains(&header_ttl_ledgers) || !ttl_bounds.contains(&consumed_ttl_ledgers) {
            panic_with_error!(&env, SPVError::InvalidEntryTtl);
        }
        set_config(
            &env,
            &Config {
                admin,
                pow_limit_bits,
                submitter: None,
                header_ttl_ledgers,
                consumed_ttl_ledgers,
            },
        );
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
        let ttl = config.header_ttl_ledgers;
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
            ttl,
        );
        set_canonical(&env, height, &block_hash, ttl);
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

    /// Registers (or removes) a lending contract allowed to consume deposit
    /// txids. Admin-only. Both lending contracts share one txid registry so
    /// the same Bitcoin output cannot back loans from both pools
    /// (GHSA-2975-ggwh-pxw5).
    pub fn set_consumer(
        env: Env,
        caller: Address,
        consumer: Address,
        allowed: bool,
    ) -> Result<(), SPVError> {
        caller.require_auth();
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        storage::set_consumer(&env, &consumer, allowed);
        Ok(())
    }

    /// Marks a deposit txid as consumed by a lending contract. Fails if the
    /// caller is not a registered consumer or the txid was already consumed.
    /// Called by each lending contract's `deposit` after its own checks.
    pub fn consume_deposit(env: Env, consumer: Address, txid: BytesN<32>) -> Result<(), SPVError> {
        consumer.require_auth();
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if !storage::is_consumer(&env, &consumer) {
            return Err(SPVError::NotAConsumer);
        }
        if storage::is_consumed(&env, &txid) {
            return Err(SPVError::TxidAlreadyConsumed);
        }
        storage::set_consumed(&env, &txid, config.consumed_ttl_ledgers);
        Ok(())
    }

    /// Returns whether a deposit txid has already been consumed.
    pub fn is_deposit_consumed(env: Env, txid: BytesN<32>) -> bool {
        storage::is_consumed(&env, &txid)
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

    /// Sets how long stored headers (with their height index) and consumed
    /// deposit markers are kept live, in ledgers. Admin-gated, same bounds as
    /// the constructor.
    ///
    /// Rent is priced at the ledger that creates or extends an entry, and on
    /// a network whose live state is above its target size that price moves
    /// by the hour; this lets the windows follow it without a redeploy. They
    /// apply to entries written or touched after the change only.
    pub fn set_ttls(
        env: Env,
        caller: Address,
        header_ttl_ledgers: u32,
        consumed_ttl_ledgers: u32,
    ) -> Result<(), SPVError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        if caller != config.admin {
            return Err(SPVError::Unauthorized);
        }
        let ttl_bounds = MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS;
        if !ttl_bounds.contains(&header_ttl_ledgers) || !ttl_bounds.contains(&consumed_ttl_ledgers) {
            return Err(SPVError::InvalidEntryTtl);
        }
        config.header_ttl_ledgers = header_ttl_ledgers;
        config.consumed_ttl_ledgers = consumed_ttl_ledgers;
        set_config(&env, &config);
        TtlsSetEvent { admin: caller, header_ttl_ledgers, consumed_ttl_ledgers }.publish(&env);
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
        get_header(&env, &block_hash, header_ttl(&env))
    }

    /// Returns the most-work chain's block hash at `height`, if known.
    ///
    /// `None` above the best tip, and, while a chain switch is pending, at
    /// heights it has not rewritten yet.
    pub fn get_canonical_hash(env: Env, height: u32) -> Option<BytesN<32>> {
        let best = get_best_tip(&env)?;
        if height > best.height {
            return None;
        }
        if let Some(pending) = get_pending_reorg(&env) {
            if height <= pending.next_height {
                return None;
            }
        }
        get_canonical(&env, height, header_ttl(&env))
    }

    /// Returns the chain switch still rewriting the height index, if any.
    /// While it exists `verify_transaction` returns `ReorgPending`.
    pub fn get_pending_reorg(env: Env) -> Option<PendingReorg> {
        get_pending_reorg(&env)
    }

    /// Extends the TTL of the Config, Checkpoint and best-tip entries, and
    /// of the contract instance and code. Permissionless - anyone can call this to keep an inactive deployment
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
    /// two hours ahead of ledger time, and, from the 11th block after the
    /// checkpoint on, be later than the median time of the 11 blocks before
    /// it. Headers already stored are skipped.
    ///
    /// If the run's last header makes a heavier chain than the current best,
    /// the best tip switches to it and the height-to-hash index is rewritten
    /// down to where the two chains meet, at most `MAX_INDEX_WRITES_PER_SUBMIT`
    /// slots per call. A longer rewrite is stored as a pending switch: each
    /// later call (this one or `continue_reorg`) advances it first, and a
    /// heavier tip submitted meanwhile is adopted once it completes.
    ///
    /// Permissionless unless a submitter is configured (see `set_submitter`).
    /// Returns the height of the best tip afterwards.
    pub fn submit_headers(env: Env, headers: Vec<BytesN<80>>) -> Result<u32, SPVError> {
        let config = get_config(&env).ok_or(SPVError::NotInitialized)?;
        let checkpoint = get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;

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
        let ttl = config.header_ttl_ledgers;

        let mut last: Option<(BytesN<32>, HeaderEntry)> = None;
        for header in headers.iter() {
            let hash = hash_header(&env, &header);
            if let Some(existing) = get_header(&env, &hash, ttl) {
                last = Some((hash, existing));
                continue;
            }

            let parent = get_header(&env, &prev_hash_of(&env, &header), ttl)
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
            // Only once all 11 previous timestamps are stored: a median of
            // fewer could be later than Bitcoin's and reject a valid block.
            if height >= checkpoint.height.saturating_add(MEDIAN_TIME_SPAN)
                && time <= median_time_past(&env, &parent, ttl)?
            {
                return Err(SPVError::TimestampNotAfterMedianTimePast);
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
            set_header(&env, &hash, &entry, ttl);
            last = Some((hash, entry));
        }

        let offered = last.ok_or(SPVError::NoHeaders)?;
        let best = apply_fork_choice(&env, Some(offered), MAX_INDEX_WRITES_PER_SUBMIT, ttl)?;
        Ok(best.height)
    }

    /// Advances a pending chain switch by up to `MAX_INDEX_WRITES_PER_CONTINUE`
    /// height-index slots, then adopts any heavier tip submitted while it
    /// was pending. Returns whether a switch is still pending afterwards;
    /// with none pending it changes nothing and returns `false`.
    ///
    /// Permissionless even when a submitter is configured: it adds no
    /// header, it only finishes a rewrite fully determined by headers
    /// already stored, so anyone can end a pending `ReorgPending` state.
    pub fn continue_reorg(env: Env) -> Result<bool, SPVError> {
        let ttl = get_config(&env).ok_or(SPVError::NotInitialized)?.header_ttl_ledgers;
        get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;
        if !has_pending_reorg(&env) {
            return Ok(false);
        }
        apply_fork_choice(&env, None, MAX_INDEX_WRITES_PER_CONTINUE, ttl)?;
        Ok(has_pending_reorg(&env))
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
    ///   and be on the most-work chain. While a chain switch is pending
    ///   (`get_pending_reorg`), every call returns `ReorgPending`.
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
    /// A [`SpvVerificationResult`] with the txid, the block hash and height,
    /// and the block's actual confirmation depth.
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

        let ttl = get_config(&env).ok_or(SPVError::NotInitialized)?.header_ttl_ledgers;
        let checkpoint = get_checkpoint(&env).ok_or(SPVError::CheckpointNotSet)?;
        if has_pending_reorg(&env) {
            return Err(SPVError::ReorgPending);
        }

        let entry = get_header(&env, &block_hash, ttl).ok_or(SPVError::HeaderNotFound)?;
        if entry.height <= checkpoint.height {
            return Err(SPVError::BlockNotAfterCheckpoint);
        }

        let best = get_best_tip(&env).ok_or(SPVError::CheckpointNotSet)?;
        if entry.height > best.height
            || get_canonical(&env, entry.height, ttl).as_ref() != Some(&block_hash)
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
            block_height: entry.height,
            confirmations,
        })
    }
}

/// Median timestamp of the 11 blocks ending at `parent`. The caller makes
/// sure all 11 are stored (the checkpoint is the oldest it may reach).
fn median_time_past(env: &Env, parent: &HeaderEntry, ttl: u32) -> Result<u32, SPVError> {
    let mut times = [0u32; MEDIAN_TIME_SPAN as usize];
    times[0] = parent.time;
    let mut prev = parent.prev.clone();
    for slot in times.iter_mut().skip(1) {
        let entry = get_header(env, &prev, ttl).ok_or(SPVError::UnknownParent)?;
        *slot = entry.time;
        prev = entry.prev;
    }
    times.sort_unstable();
    Ok(times[MEDIAN_TIME_SPAN as usize / 2])
}

/// Writes the height index for the best chain from `hash` at `height`
/// downwards, at most `budget` slots, until it meets the chain already
/// indexed. A slot only counts as a meeting point at or below
/// `trusted_height`: above it a slot may still name a block of a chain
/// abandoned earlier. Every chain descends from the checkpoint, whose slot
/// never changes, so the walk always ends. Returns where to resume, or
/// `None` once the index is consistent.
fn rewrite_index(
    env: &Env,
    mut hash: BytesN<32>,
    mut height: u32,
    trusted_height: u32,
    budget: &mut u32,
    ttl: u32,
) -> Result<Option<(BytesN<32>, u32)>, SPVError> {
    loop {
        if height <= trusted_height && get_canonical(env, height, ttl).as_ref() == Some(&hash) {
            return Ok(None);
        }
        if *budget == 0 {
            return Ok(Some((hash, height)));
        }
        set_canonical(env, height, &hash, ttl);
        *budget -= 1;
        hash = get_header(env, &hash, ttl).ok_or(SPVError::UnknownParent)?.prev;
        height -= 1;
    }
}

/// Fork choice with at most `budget` height-index writes.
///
/// Advances a pending switch first. While one is still pending, a heavier
/// `offered` tip is only remembered as its candidate. Otherwise the heavier
/// of `offered` and that candidate replaces the best tip if it has more
/// work, and its index rewrite starts, pending again if it does not fit.
fn apply_fork_choice(
    env: &Env,
    offered: Option<(BytesN<32>, HeaderEntry)>,
    mut budget: u32,
    ttl: u32,
) -> Result<BestTip, SPVError> {
    let mut best = get_best_tip(env).ok_or(SPVError::CheckpointNotSet)?;
    let mut offered = offered;

    if let Some(mut pending) = get_pending_reorg(env) {
        let resume = rewrite_index(
            env,
            pending.next_hash.clone(),
            pending.next_height,
            pending.trusted_height,
            &mut budget,
            ttl,
        )?;
        if let Some((next_hash, next_height)) = resume {
            pending.next_hash = next_hash;
            pending.next_height = next_height;
            if let Some((hash, entry)) = offered {
                let floor = match &pending.candidate {
                    Some(c) => get_header(env, c, ttl).ok_or(SPVError::UnknownParent)?.chainwork,
                    None => best.chainwork.clone(),
                };
                if entry.chainwork > floor {
                    pending.candidate = Some(hash);
                }
            }
            set_pending_reorg(env, &pending);
            return Ok(best);
        }
        remove_pending_reorg(env);
        if let Some(c) = pending.candidate {
            let entry = get_header(env, &c, ttl).ok_or(SPVError::UnknownParent)?;
            if offered.as_ref().is_none_or(|(_, o)| entry.chainwork > o.chainwork) {
                offered = Some((c, entry));
            }
        }
    }

    if let Some((hash, entry)) = offered {
        if entry.chainwork > best.chainwork {
            let trusted_height = best.height;
            best = BestTip {
                hash: hash.clone(),
                height: entry.height,
                chainwork: entry.chainwork,
            };
            set_best_tip(env, &best);
            if let Some((next_hash, next_height)) =
                rewrite_index(env, hash, best.height, trusted_height, &mut budget, ttl)?
            {
                set_pending_reorg(
                    env,
                    &PendingReorg { next_hash, next_height, trusted_height, candidate: None },
                );
            }
        }
    }
    Ok(best)
}
