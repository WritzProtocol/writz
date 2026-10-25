use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, IntoVal, Val};

use crate::types::{Config, Position, ProtocolState};

/// Storage keys - each variant maps to an isolated persistent storage entry.
///
/// Using per-entry keying (not a single growing map) prevents unbounded
/// instance storage growth, which is the #1 Soroban vulnerability class
/// identified by the Stellar Audit Bank (CertiK, OtterSec, Zellic).
#[contracttype]
pub enum DataKey {
    /// Singleton: protocol configuration (set once at initialization).
    Config,
    /// Singleton: global accounting state (borrowed/supplied totals).
    Protocol,
    /// Per-deposit position, keyed by the Bitcoin txid.
    Position(BytesN<32>),
    /// Per-lender supply balance, **scaled**: USDC value is
    /// `scaled * supply_index / INDEX_ONE`.
    SupplyBalance(Address),
    /// The relayer-published, co-signed Path A release PSBT for a fully
    /// repaid position, keyed by Bitcoin txid. Lets a user
    /// retrieve and broadcast their release transaction even if the Writz
    /// frontend is unavailable.
    ReleasePsbt(BytesN<32>),
}

// Each ledger targets a 5-second close time.
pub const LEDGERS_PER_DAY: u32 = 17_280;

// Frequently-touched singletons (Config, Protocol): 90-day window.
// Every state-changing call reads config and updates protocol, so these
// entries are refreshed on every transaction. They are written once per
// deployment, so their rent does not scale with use.
const PERSISTENT_BUMP:      u32 = 90  * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30  * LEDGERS_PER_DAY;

// Per-user entries (Position, SupplyBalance, ReleasePsbt) are kept live for
// `Config::entry_ttl_ledgers`, set at deployment. Each deposit, supply or
// release creates one, and the rent for that window is paid by the
// transaction that creates it, at whatever rate the network charges then.
// Mainnet runs the network maximum (180 days); a network whose live state is
// above its target size can price that window above what one transaction
// fee can hold, so it runs a short window and keeps live entries up with the
// permissionless `refresh_*` calls instead.

/// Longest `entry_ttl_ledgers` the constructor accepts: the network's
/// maximum entry TTL (`maxEntryTtl`, 3,110,400 ledgers, about 180 days).
pub const MAX_ENTRY_TTL_LEDGERS: u32 = 180 * LEDGERS_PER_DAY;
/// Shortest `entry_ttl_ledgers` the constructor accepts. A window below the
/// network's minimum persistent TTL (7 days today) only means an entry is
/// never extended past that minimum; it never shortens one.
pub const MIN_ENTRY_TTL_LEDGERS: u32 = LEDGERS_PER_DAY;

// A touched per-user entry is topped back up to its window once less than
// a third of it remains, never waiting past the last 30 days. Mainnet's
// 180-day window keeps the 30-day threshold it has always had.
const PERMANENT_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

fn touch_threshold(window: u32) -> u32 {
    (window / 3).min(PERMANENT_THRESHOLD)
}

/// Extends `key` to `window` ledgers if less than `touch_threshold(window)`
/// remain. `extend_ttl` never shortens an entry, so a window below the
/// network minimum leaves a new entry at that minimum.
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

/// The per-user entry window this deployment was configured with.
pub fn entry_ttl(env: &Env) -> u32 {
    get_config(env).map_or(0, |c| c.entry_ttl_ledgers)
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

// ── ProtocolState ─────────────────────────────────────────────────────────────

pub fn get_protocol(env: &Env) -> ProtocolState {
    let key = DataKey::Protocol;
    match env.storage().persistent().get::<_, ProtocolState>(&key) {
        Some(state) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
            state
        }
        // No ProtocolState written yet (lazy-initialized on first activity).
        // `last_keeper_heartbeat` defaults to "now", not epoch zero - this
        // starts the stale-keeper window fresh from first contact
        // rather than having liquidation open to anyone immediately after
        // `initialize()`, before the keeper has had any chance to act.
        None => ProtocolState {
            reserve_usdc: 0,
            total_scaled_supply: 0,
            supply_index: crate::rates::INDEX_ONE,
            total_borrowed: 0,
            last_keeper_heartbeat: env.ledger().timestamp(),
            borrow_index: crate::rates::INDEX_ONE,
            index_ledger: env.ledger().sequence(),
        },
    }
}

pub fn set_protocol(env: &Env, state: &ProtocolState) {
    let key = DataKey::Protocol;
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn refresh_protocol_ttl(env: &Env) {
    let proto_key = DataKey::Protocol;
    if env.storage().persistent().has(&proto_key) {
        refresh(env, &proto_key, PERSISTENT_BUMP);
    }
    // Also extend Config: if it expires, all functions return NotInitialized.
    let config_key = DataKey::Config;
    if env.storage().persistent().has(&config_key) {
        refresh(env, &config_key, PERSISTENT_BUMP);
    }
}

// ── Position ──────────────────────────────────────────────────────────────────

/// Reads a position and, when it is near the end of its window, tops it
/// back up, so a loan that is being borrowed against, repaid or liquidated
/// stays live without a separate refresh.
pub fn get_position(env: &Env, txid: &BytesN<32>, ttl: u32) -> Option<Position> {
    let key = DataKey::Position(txid.clone());
    let result: Option<Position> = env.storage().persistent().get(&key);
    if result.is_some() {
        touch(env, &key, ttl);
    }
    result
}

pub fn set_position(env: &Env, txid: &BytesN<32>, pos: &Position, ttl: u32) {
    let key = DataKey::Position(txid.clone());
    env.storage().persistent().set(&key, pos);
    touch(env, &key, ttl);
}

/// Extend the TTL of a position entry to the full configured window.
///
/// Permissionless: any keeper or the borrower themselves can call this.
/// Returns false if no position exists for the given txid.
pub fn refresh_position_ttl(env: &Env, txid: &BytesN<32>, ttl: u32) -> bool {
    let key = DataKey::Position(txid.clone());
    if !env.storage().persistent().has(&key) {
        return false;
    }
    refresh(env, &key, ttl);
    true
}

// ── Supply balance ────────────────────────────────────────────────────────────

pub fn get_supply_balance(env: &Env, lender: &Address, ttl: u32) -> i128 {
    let key = DataKey::SupplyBalance(lender.clone());
    match env.storage().persistent().get::<_, i128>(&key) {
        Some(bal) => {
            touch(env, &key, ttl);
            bal
        }
        None => 0,
    }
}

pub fn set_supply_balance(env: &Env, lender: &Address, balance: i128, ttl: u32) {
    let key = DataKey::SupplyBalance(lender.clone());
    env.storage().persistent().set(&key, &balance);
    touch(env, &key, ttl);
}

/// Extend the TTL of a lender's supply balance entry.
///
/// Permissionless. Returns false if the lender has no recorded balance.
pub fn refresh_supply_balance_ttl(env: &Env, lender: &Address, ttl: u32) -> bool {
    let key = DataKey::SupplyBalance(lender.clone());
    if !env.storage().persistent().has(&key) {
        return false;
    }
    refresh(env, &key, ttl);
    true
}

// ── Release PSBT ─────────────────────────────────────────────────────────────

pub fn get_release_psbt(env: &Env, txid: &BytesN<32>, ttl: u32) -> Option<Bytes> {
    let key = DataKey::ReleasePsbt(txid.clone());
    let result: Option<Bytes> = env.storage().persistent().get(&key);
    if result.is_some() {
        touch(env, &key, ttl);
    }
    result
}

pub fn set_release_psbt(env: &Env, txid: &BytesN<32>, psbt: &Bytes, ttl: u32) {
    let key = DataKey::ReleasePsbt(txid.clone());
    env.storage().persistent().set(&key, psbt);
    touch(env, &key, ttl);
}

/// Extend the TTL of a published release PSBT.
///
/// Permissionless - mirrors `refresh_position_ttl`/`refresh_supply_balance_ttl`.
/// Unlike those two, `ReleasePsbt` was previously only bumped as a side effect
/// of `get_release_psbt`/`set_release_psbt`, with no standalone refresh path.
/// A user who has repaid but hasn't yet fetched or broadcast their release
/// transaction could otherwise let this entry expire with no way to bump it
/// short of triggering another write. Returns false if no PSBT is on record
/// for this txid.
pub fn refresh_release_psbt_ttl(env: &Env, txid: &BytesN<32>, ttl: u32) -> bool {
    let key = DataKey::ReleasePsbt(txid.clone());
    if !env.storage().persistent().has(&key) {
        return false;
    }
    refresh(env, &key, ttl);
    true
}
