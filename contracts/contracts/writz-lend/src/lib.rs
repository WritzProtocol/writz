#![no_std]

mod error;
mod events;
mod oracle;
mod rates;
mod storage;
mod types;

#[cfg(test)]
mod test;

use error::WritzLendError;
use events::{
    BorrowEvent, DepositEvent, EntryTtlSetEvent, LiquidateEvent, OracleSetEvent, PausedSetEvent, RepayEvent,
    RepayFullEvent, SupplyEvent, WithdrawEvent,
};
use oracle::{collateral_value_stroops, get_btc_price_stroops, health_ratio_bp};
use rates::{borrow_rate_bp, supply_rate_bp, total_supply_assets};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};
use spv_types::{btc_parser, key_proof, script, BestTip, HeaderEntry, SpvVerificationResult};
use storage::{get_config, get_position, get_protocol, get_release_psbt, get_supply_balance,
               set_config, set_position, set_protocol, set_release_psbt, set_supply_balance};
use types::{Config, Position, PositionStatus, ProtocolState};

/// Highest `min_confirmations` the constructor accepts (the relayer serves
/// SPV proofs for 1 to 20 confirmations).
pub const MAX_MIN_CONFIRMATIONS: u32 = 20;
/// Lowest `min_deposit_satoshis` the constructor accepts.
pub const MIN_DEPOSIT_FLOOR_SATS: u64 = 1_000;
pub use storage::{LEDGERS_PER_DAY, MAX_ENTRY_TTL_LEDGERS, MIN_ENTRY_TTL_LEDGERS};

// Time ordering between a loan and its Bitcoin timelock H. The recovery path
// of the Writz script can be mined from block H + 1, so from a tip T there
// are H - T blocks left in which anything the protocol does on Bitcoin can
// still confirm before the borrower can exit alone.

/// Blocks (about 30 days) a borrow must leave between the `bitcoin-spv` tip
/// and the position's timelock height: `borrow` requires
/// `H >= tip + borrow_timelock_margin_blocks`. Also the lowest value
/// `set_borrow_timelock_margin` accepts, so the margin can be raised, never
/// lowered below this.
pub const DEFAULT_BORROW_TIMELOCK_MARGIN_BLOCKS: u32 = 4_320;
/// Blocks (about 2 days) before the timelock height after which no
/// liquidation is accepted: `liquidate` requires
/// `H >= tip + LIQUIDATION_CUTOFF_BLOCKS`.
pub const LIQUIDATION_CUTOFF_BLOCKS: u32 = 288;
/// Default oldest age of the `bitcoin-spv` tip header, in seconds, that
/// `borrow` and `liquidate` will measure a timelock against.
pub const DEFAULT_MAX_TIP_AGE_SECS: u64 = 6 * 60 * 60;
/// Bounds of `set_max_tip_age`: 1 to 48 hours.
pub const MIN_MAX_TIP_AGE_SECS: u64 = 60 * 60;
pub const MAX_MAX_TIP_AGE_SECS: u64 = 48 * 60 * 60;

#[contract]
pub struct WritzLendContract;

#[contractimpl]
impl WritzLendContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Runs exactly once, atomically, as part of deployment (`__constructor`):
    /// no separate initialize transaction exists for anyone to front-run
    /// (GHSA-422m-f73x-fh58).
    ///
    /// # Parameters
    /// - `admin`          - Address that can update the keeper.
    /// - `spv_contract`   - Deployed `bitcoin-spv` Soroban contract address.
    /// - `usdc_token`     - USDC Stellar Asset Contract address.
    /// - `oracle`         - Reflector's external-prices SEP-40 oracle address
    ///                       (see docs/research/oracle-design.md). Pyth
    ///                       cross-check not yet wired - single-source until
    ///                       it is.
    /// - `keeper`         - Trusted liquidation keeper (Phase 1).
    /// - `relayer`        - Auto-cosign relayer watcher address.
    /// - `protocol_pubkey`- The protocol's 33-byte compressed Bitcoin
    ///                       co-signing key; every deposit must be locked
    ///                       under a script that contains it.
    /// - `min_confirmations` - Bitcoin confirmations a deposit needs before
    ///                       `bitcoin-spv` accepts it (6 on mainnet).
    ///                       1..=`MAX_MIN_CONFIRMATIONS`.
    /// - `min_deposit_satoshis` - Smallest deposit output accepted (100,000
    ///                       on mainnet). At least `MIN_DEPOSIT_FLOOR_SATS`,
    ///                       so a release fee cannot consume the deposit.
    /// - `entry_ttl_ledgers` - How long each per-user entry (a deposit's
    ///                       `Position`, a lender's supply balance, a release
    ///                       PSBT) is kept live, in ledgers, from when it is
    ///                       written or last topped up. The creating
    ///                       transaction pays rent for this window. 3,110,400
    ///                       (180 days, the network maximum) on mainnet; a
    ///                       short window where rent is priced high (testnet).
    ///                       `MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS`.
    ///                       An entry that outlives its window is archived,
    ///                       not deleted, and is restored before any call can
    ///                       read it again.
    pub fn __constructor(
        env: Env,
        admin: Address,
        spv_contract: Address,
        usdc_token: Address,
        oracle: Address,
        keeper: Address,
        relayer: Address,
        protocol_pubkey: BytesN<33>,
        min_confirmations: u32,
        min_deposit_satoshis: u64,
        entry_ttl_ledgers: u32,
    ) {
        if !script::is_compressed_pubkey(&protocol_pubkey) {
            panic_with_error!(&env, WritzLendError::InvalidProtocolPubkey);
        }
        if min_confirmations == 0
            || min_confirmations > MAX_MIN_CONFIRMATIONS
            || min_deposit_satoshis < MIN_DEPOSIT_FLOOR_SATS
        {
            panic_with_error!(&env, WritzLendError::InvalidDepositParams);
        }
        if !(MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS).contains(&entry_ttl_ledgers) {
            panic_with_error!(&env, WritzLendError::InvalidEntryTtl);
        }
        set_config(
            &env,
            &Config {
                admin,
                spv_contract,
                usdc_token,
                oracle,
                keeper,
                relayer,
                protocol_pubkey,
                min_deposit_satoshis,
                min_collateral_ratio_bp: 15_000,      // 150%
                liquidation_threshold_bp: 12_000,     // 120%
                liquidation_bonus_bp: 1_000,          // 10%
                min_confirmations,
                keeper_stale_after_secs: 86_400,      // 24h stale-keeper liveness window
                paused: false,
                max_total_borrowed: 500_000_000_000, // 50,000 USDC - the launch cap in docs/research/tokenomics-fee-model.md
                entry_ttl_ledgers,
                borrow_timelock_margin_blocks: DEFAULT_BORROW_TIMELOCK_MARGIN_BLOCKS,
                max_tip_age_secs: DEFAULT_MAX_TIP_AGE_SECS,
            },
        );
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Register a BTC deposit by submitting an SPV proof.
    ///
    /// The contract:
    /// 1. Rebuilds the Writz redeem script from the configured protocol key,
    ///    `user_pubkey` and `timelock_height`, and requires
    ///    `p2wsh_script_pubkey` to be exactly its P2WSH - so the collateral is
    ///    provably locked under the protocol's co-signing key.
    /// 2. Calls the `bitcoin-spv` contract to verify the transaction inclusion,
    ///    and requires the timelock to lie 1,008..=105,000 blocks above the
    ///    block that confirmed the deposit.
    /// 3. Parses the raw transaction on-chain to find the P2WSH output matching
    ///    `p2wsh_script_pubkey` and read the deposited satoshi amount.
    /// 4. Creates a `Position` entry in persistent storage.
    ///
    /// After this call succeeds the user can borrow USDC against the position.
    ///
    /// # Parameters
    /// - `depositor`          - Stellar address of the depositor (must authorize).
    /// - `block_hash`         - Hash of the Bitcoin block holding the deposit; it must
    ///                          already be stored and on the best chain in `bitcoin-spv`.
    /// - `merkle_proof`       - Sibling hashes for the Merkle inclusion proof.
    /// - `tx_index`           - 0-based index of the transaction in its block.
    /// - `raw_tx`             - Non-witness serialization of the Bitcoin transaction.
    /// - `p2wsh_script_pubkey`- 34-byte P2WSH scriptPubKey (OP_0 + 32-byte hash)
    ///                          of the deposit output. Must equal the P2WSH of
    ///                          the Writz redeem script for the other arguments.
    /// - `timelock_height`    - Bitcoin block height of the CLTV escape hatch.
    /// - `user_pubkey`        - Depositor's 33-byte compressed Bitcoin public
    ///                          key. Already public the moment
    ///                          either spending path is used; stored so the
    ///                          auto-cosign relayer watcher can reconstruct
    ///                          the redeem script and return address without
    ///                          a separate off-chain store. Must differ
    ///                          from the protocol key (`UserKeyIsProtocolKey`).
    pub fn deposit(
        env: Env,
        depositor: Address,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        p2wsh_script_pubkey: Bytes,
        timelock_height: u32,
        user_pubkey: BytesN<33>,
        key_sig: BytesN<65>,
    ) -> Result<BytesN<32>, WritzLendError> {
        depositor.require_auth();

        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if config.paused {
            return Err(WritzLendError::Paused);
        }

        // Validate the scriptPubKey is P2WSH-shaped (OP_0 0x20 <32 bytes>).
        if p2wsh_script_pubkey.len() != 34
            || p2wsh_script_pubkey.get(0) != Some(0x00)
            || p2wsh_script_pubkey.get(1) != Some(0x20)
        {
            return Err(WritzLendError::InvalidScriptPubKey);
        }

        // The output must be locked under the Writz script: the protocol's
        // co-signing key, this depositor's key and this timelock. Deriving it
        // here (rather than trusting the caller) is what stops a depositor
        // from pledging BTC they can spend alone, or someone else's UTXO.
        if !script::is_compressed_pubkey(&user_pubkey) {
            return Err(WritzLendError::InvalidUserPubkey);
        }
        // Every key in the script must be distinct: a user key equal to the
        // protocol key would let the holder of that one key complete the
        // cooperative path alone.
        if user_pubkey == config.protocol_pubkey {
            return Err(WritzLendError::UserKeyIsProtocolKey);
        }
        let expected_spk = script::p2wsh_script_pubkey(
            &env,
            &config.protocol_pubkey,
            &user_pubkey,
            timelock_height,
        );
        if p2wsh_script_pubkey != expected_spk {
            return Err(WritzLendError::ScriptPubKeyMismatch);
        }

        // 1. Cross-contract SPV verification.
        let spv_result: SpvVerificationResult = env.invoke_contract(
            &config.spv_contract,
            &Symbol::new(&env, "verify_transaction"),
            (
                block_hash,
                merkle_proof,
                tx_index,
                raw_tx.clone(),
                config.min_confirmations,
            )
                .into_val(&env),
        );
        let txid = spv_result.txid;

        // The CLTV escape hatch must not be an instant exit, nor absurdly
        // far away: bound it relative to the block that confirmed the deposit.
        if !script::timelock_in_bounds(timelock_height, spv_result.block_height) {
            return Err(WritzLendError::InvalidTimelock);
        }

        // The caller must prove they control `user_pubkey`: otherwise anyone
        // watching Bitcoin could register someone else's Writz deposit as
        // their own position (GHSA-862g-739q-x6h8). See spv-types::key_proof.
        let key_msg = key_proof::deposit_message(&env, &env.current_contract_address(), &depositor, &txid);
        if !key_proof::signed_by(&env, &key_msg, &key_sig, &user_pubkey) {
            return Err(WritzLendError::InvalidKeyProof);
        }

        // 2. Reject duplicate deposits, here and across both lending pools
        //    (GHSA-2975-ggwh-pxw5): consume the txid in the shared registry.
        let ttl = config.entry_ttl_ledgers;
        if get_position(&env, &txid, ttl).is_some() {
            return Err(WritzLendError::PositionAlreadyExists);
        }
        env.invoke_contract::<()>(
            &config.spv_contract,
            &Symbol::new(&env, "consume_deposit"),
            (env.current_contract_address(), txid.clone()).into_val(&env),
        );

        // 3. Parse the raw transaction on-chain to find the P2WSH output.
        let btc_satoshis =
            btc_parser::find_p2wsh_output(&raw_tx, &p2wsh_script_pubkey)
                .ok_or(WritzLendError::OutputNotFound)?;

        // 4. Enforce minimum deposit.
        if btc_satoshis < config.min_deposit_satoshis {
            return Err(WritzLendError::DepositTooSmall);
        }

        // 5. Create the position.
        let pos = Position {
            btc_txid: txid.clone(),
            btc_satoshis,
            usdc_debt: 0,
            p2wsh_script_pubkey,
            timelock_height,
            last_update_ledger: env.ledger().sequence(),
            debt_index: rates::INDEX_ONE,
            depositor,
            status: PositionStatus::Active,
            user_pubkey,
        };
        set_position(&env, &txid, &pos, ttl);

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
    /// The deposit is stored as scaled units, so the lender's balance grows
    /// with `supply_index` as borrowers pay interest.
    pub fn supply_usdc(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), WritzLendError> {
        supplier.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if config.paused {
            return Err(WritzLendError::Paused);
        }

        let mut proto = get_protocol(&env);
        // Credit the interval that just ended to the existing lenders before
        // this supply joins them, so a supply earns nothing from the past.
        accrue_global(&env, &mut proto);

        let scaled = amount.saturating_mul(rates::INDEX_ONE) / proto.supply_index;
        if scaled <= 0 {
            return Err(WritzLendError::ZeroShareAmount);
        }

        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&supplier, &env.current_contract_address(), &amount);

        proto.total_scaled_supply = proto.total_scaled_supply.saturating_add(scaled);
        set_protocol(&env, &proto);

        let ttl = config.entry_ttl_ledgers;
        let bal = get_supply_balance(&env, &supplier, ttl);
        set_supply_balance(&env, &supplier, bal.saturating_add(scaled), ttl);

        SupplyEvent {
            supplier,
            usdc_amount: amount,
            total_supplied: total_supply_assets(&proto, proto.supply_index),
        }
        .publish(&env);

        Ok(())
    }

    /// Lender withdraws USDC from the pool, up to the current value of their
    /// scaled balance (principal plus accrued interest).
    pub fn withdraw_supply(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), WritzLendError> {
        supplier.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if amount <= 0 {
            return Err(WritzLendError::ZeroShareAmount);
        }

        let mut proto = get_protocol(&env);
        // Price the interval that just ended before withdrawal moves utilization.
        accrue_global(&env, &mut proto);

        let ttl = config.entry_ttl_ledgers;
        let scaled_bal = get_supply_balance(&env, &supplier, ttl);
        let value = scaled_bal.saturating_mul(proto.supply_index) / rates::INDEX_ONE;
        if amount > value {
            return Err(WritzLendError::InsufficientSupply);
        }

        let assets = total_supply_assets(&proto, proto.supply_index);
        let available = assets.saturating_sub(proto.total_borrowed);
        if amount > available {
            return Err(WritzLendError::InsufficientLiquidity);
        }

        // Withdrawing the whole displayed value burns the whole balance, so it
        // can never fail on rounding. Otherwise burn rounds up, in the pool's favour.
        let burn = if amount == value {
            scaled_bal
        } else {
            let up = amount
                .saturating_mul(rates::INDEX_ONE)
                .saturating_add(proto.supply_index - 1)
                / proto.supply_index;
            up.min(scaled_bal)
        };

        set_supply_balance(&env, &supplier, scaled_bal - burn, ttl);
        proto.total_scaled_supply = proto.total_scaled_supply.saturating_sub(burn);
        set_protocol(&env, &proto);

        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&env.current_contract_address(), &supplier, &amount);

        WithdrawEvent {
            supplier,
            usdc_amount: amount,
            total_supplied: total_supply_assets(&proto, proto.supply_index),
        }
        .publish(&env);

        Ok(())
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    /// Borrow USDC against an existing BTC deposit.
    ///
    /// The resulting debt must keep the position's collateral ratio at or above
    /// `min_collateral_ratio_bp` (150%).  Interest starts accruing immediately.
    ///
    /// Only the depositor who created the position can borrow against it.
    ///
    /// Every borrow, including a top-up of an existing loan, also requires
    /// the position's timelock height H to be at least
    /// `borrow_timelock_margin_blocks` (4,320 by default) above the
    /// `bitcoin-spv` tip, read from a tip header no older than
    /// `max_tip_age_secs`. Otherwise it fails with `TimelockTooSoon`, or with
    /// `StaleBitcoinTip` when the tip is missing or too old. This keeps the
    /// borrower's unilateral exit at least the margin away from any loan.
    pub fn borrow(
        env: Env,
        borrower: Address,
        txid: BytesN<32>,
        usdc_amount: i128,
    ) -> Result<(), WritzLendError> {
        borrower.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if config.paused {
            return Err(WritzLendError::Paused);
        }

        let ttl = config.entry_ttl_ledgers;
        let mut pos = get_position(&env, &txid, ttl).ok_or(WritzLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(WritzLendError::PositionNotActive);
        }
        if pos.depositor != borrower {
            return Err(WritzLendError::Unauthorized);
        }

        // The borrower's unilateral exit must stay at least the margin away.
        let tip_height = fresh_tip_height(&env, &config)?;
        if !timelock_clears(
            pos.timelock_height,
            tip_height,
            config.borrow_timelock_margin_blocks,
        ) {
            return Err(WritzLendError::TimelockTooSoon);
        }

        let mut proto = get_protocol(&env);

        // Accrue interest first so the collateral check is accurate.
        accrue_position_interest(&env, &mut pos, &mut proto);

        // Check pool has enough liquidity.
        let available = total_supply_assets(&proto, proto.supply_index)
            .saturating_sub(proto.total_borrowed);
        if usdc_amount > available {
            return Err(WritzLendError::InsufficientLiquidity);
        }
        if proto.total_borrowed.saturating_add(usdc_amount) > config.max_total_borrowed {
            return Err(WritzLendError::ExposureCapExceeded);
        }

        // Compute post-borrow collateral ratio.
        let new_debt = pos.usdc_debt.saturating_add(usdc_amount);
        let price = get_btc_price_stroops(&env, &config.oracle)?;
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(WritzLendError::Overflow)?;
        let health = health_ratio_bp(collateral, new_debt);

        if health < config.min_collateral_ratio_bp as i128 {
            return Err(WritzLendError::ExceedsCollateralRatio);
        }

        // Commit state.
        pos.usdc_debt = new_debt;
        proto.total_borrowed = proto.total_borrowed.saturating_add(usdc_amount);
        set_position(&env, &txid, &pos, ttl);
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
    ) -> Result<(), WritzLendError> {
        repayer.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;

        let ttl = config.entry_ttl_ledgers;
        let mut pos = get_position(&env, &txid, ttl).ok_or(WritzLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(WritzLendError::PositionNotActive);
        }

        let mut proto = get_protocol(&env);
        accrue_position_interest(&env, &mut pos, &mut proto);

        if usdc_amount > pos.usdc_debt {
            return Err(WritzLendError::RepayExceedsDebt);
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

        set_position(&env, &txid, &pos, ttl);
        set_protocol(&env, &proto);

        Ok(())
    }

    // ── Liquidation ───────────────────────────────────────────────────────────

    /// Liquidate an undercollateralized position.
    ///
    /// Phase 1: only the authorized `keeper` may call this - *unless* the
    /// keeper has gone stale (no successful liquidation or explicit
    /// `keeper_heartbeat` in `config.keeper_stale_after_secs`, default 24h),
    /// in which case any caller with a genuinely undercollateralized
    /// position may liquidate it. This is a liveness/censorship
    /// fallback, not a privacy mechanism - `writz-lend` positions are
    /// already plaintext. Safety is unaffected by who calls: the
    /// undercollateralization check below is independent of caller identity.
    ///
    /// The caller must have pre-approved a USDC transfer of at least
    /// `pos.usdc_debt` (after accrual) to this contract.
    ///
    /// On success:
    /// - The caller's USDC covers the outstanding debt.
    /// - The position is marked `Liquidated`.
    /// - A `liquidate` event is emitted with the position txid and the
    ///   caller's address. It does not release any Bitcoin: the collateral
    ///   stays under the user's script (GHSA-5rxp-7f9g-r66x).
    /// - If the caller is the designated keeper, `last_keeper_heartbeat` is
    ///   refreshed (a keeper that successfully liquidates is provably alive).
    ///
    /// A liquidation is accepted only while the position's timelock height H
    /// is at least `LIQUIDATION_CUTOFF_BLOCKS` (288) above the `bitcoin-spv`
    /// tip, read from a tip header no older than `max_tip_age_secs`; past
    /// that it fails with `LiquidationWindowClosed`, and with
    /// `StaleBitcoinTip` when the tip is missing or too old.
    ///
    /// Phase 2 will replace the keeper check with a ZK proof of
    /// undercollateralization - see `docs/research/liquidation-mechanism.md`.
    pub fn liquidate(
        env: Env,
        keeper: Address,
        txid: BytesN<32>,
    ) -> Result<(), WritzLendError> {
        keeper.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        let mut proto = get_protocol(&env);

        let is_designated_keeper = keeper == config.keeper;
        let keeper_is_stale = env.ledger().timestamp()
            > proto.last_keeper_heartbeat.saturating_add(config.keeper_stale_after_secs);
        if !is_designated_keeper && !keeper_is_stale {
            return Err(WritzLendError::Unauthorized);
        }

        let ttl = config.entry_ttl_ledgers;
        let mut pos = get_position(&env, &txid, ttl).ok_or(WritzLendError::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(WritzLendError::PositionNotActive);
        }

        // No liquidation once the borrower's unilateral exit is this close.
        let tip_height = fresh_tip_height(&env, &config)?;
        if !timelock_clears(pos.timelock_height, tip_height, LIQUIDATION_CUTOFF_BLOCKS) {
            return Err(WritzLendError::LiquidationWindowClosed);
        }

        accrue_position_interest(&env, &mut pos, &mut proto);

        // Check the position is actually undercollateralized.
        let price = get_btc_price_stroops(&env, &config.oracle)?;
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(WritzLendError::Overflow)?;
        let health = health_ratio_bp(collateral, pos.usdc_debt);

        if health >= config.liquidation_threshold_bp as i128 {
            return Err(WritzLendError::PositionHealthy);
        }

        // Keeper pays the full outstanding debt.
        let debt = pos.usdc_debt;
        let token = token::Client::new(&env, &config.usdc_token);
        token.transfer(&keeper, &env.current_contract_address(), &debt);

        proto.total_borrowed = proto.total_borrowed.saturating_sub(debt);

        // Keeper bonus in USDC from the protocol reserve, capped at what the
        // reserve holds. Never paid in BTC: the protocol does not move BTC.
        let bonus_due = debt.saturating_mul(config.liquidation_bonus_bp as i128) / rates::BP_SCALE;
        let bonus_paid = bonus_due.min(proto.reserve_usdc);
        if bonus_paid > 0 {
            proto.reserve_usdc -= bonus_paid;
            token.transfer(&env.current_contract_address(), &keeper, &bonus_paid);
        }

        if is_designated_keeper {
            proto.last_keeper_heartbeat = env.ledger().timestamp();
        }

        pos.usdc_debt = 0;
        pos.status = PositionStatus::Liquidated;

        set_position(&env, &txid, &pos, ttl);
        set_protocol(&env, &proto);

        LiquidateEvent { txid, keeper, bonus_paid }
        .publish(&env);

        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Update the keeper address.  Admin only.
    pub fn set_max_total_borrowed(
        env: Env,
        caller: Address,
        max: i128,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.max_total_borrowed = max;
        set_config(&env, &config);
        Ok(())
    }

    pub fn set_keeper(
        env: Env,
        caller: Address,
        new_keeper: Address,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.keeper = new_keeper;
        set_config(&env, &config);
        Ok(())
    }

    /// Explicit liveness signal from the designated keeper.
    ///
    /// Lets the keeper reset the stale-window clock even when there is
    /// nothing to liquidate right now (`liquidate` itself also refreshes
    /// this on every successful call - this entrypoint covers idle periods).
    pub fn keeper_heartbeat(env: Env, keeper: Address) -> Result<(), WritzLendError> {
        keeper.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if keeper != config.keeper {
            return Err(WritzLendError::Unauthorized);
        }
        let mut proto = get_protocol(&env);
        proto.last_keeper_heartbeat = env.ledger().timestamp();
        set_protocol(&env, &proto);
        Ok(())
    }

    /// Updates how many seconds of keeper inactivity before liquidation
    /// opens to any caller.  Admin only.
    pub fn set_keeper_stale_window(
        env: Env,
        caller: Address,
        secs: u64,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.keeper_stale_after_secs = secs;
        set_config(&env, &config);
        Ok(())
    }

    /// Sets how many Bitcoin blocks a borrow must leave between the
    /// `bitcoin-spv` tip and the position's timelock height. Admin only.
    /// `DEFAULT_BORROW_TIMELOCK_MARGIN_BLOCKS` (4,320) up to the deposit
    /// window's own maximum (105,000): the margin can be raised, never
    /// lowered below the default.
    pub fn set_borrow_timelock_margin(
        env: Env,
        caller: Address,
        blocks: u32,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        if !(DEFAULT_BORROW_TIMELOCK_MARGIN_BLOCKS..=script::MAX_TIMELOCK_MARGIN_BLOCKS)
            .contains(&blocks)
        {
            return Err(WritzLendError::InvalidTimelockParams);
        }
        config.borrow_timelock_margin_blocks = blocks;
        set_config(&env, &config);
        Ok(())
    }

    /// Sets how old the `bitcoin-spv` tip header may be, in seconds, for
    /// `borrow` and `liquidate` to rely on it. Admin only; 1 to 48 hours.
    pub fn set_max_tip_age(env: Env, caller: Address, secs: u64) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        if !(MIN_MAX_TIP_AGE_SECS..=MAX_MAX_TIP_AGE_SECS).contains(&secs) {
            return Err(WritzLendError::InvalidTimelockParams);
        }
        config.max_tip_age_secs = secs;
        set_config(&env, &config);
        Ok(())
    }

    /// Updates the relayer address authorized to call `publish_release_psbt`.
    /// Admin only.
    pub fn set_relayer(
        env: Env,
        caller: Address,
        new_relayer: Address,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.relayer = new_relayer;
        set_config(&env, &config);
        Ok(())
    }

    /// Updates the oracle contract address used for BTC/USD pricing. Admin only.
    ///
    /// As of 2026-09-17, `oracle::get_btc_price_stroops` calls this address
    /// live via Reflector's SEP-40 interface (`lastprice`/`decimals`) - it is
    /// no longer a stub, and changing this address changes real pricing
    /// immediately, including for any `borrow`/`liquidate`/
    /// `get_health_ratio_bp` call already in flight in the same ledger.
    /// Point this at a contract that does not genuinely speak Reflector's
    /// `lastprice`/`decimals` shape and price-dependent calls trap with a
    /// host error (or return `OraclePriceUnavailable` if the contract
    /// exists but reports no price) - both fail closed, neither silently
    /// mispricing - see `oracle.rs`.
    pub fn set_oracle(
        env: Env,
        caller: Address,
        new_oracle: Address,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.oracle = new_oracle.clone();
        set_config(&env, &config);
        OracleSetEvent { admin: caller, new_oracle }.publish(&env);
        Ok(())
    }

    /// Sets how long per-user entries (positions, supply balances, release
    /// PSBTs) are kept live, in ledgers. Admin only. Same bounds as the
    /// constructor's `entry_ttl_ledgers`.
    ///
    /// Rent is priced at the ledger that creates or extends an entry, and on
    /// a network whose live state is above its target size that price moves
    /// by the hour; this lets the window follow it without a redeploy. It
    /// applies to entries written or touched after the change only: an
    /// existing entry keeps its TTL until a call tops it up or refreshes it.
    pub fn set_entry_ttl(
        env: Env,
        caller: Address,
        entry_ttl_ledgers: u32,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        if !(MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS).contains(&entry_ttl_ledgers) {
            return Err(WritzLendError::InvalidEntryTtl);
        }
        config.entry_ttl_ledgers = entry_ttl_ledgers;
        set_config(&env, &config);
        EntryTtlSetEvent { admin: caller, entry_ttl_ledgers }.publish(&env);
        Ok(())
    }

    /// Updates the bitcoin-spv contract address used for deposit verification.
    /// Admin only. Changing this mid-flight affects only deposits submitted
    /// after the change - an in-flight deposit's SPV proof was already
    /// verified against the previous contract by the time this would run.
    pub fn set_spv_contract(
        env: Env,
        caller: Address,
        new_spv_contract: Address,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.spv_contract = new_spv_contract;
        set_config(&env, &config);
        Ok(())
    }

    /// Pauses or unpauses new deposits/borrows/USDC supply. Admin only.
    ///
    /// A pause never affects existing positions: `repay`, `withdraw_supply`,
    /// `liquidate`, and `publish_release_psbt` all ignore `Config::paused` by
    /// design, so users can always exit. This is an emergency brake on new
    /// exposure, not a freeze - see `docs/architecture/contract-migration-runbook.md`.
    pub fn set_paused(
        env: Env,
        caller: Address,
        paused: bool,
    ) -> Result<(), WritzLendError> {
        caller.require_auth();
        let mut config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if caller != config.admin {
            return Err(WritzLendError::Unauthorized);
        }
        config.paused = paused;
        set_config(&env, &config);
        PausedSetEvent { admin: caller, paused }.publish(&env);
        Ok(())
    }

    // ── Auto-cosign relayer watcher ─────────────────────────────────────────────

    /// Publishes a co-signed Path A release PSBT for a repaid position.
    ///
    /// Called by the relayer watcher immediately after it detects a
    /// `RepayFullEvent`, builds the release transaction, and co-signs it.
    /// Storing the PSBT
    /// on-chain (rather than e.g. IPFS) means the user can retrieve and
    /// broadcast it even if the entire Writz off-chain stack is down.
    /// Relayer only.
    pub fn publish_release_psbt(
        env: Env,
        relayer: Address,
        txid: BytesN<32>,
        psbt: Bytes,
    ) -> Result<(), WritzLendError> {
        relayer.require_auth();
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        if relayer != config.relayer {
            return Err(WritzLendError::Unauthorized);
        }
        let ttl = config.entry_ttl_ledgers;
        if get_position(&env, &txid, ttl).is_none() {
            return Err(WritzLendError::PositionNotFound);
        }
        set_release_psbt(&env, &txid, &psbt, ttl);
        Ok(())
    }

    /// Returns the relayer-published release PSBT for a position, or `None`
    /// if the relayer hasn't published one yet (or the position was never
    /// fully repaid).
    pub fn get_release_psbt(env: Env, txid: BytesN<32>) -> Option<Bytes> {
        get_release_psbt(&env, &txid, storage::entry_ttl(&env))
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns the position for the given Bitcoin txid, or `None`.
    pub fn get_position(env: Env, txid: BytesN<32>) -> Option<Position> {
        get_position(&env, &txid, storage::entry_ttl(&env))
    }

    /// Returns the health ratio (in basis points) for a position.
    ///
    /// 15_000 = 150% (healthy), 12_000 = 120% (liquidation threshold),
    /// `i128::MAX` = position has no debt.
    pub fn get_health_ratio_bp(
        env: Env,
        txid: BytesN<32>,
    ) -> Result<i128, WritzLendError> {
        let config = get_config(&env).ok_or(WritzLendError::NotInitialized)?;
        let pos = get_position(&env, &txid, config.entry_ttl_ledgers).ok_or(WritzLendError::PositionNotFound)?;
        if pos.usdc_debt == 0 {
            return Ok(i128::MAX);
        }
        let price = get_btc_price_stroops(&env, &config.oracle)?;
        let collateral = collateral_value_stroops(pos.btc_satoshis, price)
            .ok_or(WritzLendError::Overflow)?;
        Ok(health_ratio_bp(collateral, pos.usdc_debt))
    }

    /// Blocks a borrow must leave between the `bitcoin-spv` tip and the
    /// position's timelock height.
    pub fn get_borrow_timelock_margin(env: Env) -> Result<u32, WritzLendError> {
        Ok(get_config(&env)
            .ok_or(WritzLendError::NotInitialized)?
            .borrow_timelock_margin_blocks)
    }

    /// Oldest the `bitcoin-spv` tip header may be, in seconds, for `borrow`
    /// and `liquidate` to rely on it.
    pub fn get_max_tip_age(env: Env) -> Result<u64, WritzLendError> {
        Ok(get_config(&env)
            .ok_or(WritzLendError::NotInitialized)?
            .max_tip_age_secs)
    }

    /// Current annual borrow rate in basis points (e.g. 800 = 8%).
    pub fn get_borrow_rate_bp(env: Env) -> i128 {
        let proto = get_protocol(&env);
        borrow_rate_bp(proto.total_borrowed, total_supply_assets(&proto, proto.supply_index))
    }

    /// Current annual supply rate in basis points.
    pub fn get_supply_rate_bp(env: Env) -> i128 {
        let proto = get_protocol(&env);
        let borrow = borrow_rate_bp(proto.total_borrowed, total_supply_assets(&proto, proto.supply_index));
        supply_rate_bp(borrow, proto.total_borrowed, total_supply_assets(&proto, proto.supply_index))
    }

    /// Returns a snapshot of the global protocol state.
    pub fn get_protocol_state(env: Env) -> ProtocolState {
        get_protocol(&env)
    }

    /// Returns the USDC supply balance (in stroops) for a lender.
    pub fn get_supply_balance(env: Env, lender: Address) -> i128 {
        let proto = get_protocol(&env);
        get_supply_balance(&env, &lender, storage::entry_ttl(&env)).saturating_mul(proto.supply_index) / rates::INDEX_ONE
    }

    // ── TTL refresh (permissionless) ──────────────────────────────────────────

    /// Extend the TTL of a position entry to the full `entry_ttl_ledgers`
    /// window (180 days on mainnet).
    ///
    /// A position past its window is archived, not deleted: the duplicate
    /// guard still holds and the entry is restored, unchanged, before any
    /// call can read it. Restoring costs the caller rent, so the keeper or
    /// borrower should call this before an open loan's window runs out.
    /// Returns false if no position exists for the given txid.
    pub fn refresh_position_ttl(env: Env, txid: BytesN<32>) -> bool {
        storage::refresh_position_ttl(&env, &txid, storage::entry_ttl(&env))
    }

    /// Extend the TTL of a lender's supply balance entry to the full
    /// `entry_ttl_ledgers` window.
    ///
    /// A lender who does not interact for longer than the window has their
    /// balance archived, and their next withdrawal pays to restore it.
    /// Returns false if the lender has no recorded balance.
    pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool {
        storage::refresh_supply_balance_ttl(&env, &lender, storage::entry_ttl(&env))
    }

    /// Extend the TTL of the global protocol accounting entry.
    pub fn refresh_protocol_ttl(env: Env) {
        storage::refresh_protocol_ttl(&env);
    }

    /// Extend the TTL of a published release PSBT to another window.
    ///
    /// A repaid position's release PSBT is otherwise only bumped as a side
    /// effect of fetching or re-publishing it. A user who has repaid but
    /// hasn't yet broadcast their release transaction should call this (or
    /// have their wallet call it periodically) rather than rely on activity
    /// that may not happen for a while. Returns false if no PSBT is on
    /// record for this txid.
    pub fn refresh_release_psbt_ttl(env: Env, txid: BytesN<32>) -> bool {
        storage::refresh_release_psbt_ttl(&env, &txid, storage::entry_ttl(&env))
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Height of the `bitcoin-spv` best tip, if its header is recent enough to
/// measure a timelock against. Fails closed: no tip, a tip whose header is
/// not stored, or a header time more than `max_tip_age_secs` behind the
/// ledger time is `StaleBitcoinTip`.
fn fresh_tip_height(env: &Env, config: &Config) -> Result<u32, WritzLendError> {
    let tip: Option<BestTip> = env.invoke_contract(
        &config.spv_contract,
        &Symbol::new(env, "get_best_tip"),
        Vec::new(env),
    );
    let tip = tip.ok_or(WritzLendError::StaleBitcoinTip)?;
    let header: Option<HeaderEntry> = env.invoke_contract(
        &config.spv_contract,
        &Symbol::new(env, "get_header"),
        (tip.hash,).into_val(env),
    );
    let header = header.ok_or(WritzLendError::StaleBitcoinTip)?;
    if env.ledger().timestamp() > (header.time as u64).saturating_add(config.max_tip_age_secs) {
        return Err(WritzLendError::StaleBitcoinTip);
    }
    Ok(tip.height)
}

/// True when the timelock height lies at least `blocks` above the tip.
fn timelock_clears(timelock_height: u32, tip_height: u32, blocks: u32) -> bool {
    timelock_height as u64 >= tip_height as u64 + blocks as u64
}

/// Brings the global borrow index up to date, charging interest on all
/// outstanding debt at the rate in force since the last update. Must run
/// before anything changes `total_borrowed` or `total_scaled_supply`, so the
/// interval just ended is priced at the utilization that held during it -
/// not at whatever a caller sets it to right now (GHSA-c9gg-c476-9vc8).
fn accrue_global(env: &Env, proto: &mut ProtocolState) {
    let current = env.ledger().sequence();
    let (borrow_index, supply_index, total_borrowed, reserve) = rates::project(proto, current);
    proto.borrow_index = borrow_index;
    proto.supply_index = supply_index;
    proto.total_borrowed = total_borrowed;
    proto.reserve_usdc = reserve;
    proto.index_ledger = current;
}

/// Brings `pos.usdc_debt` up to date with the global borrow index. The
/// interest itself was already added to `total_borrowed` and the reserve by
/// `accrue_global`, which this calls first.
fn accrue_position_interest(env: &Env, pos: &mut Position, proto: &mut ProtocolState) {
    accrue_global(env, proto);
    if pos.usdc_debt > 0 && pos.debt_index > 0 {
        pos.usdc_debt = pos.usdc_debt.saturating_mul(proto.borrow_index) / pos.debt_index;
    }
    pos.debt_index = proto.borrow_index;
    pos.last_update_ledger = env.ledger().sequence();
}
