use soroban_sdk::{contracttype, BytesN, Env, IntoVal, Val};

use crate::types::{BestTip, Checkpoint, Config, HeaderEntry};

/// Storage keys - each variant maps to an isolated persistent storage entry.
///
/// Using per-entry keying (not a single growing map) prevents unbounded
/// instance storage growth, matching the convention already used in
/// `writz-lend`/`commitment-tree`.
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
    /// Lending contracts allowed to consume deposit txids.
    Consumer(soroban_sdk::Address),
    /// Deposit txids already consumed by a lending contract (GHSA-2975-ggwh-pxw5).
    Consumed(BytesN<32>),
}

// Each ledger targets a 5-second close time.
pub const LEDGERS_PER_DAY: u32 = 17_280;

// Config and Checkpoint are read on every `verify_transaction` call, so they
// use the same frequently-touched-singleton window as `writz-lend`'s
// Config/Protocol entries.
const PERSISTENT_BUMP: u32 = 90 * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

// Entries created per use - a `Header` and a `Canonical` index entry for
// every block the relayer submits, a `Consumed` marker for every deposit -
// are kept live for windows set at deployment (`Config::header_ttl_ledgers`,
// `Config::consumed_ttl_ledgers`). The creating transaction pays rent for
// the whole window at whatever rate the network charges then. Mainnet runs
// 90 days; a network whose live state is above its target size can price
// that above what one transaction fee can hold, so it runs a short window.

/// Longest window the constructor accepts: the network's maximum entry TTL
/// (`maxEntryTtl`, 3,110,400 ledgers, about 180 days).
pub const MAX_ENTRY_TTL_LEDGERS: u32 = 180 * LEDGERS_PER_DAY;
/// Shortest window the constructor accepts. A window below the network's
/// minimum persistent TTL (7 days today) only means an entry is never
/// extended past that minimum; it never shortens one.
pub const MIN_ENTRY_TTL_LEDGERS: u32 = LEDGERS_PER_DAY;

/// A touched entry is topped back up to its window once less than a third
/// of it remains, never waiting past the last 30 days. Mainnet's 90-day
/// window keeps the 30-day threshold it has always had.
fn touch_threshold(window: u32) -> u32 {
    (window / 3).min(PERSISTENT_THRESHOLD)
}

fn touch<K: IntoVal<Env, Val>>(env: &Env, key: &K, window: u32) {
    env.storage()
        .persistent()
        .extend_ttl(key, touch_threshold(window), window);
}

/// Extends `key` to the full `window` whenever less than that remains. The
/// threshold must not be 0: a TTL is never below 0, so `extend_ttl(key, 0, _)`
/// never extends anything.
fn refresh<K: IntoVal<Env, Val>>(env: &Env, key: &K, window: u32) {
    env.storage().persistent().extend_ttl(key, window, window);
}

/// The header window this deployment was configured with.
pub fn header_ttl(env: &Env) -> u32 {
    get_config(env).map_or(0, |c| c.header_ttl_ledgers)
}

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

pub fn get_header(env: &Env, hash: &BytesN<32>, ttl: u32) -> Option<HeaderEntry> {
    let key = DataKey::Header(hash.clone());
    let result: Option<HeaderEntry> = env.storage().persistent().get(&key);
    if result.is_some() {
        touch(env, &key, ttl);
    }
    result
}

pub fn set_header(env: &Env, hash: &BytesN<32>, entry: &HeaderEntry, ttl: u32) {
    let key = DataKey::Header(hash.clone());
    env.storage().persistent().set(&key, entry);
    touch(env, &key, ttl);
}

pub fn get_canonical(env: &Env, height: u32, ttl: u32) -> Option<BytesN<32>> {
    let key = DataKey::Canonical(height);
    let result: Option<BytesN<32>> = env.storage().persistent().get(&key);
    if result.is_some() {
        touch(env, &key, ttl);
    }
    result
}

pub fn set_canonical(env: &Env, height: u32, hash: &BytesN<32>, ttl: u32) {
    let key = DataKey::Canonical(height);
    env.storage().persistent().set(&key, hash);
    touch(env, &key, ttl);
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

/// Extends the TTL of Config, Checkpoint and the best tip to their full
/// window. Permissionless - mirrors `writz-lend::refresh_protocol_ttl`. An
/// inactive deployment would otherwise let these expire and need a restore
/// before `NotInitialized`/`CheckpointNotSet` stop being the answer. The
/// tip's header is extended to the header window: it is the parent the next
/// submitted header needs.
pub fn refresh_ttl(env: &Env) {
    let config_key = DataKey::Config;
    let header_ttl = header_ttl(env);
    if env.storage().persistent().has(&config_key) {
        refresh(env, &config_key, PERSISTENT_BUMP);
    }
    let checkpoint_key = DataKey::Checkpoint;
    if env.storage().persistent().has(&checkpoint_key) {
        refresh(env, &checkpoint_key, PERSISTENT_BUMP);
    }
    if let Some(tip) = env.storage().persistent().get::<_, BestTip>(&DataKey::BestTip) {
        refresh(env, &DataKey::BestTip, PERSISTENT_BUMP);
        let header_key = DataKey::Header(tip.hash.clone());
        if env.storage().persistent().has(&header_key) {
            refresh(env, &header_key, header_ttl);
        }
    }
}

// ── Shared deposit registry ───────────────────────────────────────────────────

pub fn is_consumer(env: &Env, consumer: &soroban_sdk::Address) -> bool {
    let key = DataKey::Consumer(consumer.clone());
    env.storage().persistent().get(&key).unwrap_or(false)
}

pub fn set_consumer(env: &Env, consumer: &soroban_sdk::Address, allowed: bool) {
    let key = DataKey::Consumer(consumer.clone());
    env.storage().persistent().set(&key, &allowed);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn is_consumed(env: &Env, txid: &BytesN<32>) -> bool {
    let key = DataKey::Consumed(txid.clone());
    env.storage().persistent().has(&key)
}

/// A consumed marker is never removed. Once its window ends it is archived,
/// not deleted: an archived entry cannot be read or overwritten until it is
/// restored, unchanged, so the txid stays consumed (see `is_consumed`).
pub fn set_consumed(env: &Env, txid: &BytesN<32>, ttl: u32) {
    let key = DataKey::Consumed(txid.clone());
    env.storage().persistent().set(&key, &true);
    touch(env, &key, ttl);
}

