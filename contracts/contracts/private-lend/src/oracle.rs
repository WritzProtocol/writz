//! BTC/USD price oracle integration.
//!
//! Wired to Reflector's "external CEXs & DEXs" Stellar instance - the one
//! confirmed by direct on-chain verification (2026-09-16, see
//! `docs/research/oracle-design.md` and `contracts/scripts/verify-oracles.sh`)
//! to carry a real, live BTC/USD price, not a wrapped-token substitute.
//! Pyth is the documented secondary source but is not wired here yet: its
//! Stellar contract is a signature verifier, not a price reader, so
//! consuming it requires the caller to supply a live signed Hermes payload
//! per call - deferred to a follow-up pass once that flow is proven
//! end-to-end (see `docs/research/oracle-design.md`, "Before wiring this
//! in"). Until then this is a single-source oracle, not the median design
//! the docs describe as the target - see `docs/security/security-model.md`
//! for the manipulation-resistance implications of that interim gap.

use crate::error::PrivateLendError;
use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol};

/// SEP-40 asset identifier. Field/variant shape must match Reflector's own
/// `Asset` enum exactly for XDR decoding to work - the Rust type name here
/// does not need to match, only the on-the-wire shape.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price record. Shape must match Reflector's own `PriceData` struct
/// exactly (same reasoning as `Asset` above).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Minimal client for the subset of Reflector's SEP-40 interface this
/// contract needs. `#[contractclient]` generates `ReflectorClient` with a
/// `new(env, address)` constructor and one method per trait function below.
#[contractclient(name = "ReflectorClient")]
pub trait ReflectorInterface {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

/// A price older than this is rejected rather than trusted. Matches the
/// figure documented in `docs/security/security-model.md` and
/// `docs/research/oracle-design.md`. Reflector's external-prices instance
/// updates roughly every 5 minutes (confirmed via its own `resolution()`,
/// 300 seconds) - 60 minutes is a wide margin above that cadence on
/// purpose, so a legitimate short gap in updates does not itself refuse
/// pricing; only genuine staleness does.
pub const MAX_PRICE_STALENESS_SECS: u64 = 3_600;

/// USDC stroops use 7 decimal places (1 USDC = 10_000_000 stroops) - the
/// existing convention throughout this contract, not introduced here.
const USDC_DECIMALS: u32 = 7;

/// Returns the BTC/USD price as USDC stroops per BTC, or an error if the
/// oracle has no price, the price is stale, or the decimal conversion
/// overflows.
///
/// Calls Reflector's `lastprice`/`decimals` fresh on every invocation -
/// there is no caching, so a stale or unreachable oracle fails the calling
/// operation (`borrow`/`liquidate`/`get_health_ratio_bp`) rather than
/// silently reusing an old price.
pub fn get_btc_price_stroops(env: &Env, oracle: &Address) -> Result<i128, PrivateLendError> {
    let client = ReflectorClient::new(env, oracle);

    let price_data = client
        .lastprice(&Asset::Other(Symbol::new(env, "BTC")))
        .ok_or(PrivateLendError::OraclePriceUnavailable)?;

    let age_secs = env.ledger().timestamp().saturating_sub(price_data.timestamp);
    if age_secs > MAX_PRICE_STALENESS_SECS {
        return Err(PrivateLendError::OraclePriceStale);
    }

    let decimals = client.decimals();
    let price_stroops = if decimals >= USDC_DECIMALS {
        let divisor = 10i128
            .checked_pow(decimals - USDC_DECIMALS)
            .ok_or(PrivateLendError::Overflow)?;
        price_data
            .price
            .checked_div(divisor)
            .ok_or(PrivateLendError::Overflow)?
    } else {
        let multiplier = 10i128
            .checked_pow(USDC_DECIMALS - decimals)
            .ok_or(PrivateLendError::Overflow)?;
        price_data
            .price
            .checked_mul(multiplier)
            .ok_or(PrivateLendError::Overflow)?
    };

    if price_stroops <= 0 {
        return Err(PrivateLendError::OraclePriceUnavailable);
    }

    Ok(price_stroops)
}

/// Computes the USDC stroop value of `btc_satoshis` at the given price.
///
/// ```text
/// collateral = satoshis × price_stroops_per_btc / 100_000_000
/// ```
///
/// Returns `None` on overflow (should not occur with realistic BTC amounts).
pub fn collateral_value_stroops(btc_satoshis: u64, price_stroops_per_btc: i128) -> Option<i128> {
    (btc_satoshis as i128)
        .checked_mul(price_stroops_per_btc)?
        .checked_div(100_000_000)
}

/// Health ratio = (collateral / debt) × 10_000.
///
/// Returns the health ratio in basis points (15_000 = 150%).
/// Returns `i128::MAX` when debt is zero (fully repaid position is infinitely healthy).
pub fn health_ratio_bp(collateral_stroops: i128, debt_stroops: i128) -> i128 {
    if debt_stroops == 0 {
        return i128::MAX;
    }
    collateral_stroops.saturating_mul(10_000) / debt_stroops
}
