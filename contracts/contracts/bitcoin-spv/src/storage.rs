use soroban_sdk::{contracttype, BytesN, Env};

use crate::types::{BestTip, Checkpoint, Config, HeaderEntry};

/// Storage keys - each variant maps to an isolated persistent storage entry.
///
/// Using per-entry keying (not a single growing map) prevents unbounded
/// instance storage growth, matching the convention already used in
/// `private-lend`/`commitment-tree`.
#[contracttype]
pub enum DataKey {
    /// Singleton: contract admin (set once at initialization).
    Config,
    /// Singleton: the admin-set trust-root checkpoint.
    Checkpoint,
    /// Singleton: tip of the most-work chain.
    BestTip,
    /// Every accepted header, keyed by block hash.
    Header(BytesN<32>),
    /// Block hash of the most-work chain at a given height.
    Canonical(u32),
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

// ── Headers / best chain ──────────────────────────────────────────────────────

pub fn get_header(env: &Env, hash: &BytesN<32>) -> Option<HeaderEntry> {
    let key = DataKey::Header(hash.clone());
    let result: Option<HeaderEntry> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_header(env: &Env, hash: &BytesN<32>, entry: &HeaderEntry) {
    let key = DataKey::Header(hash.clone());
    env.storage().persistent().set(&key, entry);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_canonical(env: &Env, height: u32) -> Option<BytesN<32>> {
    let key = DataKey::Canonical(height);
    let result: Option<BytesN<32>> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_canonical(env: &Env, height: u32, hash: &BytesN<32>) {
    let key = DataKey::Canonical(height);
    env.storage().persistent().set(&key, hash);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_best_tip(env: &Env) -> Option<BestTip> {
    let key = DataKey::BestTip;
    let result: Option<BestTip> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_best_tip(env: &Env, tip: &BestTip) {
    let key = DataKey::BestTip;
    env.storage().persistent().set(&key, tip);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Extends the TTL of both Config and Checkpoint. Permissionless - mirrors
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
    if let Some(tip) = env.storage().persistent().get::<_, BestTip>(&DataKey::BestTip) {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BestTip, 0, PERSISTENT_BUMP);
        let header_key = DataKey::Header(tip.hash.clone());
        if env.storage().persistent().has(&header_key) {
            env.storage()
                .persistent()
                .extend_ttl(&header_key, 0, PERSISTENT_BUMP);
        }
    }
}
