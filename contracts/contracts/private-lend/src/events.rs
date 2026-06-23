use soroban_sdk::{contractevent, Address, Bytes, BytesN};

/// Emitted when a BTC deposit is registered via SPV proof.
#[contractevent(topics = ["deposit"])]
pub struct DepositEvent {
    #[topic]
    pub txid:             BytesN<32>,
    pub btc_satoshis:     u64,
    pub timelock_height:  u32,
}

/// Emitted when a borrower draws USDC against a BTC position.
#[contractevent(topics = ["borrow"])]
pub struct BorrowEvent {
    #[topic]
    pub txid:        BytesN<32>,
    pub borrower:    Address,
    pub usdc_amount: i128,
}

/// Emitted when a repayment fully clears the outstanding debt.
///
/// The Writz backend monitors this event to co-sign the Bitcoin release
/// transaction (spending path A: protocol key + user key).
#[contractevent(topics = ["repay_full"])]
pub struct RepayFullEvent {
    #[topic]
    pub txid:                BytesN<32>,
    pub repayer:             Address,
    pub p2wsh_script_pubkey: Bytes,
}

/// Emitted when a partial repayment reduces but does not clear the debt.
#[contractevent(topics = ["repay"])]
pub struct RepayEvent {
    #[topic]
    pub txid:        BytesN<32>,
    pub usdc_amount: i128,
}

/// Emitted when a keeper liquidates an undercollateralized position.
///
/// The Writz backend monitors this event to co-sign the Bitcoin release
/// to the keeper at a discount of `liquidation_bonus_bp / 100` percent.
#[contractevent(topics = ["liquidate"])]
pub struct LiquidateEvent {
    #[topic]
    pub txid:                BytesN<32>,
    pub keeper:              Address,
    pub p2wsh_script_pubkey: Bytes,
    pub liquidation_bonus_bp: u32,
}
