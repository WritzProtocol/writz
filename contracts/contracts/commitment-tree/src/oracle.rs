/// `get_btc_price_stroops`/`STUB_PRICE_STROOPS_PER_BTC` live in the shared
/// `spv-types` crate now - this file previously carried its own byte-for-byte
/// copy (also duplicated in `private-lend/src/oracle.rs`). Re-exported here
/// so the existing call site in this crate (`use oracle::get_btc_price_stroops`)
/// doesn't need to change.
pub use spv_types::get_btc_price_stroops;
