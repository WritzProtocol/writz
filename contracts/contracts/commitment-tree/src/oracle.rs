/// `get_btc_price_stroops`/`STUB_PRICE_STROOPS_PER_BTC` live in the shared
/// `spv-types` crate. This contract still uses the fixed stub deliberately,
/// not as an oversight - its ZK circuits commit to an exact `btc_price`
/// public signal with no tolerance window or timestamp, so a live, moving
/// price would make honest borrows/repays fail intermittently whenever the
/// price ticks over between proof generation and on-chain submission. See
/// `spv_types`'s own doc comment and
/// `docs/superpowers/plans/2026-09-17-reflector-oracle-integration.md`,
/// "Why commitment-tree is not included", before attempting to wire a real
/// oracle in here the same way `private-lend` now does.
pub use spv_types::get_btc_price_stroops;
