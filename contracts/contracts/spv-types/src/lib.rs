#![no_std]

//! Shared cross-contract types for Bitcoin SPV verification.
//!
//! Before this crate existed, `SpvVerificationResult` (as `VerificationResult`
//! in `bitcoin-spv` and `SpvResult` in `writz-lend`) was
//! hand-copied verbatim into three separate crates, each with a comment
//! warning that "field names must match exactly for XDR round-tripping" - a
//! constraint the compiler could not check, since nothing tied the three
//! definitions together. `env.invoke_contract::<T>(...)` decodes a callee's
//! XDR return value into whatever type `T` the caller names locally, so this
//! duplication was never strictly required for the cross-contract call to
//! work - only convenient at the time. Sharing one real type here means a
//! future field change is a single edit the compiler enforces everywhere,
//! not three edits a human has to remember to keep in sync.
//!
//! `bitcoin-spv::verify_transaction` returns this type directly (a rename
//! from its previous local `VerificationResult` - no field changes, so any
//! caller decoding by field name is unaffected; only the on-chain contract
//! spec's type name changes). `writz-lend` uses it as
//! the expected return type for its `env.invoke_contract` calls into
//! `bitcoin-spv`.

use soroban_sdk::{contracttype, BytesN, U256};

/// Bitcoin transaction output parsing. Moved here from `writz-lend` (its
/// original caller).
pub mod btc_parser;

/// The Writz P2WSH locking script and its timelock bounds, shared by both
/// lending contracts' deposit checks.
pub mod script;

/// Proof that a depositor controls the Bitcoin key their deposit names
/// (GHSA-862g-739q-x6h8), used by `writz-lend`.
pub mod key_proof;

/// A header accepted into `bitcoin-spv`, keyed by its block hash. Shared so
/// `writz-lend` can read the tip's timestamp (#212).
#[contracttype]
#[derive(Clone, Debug)]
pub struct HeaderEntry {
    pub prev: BytesN<32>,
    pub merkle_root: BytesN<32>,
    pub height: u32,
    pub bits: u32,
    pub time: u32,
    /// Timestamp of the first block of this header's difficulty period.
    pub period_start_time: u32,
    /// Cumulative work since the checkpoint (the checkpoint itself is 0).
    pub chainwork: U256,
}

/// The tip of the most-work chain `bitcoin-spv` knows about.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BestTip {
    pub hash: BytesN<32>,
    pub height: u32,
    pub chainwork: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    /// The transaction identifier: SHA256d of the non-witness serialization.
    pub txid: BytesN<32>,

    /// The hash (SHA256d) of the block that contains the transaction.
    pub block_hash: BytesN<32>,

    /// Bitcoin height of the block that contains the transaction.
    pub block_height: u32,

    /// The block's depth below the best chain tip (the tip itself is 1).
    pub confirmations: u32,
}
