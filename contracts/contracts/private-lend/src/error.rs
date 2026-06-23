use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PrivateLendError {
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
}
