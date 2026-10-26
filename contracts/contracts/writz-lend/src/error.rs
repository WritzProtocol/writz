use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WritzLendError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// Caller is not the admin.
    Unauthorized = 3,
    /// The SPV verification call to the bitcoin-spv contract failed.
    SpvVerificationFailed = 4,
    /// No P2WSH output matching the provided scriptPubKey was found in the transaction.
    OutputNotFound = 5,
    /// The BTC deposit is below the minimum required amount.
    DepositTooSmall = 6,
    /// A position already exists for this Bitcoin txid.
    PositionAlreadyExists = 7,
    /// No position found for the given Bitcoin txid.
    PositionNotFound = 8,
    /// The position is not in Active status (already closed or liquidated).
    PositionNotActive = 9,
    /// The borrow amount would exceed the maximum loan-to-value ratio.
    ExceedsCollateralRatio = 10,
    /// Not enough USDC liquidity in the pool.
    InsufficientLiquidity = 11,
    /// Repayment amount exceeds the outstanding debt.
    RepayExceedsDebt = 12,
    /// Withdrawal would reduce pool below the borrowed amount.
    InsufficientSupply = 13,
    /// The position is healthy and cannot be liquidated yet.
    PositionHealthy = 14,
    /// An integer overflow or underflow was detected.
    Overflow = 15,
    /// The provided scriptPubKey is not a valid 34-byte P2WSH scriptPubKey.
    InvalidScriptPubKey = 16,
    /// The contract is paused - new deposits, borrows, and USDC supply are
    /// refused. Existing positions can still repay, withdraw, liquidate, and
    /// release BTC; a pause only blocks new risk-taking.
    Paused = 17,
    /// The oracle returned no price for BTC/USD, or its raw price converted
    /// to a zero or negative USDC-stroops value.
    OraclePriceUnavailable = 18,
    /// The oracle's last price update is older than
    /// `oracle::MAX_PRICE_STALENESS_SECS`.
    OraclePriceStale = 19,
    /// `user_pubkey` is not a compressed secp256k1 public key encoding.
    InvalidUserPubkey = 20,
    /// The supplied scriptPubKey is not the P2WSH of the Writz redeem script
    /// derived from the protocol key, `user_pubkey` and `timelock_height`,
    /// so the output is not locked under the protocol's control.
    ScriptPubKeyMismatch = 21,
    /// `timelock_height` is not within the allowed window above the deposit
    /// block: too soon (an instant exit for a fresh position) or too far.
    InvalidTimelock = 22,
    /// The configured protocol public key is not a compressed secp256k1
    /// public key encoding.
    InvalidProtocolPubkey = 23,
    /// The borrow would take the pool past its total exposure cap (see `Config::max_total_borrowed`).
    ExposureCapExceeded = 24,
    /// `key_sig` is not a Bitcoin signed message by `user_pubkey` over this
    /// contract, the depositor and the deposit txid (GHSA-862g-739q-x6h8).
    InvalidKeyProof = 25,
    /// The amount is too small to mint or burn a single scaled unit at the
    /// current supply index, or is not positive.
    ZeroShareAmount = 26,
    /// A constructor `min_confirmations` is 0 or above
    /// `MAX_MIN_CONFIRMATIONS`, or `min_deposit_satoshis` is below
    /// `MIN_DEPOSIT_FLOOR_SATS`.
    InvalidDepositParams = 27,
    /// A constructor or `set_entry_ttl` `entry_ttl_ledgers` is outside
    /// `MIN_ENTRY_TTL_LEDGERS..=MAX_ENTRY_TTL_LEDGERS`.
    InvalidEntryTtl = 28,
    /// `user_pubkey` equals the protocol's co-signing key. Every key in the
    /// Writz script must be distinct, or the holder of that one key could
    /// complete the cooperative path alone.
    UserKeyIsProtocolKey = 29,
    /// The borrow would leave fewer than `borrow_timelock_margin_blocks`
    /// (4,320 by default) between the `bitcoin-spv` tip and the position's
    /// timelock height.
    TimelockTooSoon = 30,
    /// `bitcoin-spv` has no tip yet, or its tip header is older than
    /// `max_tip_age_secs`, so the current Bitcoin height is not known well
    /// enough to measure a timelock against.
    StaleBitcoinTip = 31,
    /// Fewer than `LIQUIDATION_CUTOFF_BLOCKS` (288) blocks remain between the
    /// `bitcoin-spv` tip and the position's timelock height, so the
    /// borrower's unilateral exit is about to open and a liquidation is no
    /// longer accepted.
    LiquidationWindowClosed = 32,
    /// A `set_borrow_timelock_margin` or `set_max_tip_age` value is outside
    /// its allowed range.
    InvalidTimelockParams = 33,
}
