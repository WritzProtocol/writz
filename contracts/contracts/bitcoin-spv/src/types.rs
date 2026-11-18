use soroban_sdk::{contracttype, Address, BytesN};

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
    /// How long each stored header and its height-index entry are kept live,
    /// in ledgers, set at deployment (90 days on mainnet). The relayer creates
    /// two such entries per block it submits.
    pub header_ttl_ledgers: u32,
    /// How long each consumed-deposit marker is kept live, in ledgers, set at
    /// deployment (90 days on mainnet). Past it the marker is archived, never
    /// deleted, so the txid stays consumed.
    pub consumed_ttl_ledgers: u32,
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

/// A chain switch whose height-index rewrite did not fit in one call.
///
/// `BestTip` already names the new tip. Index slots above `next_height` (up
/// to the tip) hold the new chain; `next_hash` at `next_height` and the
/// blocks below it until the walk meets the old chain are still to be
/// written. `continue_reorg` and every `submit_headers` call advance it, and
/// `verify_transaction` refuses while it exists.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingReorg {
    /// Next block of the new chain whose height-index slot is to be written.
    pub next_hash: BytesN<32>,
    /// Height of `next_hash`.
    pub next_height: u32,
    /// Best height before the switch began. Slots above it may hold blocks
    /// of a chain abandoned earlier, so the walk only stops at or below it.
    pub trusted_height: u32,
    /// Heaviest tip submitted while this switch was pending, adopted as
    /// soon as it completes.
    pub candidate: Option<BytesN<32>>,
}

// `HeaderEntry` and `BestTip` live in `spv-types` so the lending contracts can
// read the tip with the same type this contract stores (#212). Re-exported
// here so `crate::types::{HeaderEntry, BestTip}` keeps working.
pub use spv_types::{BestTip, HeaderEntry};

// `verify_transaction`'s return type, `SpvVerificationResult`, lives in the
// shared `spv-types` crate - see that crate's doc comment for why. Re-exported
// from `lib.rs`, not redefined here.
