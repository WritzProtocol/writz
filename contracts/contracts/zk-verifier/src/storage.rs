use soroban_sdk::{Address, Env};

use crate::types::{CircuitId, DataKey, VerificationKey};

// Each ledger targets a 5-second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

// Admin (instance storage) and each circuit's VerificationKey (persistent
// storage) are read on every proof verification, so they use the same
// frequently-touched-singleton window as bitcoin-spv's Config/Checkpoint and
// private-lend's Config/Protocol. Before this module existed, nothing in this
// contract ever called `extend_ttl` - an idle deployment would silently run
// its verification keys past their TTL and start failing `verify_deposit`/
// `verify_borrow_repay`/`verify_liquidation` with `VerificationKeyNotSet`,
// with no on-chain signal that anything was wrong until the first failed call.
const PERSISTENT_BUMP: u32 = 90 * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

/// All circuits this contract holds a verification key for. Used by
/// `refresh_ttl` to bump every key without the caller needing to name them.
const ALL_CIRCUITS: [CircuitId; 3] = [
    CircuitId::Deposit,
    CircuitId::BorrowRepay,
    CircuitId::Liquidation,
];

// ── Admin (instance storage) ────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Option<Address> {
    let result: Option<Address> = env.storage().instance().get(&DataKey::Admin);
    if result.is_some() {
        env.storage().instance().extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
    env.storage().instance().extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

// ── Verification keys (persistent storage, one entry per circuit) ──────────

pub fn get_verification_key(env: &Env, circuit: CircuitId) -> Option<VerificationKey> {
    let key = DataKey::VerificationKey(circuit);
    let result: Option<VerificationKey> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    result
}

pub fn set_verification_key(env: &Env, circuit: CircuitId, vk: &VerificationKey) {
    let key = DataKey::VerificationKey(circuit);
    env.storage().persistent().set(&key, vk);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Extends the TTL of the admin entry and every circuit's verification key
/// that has actually been set. Permissionless - mirrors
/// `bitcoin-spv::refresh_ttl` / `private-lend::refresh_protocol_ttl`. Safe to
/// call on a schedule (e.g. from the same job that refreshes the SPV
/// checkpoint) so an infrequently-used deployment doesn't silently expire.
pub fn refresh_ttl(env: &Env) {
    if has_admin(env) {
        env.storage().instance().extend_ttl(0, PERSISTENT_BUMP);
    }
    for circuit in ALL_CIRCUITS {
        let key = DataKey::VerificationKey(circuit);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, 0, PERSISTENT_BUMP);
        }
    }
}
