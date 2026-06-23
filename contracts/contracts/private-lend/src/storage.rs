use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::types::{Config, Position, ProtocolState};

/// Storage keys — each variant maps to an isolated persistent storage entry.
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
    /// Per-lender USDC supply balance in stroops.
    SupplyBalance(Address),
}

// Each ledger targets a 5-second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

// Frequently-touched singletons (Config, Protocol): 90-day window.
// Every state-changing call reads config and updates protocol, so these
// entries are refreshed on every transaction.
const PERSISTENT_BUMP:      u32 = 90  * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30  * LEDGERS_PER_DAY;

// Long-lived entries (Position, SupplyBalance): 180-day window (near the
// current Soroban mainnet maximum of ~3.1 M ledgers ≈ 180 days).
// Use permissionless `refresh_*` functions to extend beyond this window.
pub const PERMANENT_BUMP:      u32 = 180 * LEDGERS_PER_DAY;
pub const PERMANENT_THRESHOLD: u32 =  30 * LEDGERS_PER_DAY;

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
        None => ProtocolState {
            total_supplied: 0,
            total_borrowed: 0,
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
        env.storage().persistent().extend_ttl(&proto_key, 0, PERSISTENT_BUMP);
    }
    // Also extend Config: if it expires, all functions return NotInitialized.
    let config_key = DataKey::Config;
    if env.storage().persistent().has(&config_key) {
        env.storage().persistent().extend_ttl(&config_key, 0, PERSISTENT_BUMP);
    }
}

// ── Position ──────────────────────────────────────────────────────────────────

pub fn get_position(env: &Env, txid: &BytesN<32>) -> Option<Position> {
    let key = DataKey::Position(txid.clone());
    let result: Option<Position> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERMANENT_THRESHOLD, PERMANENT_BUMP);
    }
    result
}

pub fn set_position(env: &Env, txid: &BytesN<32>, pos: &Position) {
    let key = DataKey::Position(txid.clone());
    env.storage().persistent().set(&key, pos);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERMANENT_THRESHOLD, PERMANENT_BUMP);
}

/// Extend the TTL of a position entry to another 180-day window.
///
/// Permissionless: any keeper or the borrower themselves can call this.
/// Returns false if no position exists for the given txid.
pub fn refresh_position_ttl(env: &Env, txid: &BytesN<32>) -> bool {
    let key = DataKey::Position(txid.clone());
    if !env.storage().persistent().has(&key) {
        return false;
    }
    env.storage().persistent().extend_ttl(&key, 0, PERMANENT_BUMP);
    true
}

// ── Supply balance ────────────────────────────────────────────────────────────

pub fn get_supply_balance(env: &Env, lender: &Address) -> i128 {
    let key = DataKey::SupplyBalance(lender.clone());
    match env.storage().persistent().get::<_, i128>(&key) {
        Some(bal) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERMANENT_THRESHOLD, PERMANENT_BUMP);
            bal
        }
        None => 0,
    }
}

pub fn set_supply_balance(env: &Env, lender: &Address, balance: i128) {
    let key = DataKey::SupplyBalance(lender.clone());
    env.storage().persistent().set(&key, &balance);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERMANENT_THRESHOLD, PERMANENT_BUMP);
}

/// Extend the TTL of a lender's supply balance entry.
///
/// Permissionless. Returns false if the lender has no recorded balance.
pub fn refresh_supply_balance_ttl(env: &Env, lender: &Address) -> bool {
    let key = DataKey::SupplyBalance(lender.clone());
    if !env.storage().persistent().has(&key) {
        return false;
    }
    env.storage().persistent().extend_ttl(&key, 0, PERMANENT_BUMP);
    true
}
