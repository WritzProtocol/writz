#![no_std]

mod btc_parser;
mod error;
mod events;
mod oracle;
mod rates;
mod storage;
mod types;

#[cfg(test)]
mod test;

use error::PrivateLendError;
use events::{BorrowEvent, DepositEvent, LiquidateEvent, RepayEvent, RepayFullEvent};
use oracle::{collateral_value_stroops, get_btc_price_stroops, health_ratio_bp};
use rates::{borrow_rate_bp, interest_delta, supply_rate_bp};
use soroban_sdk::{
    contract, contractimpl, token, Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};
use storage::{get_config, get_position, get_protocol, get_supply_balance, set_config,
               set_position, set_protocol, set_supply_balance};
use types::{Config, Position, PositionStatus, ProtocolState, SpvResult};

#[contract]
pub struct PrivateLendContract;

#[contractimpl]
impl PrivateLendContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time contract initialization.  Can only be called once.
    ///
    /// # Parameters
    /// - `admin`          — Address that can update the keeper.
    /// - `spv_contract`   — Deployed `bitcoin-spv` Soroban contract address.
    /// - `usdc_token`     — USDC Stellar Asset Contract address.
    /// - `oracle`         — SEP-40 BTC/USD oracle address (RedStone).
    /// - `keeper`         — Trusted liquidation keeper (Phase 1).
    pub fn initialize(
        env: Env,
        admin: Address,
        spv_contract: Address,
        usdc_token: Address,
        oracle: Address,
        keeper: Address,
    ) -> Result<(), PrivateLendError> {
        if get_config(&env).is_some() {
            return Err(PrivateLendError::AlreadyInitialized);
        }
        set_config(
            &env,
            &Config {
                admin,
                spv_contract,
                usdc_token,
                oracle,
                keeper,
                min_deposit_satoshis: 100_000,       // 0.001 BTC
                min_collateral_ratio_bp: 15_000,      // 150%
                liquidation_threshold_bp: 12_000,     // 120%
                liquidation_bonus_bp: 1_000,          // 10%
                min_confirmations: 6,
            },
        );
        Ok(())
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Register a BTC deposit by submitting an SPV proof.
    ///
    /// The contract:
    /// 1. Calls the `bitcoin-spv` contract to verify the transaction inclusion.
    /// 2. Parses the raw transaction on-chain to find the P2WSH output matching
    ///    `p2wsh_script_pubkey` and read the deposited satoshi amount.
    /// 3. Creates a `Position` entry in persistent storage.
    ///
    /// After this call succeeds the user can borrow USDC against the position.
    ///
    /// # Parameters
    /// - `depositor`          — Stellar address of the depositor (must authorize).
    /// - `headers`            — Bitcoin block headers (80 bytes each).
    /// - `merkle_proof`       — Sibling hashes for the Merkle inclusion proof.
    /// - `tx_index`           — 0-based index of the transaction in its block.
    /// - `raw_tx`             — Non-witness serialization of the Bitcoin transaction.
    /// - `p2wsh_script_pubkey`— 34-byte P2WSH scriptPubKey (OP_0 + 32-byte hash)
    ///                          of the deposit output.
    /// - `timelock_height`    — Bitcoin block height of the CLTV escape hatch.
    pub fn deposit(
        env: Env,
        depositor: Address,
        headers: Vec<BytesN<80>>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        p2wsh_script_pubkey: Bytes,
        timelock_height: u32,
    ) -> Result<BytesN<32>, PrivateLendError> {
        depositor.require_auth();

        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        // Validate the scriptPubKey is 34 bytes (OP_0 0x20 <32 bytes>).
        if p2wsh_script_pubkey.len() != 34 {
            return Err(PrivateLendError::InvalidScriptPubKey);
        }

        // 1. Cross-contract SPV verification.
        let spv_result: SpvResult = env.invoke_contract(
            &config.spv_contract,
            &Symbol::new(&env, "verify_transaction"),
            (
                headers,
                merkle_proof,
                tx_index,
                raw_tx.clone(),
                config.min_confirmations,
            )
                .into_val(&env),
        );
        let txid = spv_result.txid;

        // 2. Reject duplicate deposits.
        if get_position(&env, &txid).is_some() {
            return Err(PrivateLendError::PositionAlreadyExists);
        }

        // 3. Parse the raw transaction on-chain to find the P2WSH output.
        let btc_satoshis =
            btc_parser::find_p2wsh_output(&raw_tx, &p2wsh_script_pubkey)
                .ok_or(PrivateLendError::OutputNotFound)?;

        // 4. Enforce minimum deposit.
        if btc_satoshis < config.min_deposit_satoshis {
            return Err(PrivateLendError::DepositTooSmall);
        }

        // 5. Create the position.
        let pos = Position {
            btc_txid: txid.clone(),
            btc_satoshis,
            usdc_debt: 0,
            p2wsh_script_pubkey,
            timelock_height,
            last_update_ledger: env.ledger().sequence(),
            depositor,
            status: PositionStatus::Active,
        };
        set_position(&env, &txid, &pos);

        DepositEvent {
            txid:            txid.clone(),
            btc_satoshis:    pos.btc_satoshis,
            timelock_height: pos.timelock_height,
        }
        .publish(&env);

        Ok(txid)
    }

    // ── USDC supply ───────────────────────────────────────────────────────────

    /// Lender supplies USDC to the pool, making it available for borrowing.
    /// Lenders earn `supply_rate_bp()` APR on their supplied amount.
    pub fn supply_usdc(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), PrivateLendError> {
        supplier.require_auth();
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&supplier, &env.current_contract_address(), &amount);

        let mut proto = get_protocol(&env);
        proto.total_supplied = proto.total_supplied.saturating_add(amount);
        set_protocol(&env, &proto);

        let bal = get_supply_balance(&env, &supplier);
        set_supply_balance(&env, &supplier, bal.saturating_add(amount));

        Ok(())
    }

    /// Lender withdraws previously supplied USDC from the pool.
    pub fn withdraw_supply(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), PrivateLendError> {
        supplier.require_auth();
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        let bal = get_supply_balance(&env, &supplier);
        if amount > bal {
            return Err(PrivateLendError::InsufficientSupply);
        }

        let proto = get_protocol(&env);
        let available = proto.total_supplied.saturating_sub(proto.total_borrowed);
        if amount > available {
            return Err(PrivateLendError::InsufficientLiquidity);
        }

        set_supply_balance(&env, &supplier, bal - amount);

        let mut proto2 = get_protocol(&env);
        proto2.total_supplied = proto2.total_supplied.saturating_sub(amount);
        set_protocol(&env, &proto2);

        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&env.current_contract_address(), &supplier, &amount);

        Ok(())
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    /// Borrow USDC against an existing BTC deposit.
    ///
    /// The resulting debt must keep the position's collateral ratio at or above
    /// `min_collateral_ratio_bp` (150%).  Interest starts accruing immediately.
    ///
    /// Only the depositor who created the position can borrow against it.
    pub fn borrow(
        env: Env,
        borrower: Address,
        txid: BytesN<32>,
        usdc_amount: i128,
    ) -> Result<(), PrivateLendError> {
        borrower.require_auth();
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        let mut pos = get_position(&env, &txid).ok_or(PrivateLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(PrivateLendError::PositionNotActive);
        }
        if pos.depositor != borrower {
            return Err(PrivateLendError::Unauthorized);
        }

        let mut proto = get_protocol(&env);

        // Accrue interest first so the collateral check is accurate.
        accrue_position_interest(&env, &mut pos, &mut proto);

        // Check pool has enough liquidity.
        let available = proto.total_supplied.saturating_sub(proto.total_borrowed);
        if usdc_amount > available {
            return Err(PrivateLendError::InsufficientLiquidity);
        }

        // Compute post-borrow collateral ratio.
        let new_debt = pos.usdc_debt.saturating_add(usdc_amount);
        let price = get_btc_price_stroops(&env, &config.oracle);
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(PrivateLendError::Overflow)?;
        let health = health_ratio_bp(collateral, new_debt);

        if health < config.min_collateral_ratio_bp as i128 {
            return Err(PrivateLendError::ExceedsCollateralRatio);
        }

        // Commit state.
        pos.usdc_debt = new_debt;
        proto.total_borrowed = proto.total_borrowed.saturating_add(usdc_amount);
        set_position(&env, &txid, &pos);
        set_protocol(&env, &proto);

        // Transfer USDC to borrower.
        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&env.current_contract_address(), &borrower, &usdc_amount);

        BorrowEvent { txid, borrower, usdc_amount }.publish(&env);

        Ok(())
    }

    // ── Repay ─────────────────────────────────────────────────────────────────

    /// Repay some or all of the USDC debt on a position.
    ///
    /// If the repayment covers the full outstanding debt (after accruing
    /// interest), the position is marked as `Closed` and a `repay_full`
    /// event is emitted.  The Writz backend listens for this event and
    /// co-signs the Bitcoin release transaction (spending path A).
    pub fn repay(
        env: Env,
        repayer: Address,
        txid: BytesN<32>,
        usdc_amount: i128,
    ) -> Result<(), PrivateLendError> {
        repayer.require_auth();
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        let mut pos = get_position(&env, &txid).ok_or(PrivateLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(PrivateLendError::PositionNotActive);
        }

        let mut proto = get_protocol(&env);
        accrue_position_interest(&env, &mut pos, &mut proto);

        if usdc_amount > pos.usdc_debt {
            return Err(PrivateLendError::RepayExceedsDebt);
        }

        // Transfer USDC from repayer into pool.
        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&repayer, &env.current_contract_address(), &usdc_amount);

        pos.usdc_debt = pos.usdc_debt.saturating_sub(usdc_amount);
        proto.total_borrowed = proto.total_borrowed.saturating_sub(usdc_amount);

        let fully_repaid = pos.usdc_debt == 0;
        if fully_repaid {
            pos.status = PositionStatus::Closed;
            RepayFullEvent {
                txid:                txid.clone(),
                repayer,
                p2wsh_script_pubkey: pos.p2wsh_script_pubkey.clone(),
            }
            .publish(&env);
        } else {
            RepayEvent { txid: txid.clone(), usdc_amount }.publish(&env);
        }

        set_position(&env, &txid, &pos);
        set_protocol(&env, &proto);

        Ok(())
    }

    // ── Liquidation ───────────────────────────────────────────────────────────

    /// Liquidate an undercollateralized position (Phase 1 — keeper only).
    ///
    /// The keeper must have pre-approved a USDC transfer of at least
    /// `pos.usdc_debt` (after accrual) to this contract.
    ///
    /// On success:
    /// - The keeper's USDC covers the outstanding debt.
    /// - The position is marked `Liquidated`.
    /// - A `liquidate` event is emitted containing the keeper's address and
    ///   the P2WSH scriptPubKey.  The Writz backend co-signs the Bitcoin
    ///   release to the keeper at a 10% discount (liquidation bonus in BTC).
    ///
    /// Phase 2 will replace the keeper check with a ZK proof of
    /// undercollateralization — see `docs/research/liquidation-mechanism.md`.
    pub fn liquidate(
        env: Env,
        keeper: Address,
        txid: BytesN<32>,
    ) -> Result<(), PrivateLendError> {
        keeper.require_auth();
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;

        // Phase 1: only the authorized keeper can trigger liquidation.
        if keeper != config.keeper {
            return Err(PrivateLendError::Unauthorized);
        }

        let mut pos = get_position(&env, &txid).ok_or(PrivateLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(PrivateLendError::PositionNotActive);
        }

        let mut proto = get_protocol(&env);
        accrue_position_interest(&env, &mut pos, &mut proto);

        // Check the position is actually undercollateralized.
        let price = get_btc_price_stroops(&env, &config.oracle);
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(PrivateLendError::Overflow)?;
        let health = health_ratio_bp(collateral, pos.usdc_debt);

        if health >= config.liquidation_threshold_bp as i128 {
            return Err(PrivateLendError::PositionHealthy);
        }

        // Keeper pays the full outstanding debt.
        let debt = pos.usdc_debt;
        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&keeper, &env.current_contract_address(), &debt);

        proto.total_borrowed = proto.total_borrowed.saturating_sub(debt);

        pos.usdc_debt = 0;
        pos.status = PositionStatus::Liquidated;

        set_position(&env, &txid, &pos);
        set_protocol(&env, &proto);

        LiquidateEvent {
            txid,
            keeper,
            p2wsh_script_pubkey:  pos.p2wsh_script_pubkey,
            liquidation_bonus_bp: config.liquidation_bonus_bp,
        }
        .publish(&env);

        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Update the keeper address.  Admin only.
    pub fn set_keeper(
        env: Env,
        caller: Address,
        new_keeper: Address,
    ) -> Result<(), PrivateLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(PrivateLendError::Unauthorized);
        }
        config.keeper = new_keeper;
        set_config(&env, &config);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns the position for the given Bitcoin txid, or `None`.
    pub fn get_position(env: Env, txid: BytesN<32>) -> Option<Position> {
        get_position(&env, &txid)
    }

    /// Returns the health ratio (in basis points) for a position.
    ///
    /// 15_000 = 150% (healthy), 12_000 = 120% (liquidation threshold),
    /// `i128::MAX` = position has no debt.
    pub fn get_health_ratio_bp(
        env: Env,
        txid: BytesN<32>,
    ) -> Result<i128, PrivateLendError> {
        let config = get_config(&env).ok_or(PrivateLendError::NotInitialized)?;
        let pos = get_position(&env, &txid).ok_or(PrivateLendError::PositionNotFound)?;
        if pos.usdc_debt == 0 {
            return Ok(i128::MAX);
        }
        let price = get_btc_price_stroops(&env, &config.oracle);
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(PrivateLendError::Overflow)?;
        Ok(health_ratio_bp(collateral, pos.usdc_debt))
    }

    /// Current annual borrow rate in basis points (e.g. 800 = 8%).
    pub fn get_borrow_rate_bp(env: Env) -> i128 {
        let proto = get_protocol(&env);
        borrow_rate_bp(proto.total_borrowed, proto.total_supplied)
    }

    /// Current annual supply rate in basis points.
    pub fn get_supply_rate_bp(env: Env) -> i128 {
        let proto = get_protocol(&env);
        let borrow = borrow_rate_bp(proto.total_borrowed, proto.total_supplied);
        supply_rate_bp(borrow, proto.total_borrowed, proto.total_supplied)
    }

    /// Returns a snapshot of the global protocol state.
    pub fn get_protocol_state(env: Env) -> ProtocolState {
        get_protocol(&env)
    }

    /// Returns the USDC supply balance (in stroops) for a lender.
    pub fn get_supply_balance(env: Env, lender: Address) -> i128 {
        get_supply_balance(&env, &lender)
    }

    // ── TTL refresh (permissionless) ──────────────────────────────────────────

    /// Extend the TTL of a position entry to another 180-day window.
    ///
    /// If a position expires, the depositor loses access to their record and
    /// the duplicate-deposit guard also expires (re-deposit attack risk).
    /// Keepers or borrowers should call this before any position approaches
    /// the end of its 180-day window.
    /// Returns false if no position exists for the given txid.
    pub fn refresh_position_ttl(env: Env, txid: BytesN<32>) -> bool {
        storage::refresh_position_ttl(&env, &txid)
    }

    /// Extend the TTL of a lender's supply balance entry to another 180-day window.
    ///
    /// Lenders who supplied USDC and do not interact for an extended period risk
    /// having their balance entry expire, preventing withdrawal.
    /// Returns false if the lender has no recorded balance.
    pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool {
        storage::refresh_supply_balance_ttl(&env, &lender)
    }

    /// Extend the TTL of the global protocol accounting entry.
    pub fn refresh_protocol_ttl(env: Env) {
        storage::refresh_protocol_ttl(&env);
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Accrues interest on `pos` and updates `proto.total_borrowed` accordingly.
/// Called at the start of every state-changing operation on a position.
fn accrue_position_interest(env: &Env, pos: &mut Position, proto: &mut ProtocolState) {
    let current = env.ledger().sequence();
    let elapsed = current.saturating_sub(pos.last_update_ledger) as i128;
    if elapsed == 0 || pos.usdc_debt == 0 {
        pos.last_update_ledger = current;
        return;
    }
    let rate = borrow_rate_bp(proto.total_borrowed, proto.total_supplied);
    let delta = interest_delta(pos.usdc_debt, rate, elapsed);
    pos.usdc_debt = pos.usdc_debt.saturating_add(delta);
    proto.total_borrowed = proto.total_borrowed.saturating_add(delta);
    pos.last_update_ledger = current;
}
