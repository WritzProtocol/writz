#![no_std]

//! Client for the Writz `bitcoin-spv` contract, for Soroban contracts that
//! need to prove a Bitcoin transaction.
//!
//! `bitcoin-spv` is a Bitcoin light client running as a Soroban contract.
//! [`BitcoinSpvClient::verify_transaction`] proves that a transaction is in a
//! block of the most-work chain with at least `min_confirmations`
//! confirmations. It proves inclusion and depth only: what the transaction
//! paid, and to whom, is the caller's check, which [`find_output_value`]
//! does on chain.
//!
//! ```ignore
//! use writz_spv_client::{find_output_value, BitcoinSpvClient};
//!
//! let proof = match BitcoinSpvClient::new(&env, &spv_id)
//!     .try_verify_transaction(&block_hash, &merkle_proof, &tx_index, &raw_tx, &6)
//! {
//!     Ok(Ok(result)) => result,
//!     _ => return Err(Error::ProofRejected),
//! };
//! let sats = find_output_value(&raw_tx, &expected_script_pubkey).ok_or(Error::NotPaid)?;
//! ```
//!
//! The types here mirror the deployed contract. Field names and error codes
//! are part of the contract's on-chain interface and are checked against the
//! contract source by this crate's tests.

mod btc_parser;

pub use btc_parser::find_output_value;

use soroban_sdk::{contractclient, contracterror, contracttype, Bytes, BytesN, Env, Vec, U256};

/// Result of a successful `verify_transaction`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    /// SHA256d of `raw_tx`, in internal byte order (reversed from explorers).
    pub txid: BytesN<32>,
    /// Hash of the block that contains the transaction, internal byte order.
    pub block_hash: BytesN<32>,
    /// Bitcoin height of that block.
    pub block_height: u32,
    /// The block's depth below the light client's tip (the tip itself is 1).
    pub confirmations: u32,
}

/// The tip of the most-work chain the light client knows about.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BestTip {
    pub hash: BytesN<32>,
    pub height: u32,
    /// Cumulative work since the checkpoint.
    pub chainwork: U256,
}

/// A stored block header, keyed by its block hash.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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

/// The light client's trust root. Only blocks after it can be proven.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Checkpoint {
    pub height: u32,
    pub block_hash: BytesN<32>,
    pub bits: u32,
    pub time: u32,
    pub period_start_time: u32,
    pub set_at_ledger: u32,
}

/// Error codes of `bitcoin-spv`. Codes are stable and never reassigned.
///
/// A caller of `verify_transaction` can hit 2, 3, 5, 7, 10, 13, 15, 22, 23
/// and 24; the others come from header submission and admin functions.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SPVError {
    NoHeaders = 1,
    /// The block is shallower than `min_confirmations`.
    InsufficientConfirmations = 2,
    /// `min_confirmations` is 0.
    ZeroMinConfirmations = 3,
    HeaderChainBroken = 4,
    /// The Merkle proof does not reproduce the block's Merkle root: wrong
    /// `tx_index`, siblings in display order, or `raw_tx` with witness data.
    MerkleProofInvalid = 5,
    InvalidHeaderSlice = 6,
    /// `raw_tx` is empty.
    EmptyTransaction = 7,
    InsufficientProofOfWork = 8,
    InvalidDifficultyBits = 9,
    NotInitialized = 10,
    AlreadyInitialized = 11,
    Unauthorized = 12,
    CheckpointNotSet = 13,
    DifficultyBelowCheckpointFloor = 14,
    /// `raw_tx` is exactly 64 bytes, the size of a Merkle inner node.
    AmbiguousTransactionLength = 15,
    CheckpointAlreadySet = 16,
    InvalidCheckpoint = 17,
    TooManyHeaders = 18,
    UnknownParent = 19,
    UnexpectedDifficulty = 20,
    TimestampTooFarInFuture = 21,
    /// `block_hash` is not stored: before the checkpoint, not a block of the
    /// tracked network, in display order, or not submitted yet.
    HeaderNotFound = 22,
    /// The block is stored but not on the most-work chain.
    NotOnBestChain = 23,
    /// The block is the checkpoint or older.
    BlockNotAfterCheckpoint = 24,
    ReorgTooDeep = 25,
    TxidAlreadyConsumed = 26,
    NotAConsumer = 27,
}

/// The read interface of `bitcoin-spv`. `#[contractclient]` generates
/// [`BitcoinSpvClient`] from it; use its `try_` methods to receive a
/// rejection as a value instead of aborting your own call.
///
/// Header submission and the admin functions are left out on purpose: they
/// are restricted to the Writz operator on the deployed light client.
#[contractclient(name = "BitcoinSpvClient")]
pub trait BitcoinSpvInterface {
    /// Proves that `raw_tx` (without witness data) is in block `block_hash`
    /// of the most-work chain, at least `min_confirmations` deep (tip = 1).
    /// `block_hash` and every `merkle_proof` item are in internal byte order.
    /// Read-only and needs no authorisation.
    fn verify_transaction(
        env: Env,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> Result<SpvVerificationResult, SPVError>;

    /// The tip of the most-work chain, or `None` before the checkpoint is set.
    fn get_best_tip(env: Env) -> Option<BestTip>;

    /// The stored header for `block_hash`, if any.
    fn get_header(env: Env, block_hash: BytesN<32>) -> Option<HeaderEntry>;

    /// The most-work chain's block hash at `height`, if known.
    fn get_canonical_hash(env: Env, height: u32) -> Option<BytesN<32>>;

    /// The trust root, or `None` if never set.
    fn get_checkpoint(env: Env) -> Option<Checkpoint>;

    /// Whether a Writz lending contract has already consumed this deposit
    /// txid. Not a replay guard for your contract: store your own txids.
    fn is_deposit_consumed(env: Env, txid: BytesN<32>) -> bool;
}

/// The txid of a raw transaction without witness data, SHA256d, in internal
/// byte order: the same value `verify_transaction` returns as `txid`.
pub fn txid(env: &Env, raw_tx: &Bytes) -> BytesN<32> {
    let first: Bytes = env.crypto().sha256(raw_tx).into();
    env.crypto().sha256(&first).into()
}

#[cfg(test)]
mod test;
