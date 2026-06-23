use soroban_sdk::{contracttype, Address, Bytes, BytesN};

/// Position lifecycle states.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PositionStatus {
    Active,
    /// Loan fully repaid; protocol co-signature for BTC release has been emitted.
    Closed,
    /// Position was undercollateralized and liquidated by the keeper.
    Liquidated,
}

/// A single BTC-collateralized lending position.
///
/// Stored in per-entry persistent storage keyed by Bitcoin txid.
/// Never stored in a growing collection on the instance — see CertiK warning
/// about unbounded instance storage growth.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    /// Bitcoin transaction ID (32 bytes, internal/little-endian byte order).
    pub btc_txid: BytesN<32>,
    /// Satoshis locked in the P2WSH output — verified on-chain from raw_tx.
    pub btc_satoshis: u64,
    /// Outstanding USDC debt in stroops (1 USDC = 10_000_000 stroops).
    /// Grows with each interest accrual.
    pub usdc_debt: i128,
    /// The 34-byte P2WSH scriptPubKey (OP_0 + 32-byte script hash) of this deposit.
    /// Used by the backend to identify which UTXO to co-sign for release.
    pub p2wsh_script_pubkey: Bytes,
    /// Absolute Bitcoin block height for the CLTV emergency escape hatch.
    pub timelock_height: u32,
    /// Stellar ledger sequence number at the last interest accrual.
    pub last_update_ledger: u32,
    /// The depositor's Stellar address (must repay to close the position).
    pub depositor: Address,
    pub status: PositionStatus,
}

/// Global protocol accounting.
///
/// A single instance stored under `DataKey::Protocol`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolState {
    /// Total USDC supplied by lenders (in stroops). Does not decrease when
    /// interest accrues — interest earned increases the effective value of
    /// each lender's share.
    pub total_supplied: i128,
    /// Total outstanding USDC debt across all active positions (in stroops).
    /// Updated on every borrow, repay, accrual, and liquidation.
    pub total_borrowed: i128,
}

/// Immutable protocol configuration set at initialization.
///
/// Stored under `DataKey::Config` in persistent storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// Admin address — can update the keeper address.
    pub admin: Address,
    /// Address of the deployed `bitcoin-spv` Soroban contract.
    pub spv_contract: Address,
    /// Address of the USDC Stellar Asset Contract on this network.
    pub usdc_token: Address,
    /// Address of the SEP-40 BTC/USD price oracle (RedStone primary).
    pub oracle: Address,
    /// Trusted keeper address for Phase 1 liquidations.
    pub keeper: Address,
    /// Minimum BTC deposit in satoshis (default: 100_000 = 0.001 BTC).
    pub min_deposit_satoshis: u64,
    /// Minimum collateral ratio in basis points (15_000 = 150%).
    pub min_collateral_ratio_bp: u32,
    /// Health ratio below which a position can be liquidated (12_000 = 120%).
    pub liquidation_threshold_bp: u32,
    /// Bonus the liquidator earns expressed as additional BTC % (1_000 = 10%).
    pub liquidation_bonus_bp: u32,
    /// Minimum SPV confirmation depth before a deposit is accepted (default: 6).
    pub min_confirmations: u32,
}

/// Return type of the cross-contract SPV verification call.
///
/// Must match the `VerificationResult` contracttype in the `bitcoin-spv` contract
/// field-for-field so that Soroban's Val encoding deserializes correctly.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SpvResult {
    pub txid: BytesN<32>,
    pub block_hash: BytesN<32>,
    pub confirmations: u32,
}
