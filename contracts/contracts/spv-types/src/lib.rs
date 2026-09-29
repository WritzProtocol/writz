#![no_std]

//! Shared cross-contract types for Bitcoin SPV verification.
//!
//! Before this crate existed, `SpvVerificationResult` (as `VerificationResult`
//! in `bitcoin-spv` and `SpvResult` in `commitment-tree`/`private-lend`) was
//! hand-copied verbatim into three separate crates, each with a comment
//! warning that "field names must match exactly for XDR round-tripping" - a
//! constraint the compiler could not check, since nothing tied the three
//! definitions together. `env.invoke_contract::<T>(...)` decodes a callee's
//! XDR return value into whatever type `T` the caller names locally, so this
//! duplication was never strictly required for the cross-contract call to
//! work - only convenient at the time. Sharing one real type here means a
//! future field change is a single edit the compiler enforces everywhere,
//! not three edits a human has to remember to keep in sync.
//!
//! `bitcoin-spv::verify_transaction` returns this type directly (a rename
//! from its previous local `VerificationResult` - no field changes, so any
//! caller decoding by field name is unaffected; only the on-chain contract
//! spec's type name changes). `commitment-tree` and `private-lend` use it as
//! the expected return type for their `env.invoke_contract` calls into
//! `bitcoin-spv`.

use soroban_sdk::{contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    /// The transaction identifier: SHA256d of the non-witness serialization.
    pub txid: BytesN<32>,

    /// The hash (SHA256d) of the block that contains the transaction.
    pub block_hash: BytesN<32>,

    /// Bitcoin height of the block that contains the transaction.
    pub block_height: u32,

    /// The block's depth below the best chain tip (the tip itself is 1).
    pub confirmations: u32,
}

/// Hardcoded testnet price: $60,000 USD per BTC, expressed in USDC stroops
/// (7 decimal places) so that:
///   collateral_usdc = btc_satoshis × STUB_PRICE / 100_000_000
///
/// As of 2026-09-17, `private-lend` no longer uses this - it calls a real
/// Reflector oracle via its own `oracle::get_btc_price_stroops`
/// (`contracts/contracts/private-lend/src/oracle.rs`). This stub remains
/// solely for `commitment-tree`, which cannot safely take a live, moving
/// price yet: its ZK circuits commit to an exact `btc_price` public signal
/// with no tolerance window or timestamp, so a price that changes between
/// proof generation and on-chain submission would make legitimate
/// borrows/repays fail intermittently. Wiring a real oracle into
/// `commitment-tree` needs a circuit-level change first - see
/// `docs/research/oracle-design.md` and the plan at
/// `docs/superpowers/plans/2026-09-17-reflector-oracle-integration.md`,
/// "Why commitment-tree is not included".
pub const STUB_PRICE_STROOPS_PER_BTC: i128 = 60_000 * 10_000_000; // = 600_000_000_000

/// Returns the BTC/USD price as USDC stroops per BTC.
///
/// Only `commitment-tree` still routes through this stub (`private-lend`
/// now calls a real Reflector oracle via its own `oracle.rs` instead) -
/// swapping in a real price feed here requires changing this function's
/// body (not just the `Config.oracle` address this contract already
/// supports via its `set_oracle` setter), since the address alone is never
/// read here yet. See `docs/roadmap/phases.md` for the Phase 2 oracle
/// integration this blocks on.
///
/// Phase 2 migration: replace the body with a SEP-40 cross-contract call:
/// ```text
/// fn lastprice(asset: Asset) -> Option<PriceData>
/// // PriceData = { price: i128, timestamp: u64 }
/// ```
pub fn get_btc_price_stroops(_env: &Env, _oracle: &Address) -> i128 {
    STUB_PRICE_STROOPS_PER_BTC
}
