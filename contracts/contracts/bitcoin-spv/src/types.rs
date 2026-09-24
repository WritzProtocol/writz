use soroban_sdk::{contracttype, Address, BytesN, U256};

/// Contract configuration, set once at `initialize()`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// Address authorized to set the checkpoint, rotate the admin and choose
    /// the header submitter.
    pub admin: Address,
    /// Compact proof-of-work limit of the tracked network (mainnet
    /// `0x1d00ffff`, signet `0x1e0377ae`). Caps every retarget.
    pub pow_limit_bits: u32,
    /// When set, only this address may call `submit_headers`. Required on
    /// networks whose blocks are authenticated by something other than
    /// proof-of-work (signet), because this contract cannot verify that.
    /// `None` leaves header submission permissionless.
    pub submitter: Option<Address>,
}

/// The trust root of the header chain, set exactly once by the admin.
///
/// Every header stored by `submit_headers` must descend from this block, so
/// a fabricated chain that never touched Bitcoin can never be accepted.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    /// Bitcoin block height of the checkpoint block.
    pub height: u32,
    /// Hash of the checkpoint block, in internal byte order.
    pub block_hash: BytesN<32>,
    /// Compact difficulty target of the checkpoint block.
    pub bits: u32,
    /// Timestamp of the checkpoint block.
    pub time: u32,
    /// Timestamp of the first block of the checkpoint's 2016-block
    /// difficulty period (the block at `height - height % 2016`). Needed to
    /// compute the next retarget exactly.
    pub period_start_time: u32,
    /// `env.ledger().sequence()` when the checkpoint was set.
    pub set_at_ledger: u32,
}

/// A header accepted into the light client, keyed by its block hash.
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

/// The tip of the most-work chain the contract knows about.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BestTip {
    pub hash: BytesN<32>,
    pub height: u32,
    pub chainwork: U256,
}

// `verify_transaction`'s return type, `SpvVerificationResult`, lives in the
// shared `spv-types` crate - see that crate's doc comment for why. Re-exported
// from `lib.rs`, not redefined here.
