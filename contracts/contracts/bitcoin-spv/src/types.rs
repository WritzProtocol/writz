use soroban_sdk::{contracttype, Address, BytesN};

/// Contract configuration, set once at `initialize()`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// Address authorized to update the checkpoint and rotate the admin.
    pub admin: Address,
}

/// The admin-set difficulty-anchor checkpoint.
///
/// Every header submitted to `verify_transaction` must have a target no
/// easier than `target(bits) << MAX_DIFFICULTY_EASE_SHIFT`, preventing an
/// attacker from fabricating a chain mined at a historically low (e.g.
/// 2009-era) difficulty. `height`/`block_hash` are stored for admin
/// auditability and to leave room for a future strict hash-linkage mode;
/// only `bits` is enforced in v1. See `docs/security/security-model.md`
/// for the full trust-model discussion.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    /// Bitcoin block height this checkpoint was taken at.
    pub height: u32,
    /// The block hash at `height`, for auditability (not itself checked).
    pub block_hash: BytesN<32>,
    /// The real Bitcoin network's compact difficulty target at `height`.
    /// This is the value enforced by the difficulty-band check.
    pub bits: u32,
    /// `env.ledger().sequence()` when this checkpoint was set - for
    /// operational staleness monitoring. The checkpoint should be refreshed
    /// periodically (operationally, weekly) to keep the difficulty floor
    /// meaningful as real Bitcoin difficulty rises.
    pub set_at_ledger: u32,
}

// `verify_transaction`'s return type, `SpvVerificationResult`, lives in the
// shared `spv-types` crate - see that crate's doc comment for why. Re-exported
// from `lib.rs`, not redefined here.
