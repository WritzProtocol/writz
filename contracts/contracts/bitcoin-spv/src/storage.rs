use soroban_sdk::{contracttype, Env};

use crate::types::{Checkpoint, Config};

/// Storage keys — each variant maps to an isolated persistent storage entry.
///
/// Using per-entry keying (not a single growing map) prevents unbounded
/// instance storage growth, matching the convention already used in
/// `private-lend`/`commitment-tree`.
#[contracttype]
pub enum DataKey {
    /// Singleton: contract admin (set once at initialization).
    Config,
    /// Singleton: the admin-set difficulty-anchor checkpoint.
    Checkpoint,
}

// Each ledger targets a 5-second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

// Config and Checkpoint are read on every `verify_transaction` call, so they
// use the same frequently-touched-singleton window as `private-lend`'s
// Config/Protocol entries.
const PERSISTENT_BUMP: u32 = 90 * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

// ── Config ────────────────────────────────────────────────────────────────────

pub fn get_config(env: &Env) -> Option<Config> {
    let key = DataKey::Config;
    let result: Option<Config> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_config(env: &Env, config: &Config) {
    let key = DataKey::Config;
    env.storage().persistent().set(&key, config);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

pub fn get_checkpoint(env: &Env) -> Option<Checkpoint> {
    let key = DataKey::Checkpoint;
    let result: Option<Checkpoint> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_checkpoint(env: &Env, checkpoint: &Checkpoint) {
    let key = DataKey::Checkpoint;
    env.storage().persistent().set(&key, checkpoint);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Extends the TTL of both Config and Checkpoint. Permissionless — mirrors
/// `private-lend::refresh_protocol_ttl`. Extends both entries so an
/// inactive deployment doesn't silently expire into
/// `NotInitialized`/`CheckpointNotSet`.
pub fn refresh_ttl(env: &Env) {
    let config_key = DataKey::Config;
    if env.storage().persistent().has(&config_key) {
        env.storage()
            .persistent()
            .extend_ttl(&config_key, 0, PERSISTENT_BUMP);
    }
    let checkpoint_key = DataKey::Checkpoint;
    if env.storage().persistent().has(&checkpoint_key) {
        env.storage()
            .persistent()
            .extend_ttl(&checkpoint_key, 0, PERSISTENT_BUMP);
    }
}
