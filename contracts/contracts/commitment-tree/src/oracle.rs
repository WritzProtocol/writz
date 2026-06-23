use soroban_sdk::{Address, Env};

/// Hardcoded testnet price: $60,000 USD per BTC, expressed in USDC stroops
/// (7 decimal places) so that:
///   collateral_usdc = btc_satoshis × STUB_PRICE / 100_000_000
pub const STUB_PRICE_STROOPS_PER_BTC: i128 = 60_000 * 10_000_000; // = 600_000_000_000

/// Returns the BTC/USD price as USDC stroops per BTC.
///
/// Phase 1: returns `STUB_PRICE_STROOPS_PER_BTC` unconditionally.
/// Phase 2 migration: replace the body with a SEP-40 cross-contract call:
/// ```text
/// fn lastprice(asset: Asset) -> Option<PriceData>
/// // PriceData = { price: i128, timestamp: u64 }
/// ```
pub fn get_btc_price_stroops(_env: &Env, _oracle: &Address) -> i128 {
    STUB_PRICE_STROOPS_PER_BTC
}
