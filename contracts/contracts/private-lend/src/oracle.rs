/// BTC/USD price oracle interface.
///
/// `get_btc_price_stroops`/`STUB_PRICE_STROOPS_PER_BTC` live in the shared
/// `spv-types` crate now - this file previously carried its own byte-for-byte
/// copy (also duplicated in `commitment-tree/src/oracle.rs`). Re-exported
/// here so existing call sites in this crate (`use oracle::get_btc_price_stroops`)
/// don't need to change.
///
/// The oracle address is stored in `Config.oracle` and passed at every call
/// site so the integration point is explicit and easy to swap - though
/// swapping the *implementation* still requires editing the shared function
/// body in `spv-types`, not just the address; see that crate's doc comment.
pub use spv_types::get_btc_price_stroops;

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
