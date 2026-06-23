/// BTC/USD price oracle interface.
///
/// Phase 1: hardcoded stub that returns a fixed price.
///
/// Phase 2 migration: replace the body of `get_btc_price_stroops` with an
/// actual SEP-40 cross-contract call to the RedStone oracle.  The SEP-40
/// interface is:
///
/// ```text
/// fn lastprice(asset: Asset) -> Option<PriceData>
/// // where PriceData = { price: i128, timestamp: u64 }
/// // price is denominated in the quote asset with 7 decimal places.
/// ```
///
/// The oracle address is stored in `Config.oracle` and passed at every call
/// site so the integration point is explicit and easy to swap.

use soroban_sdk::{Address, Env};

/// Hardcoded testnet price: $60,000 USD per BTC.
///
/// Expressed in USDC stroops (7 decimal places) per BTC so that:
///   collateral_usdc_stroops = btc_satoshis × STUB_PRICE / 100_000_000
pub const STUB_PRICE_STROOPS_PER_BTC: i128 = 60_000 * 10_000_000; // = 600_000_000_000

/// Returns the BTC/USD price as USDC stroops per BTC.
///
/// Phase 1: returns `STUB_PRICE_STROOPS_PER_BTC` unconditionally.
/// The `_env` and `_oracle` parameters are present so that Phase 2 only
/// needs to change this function body, not every call site.
pub fn get_btc_price_stroops(_env: &Env, _oracle: &Address) -> i128 {
    // TODO Phase 2: invoke SEP-40 oracle cross-contract call:
    //   let price_data: PriceData = _env.invoke_contract(
    //       _oracle,
    //       &Symbol::new(_env, "lastprice"),
    //       (btc_asset,).into_val(_env),
    //   );
    //   return price_data.price;
    STUB_PRICE_STROOPS_PER_BTC
}

/// Computes the USDC strop value of `btc_satoshis` at the given price.
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
    collateral_stroops
        .saturating_mul(10_000)
        / debt_stroops
}
