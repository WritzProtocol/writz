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

/// Emitted when a lender supplies USDC to the pool.
///
/// Closes a gap noted in `docs/architecture/contract-migration-runbook.md`:
/// without this event, lenders could not be enumerated off-chain at all
/// (`get_supply_balance` requires already knowing the address).
#[contractevent(topics = ["supply"])]
pub struct SupplyEvent {
    #[topic]
    pub supplier:       Address,
    pub usdc_amount:    i128,
    pub total_supplied: i128,
}

/// Emitted when a lender withdraws USDC from the pool.
#[contractevent(topics = ["withdraw"])]
pub struct WithdrawEvent {
    #[topic]
    pub supplier:       Address,
    pub usdc_amount:    i128,
    pub total_supplied: i128,
}

/// Emitted when the admin pauses or unpauses new deposits/borrows/supply.
/// Existing positions are never affected by a pause - see `Config::paused`.
#[contractevent(topics = ["paused_set"])]
pub struct PausedSetEvent {
    #[topic]
    pub admin:  Address,
    pub paused: bool,
}

/// Emitted when the admin changes the oracle contract address.
/// Since `get_btc_price_stroops` calls this address live for every
/// price-dependent operation, a change here is a change in real collateral
/// pricing and should be observable off-chain - see `set_oracle`.
#[contractevent(topics = ["oracle_set"])]
pub struct OracleSetEvent {
    #[topic]
    pub admin:      Address,
    pub new_oracle: Address,
}
