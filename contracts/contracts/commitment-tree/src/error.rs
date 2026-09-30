use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CommitmentTreeError {
    AlreadyInitialized      = 1,
    NotInitialized          = 2,
    Unauthorized            = 3,
    /// ZK proof failed on-chain Groth16 verification.
    InvalidZkProof          = 4,
    /// `old_root` in the proof does not match the stored Merkle root.
    RootMismatch            = 5,
    /// This nullifier has already been spent.
    NullifierAlreadySpent   = 6,
    /// A deposit with the same Bitcoin txid already exists.
    DuplicateDeposit        = 7,
    /// The commitment was not registered via `deposit`.
    CommitmentNotFound      = 8,
    /// USDC pool does not have enough available liquidity.
    InsufficientLiquidity   = 9,
    /// `is_borrow` signal doesn't match the function called (borrow vs. repay).
    WrongCircuitMode        = 10,
    /// A public protocol parameter in the proof (min_ratio_bp, threshold, etc.)
    /// does not match the value stored in the contract's config.
    ProtocolParamMismatch   = 11,
    /// The BTC/USD price in the proof does not match the oracle's current price.
    PriceMismatch           = 12,
    /// The BTC txid encoded in the ZK proof does not match the SPV-verified txid.
    TxidMismatch            = 13,
    /// A signal value is too large to extract as a Soroban-native integer.
    /// Indicates the proof was computed with an out-of-range value.
    SignalOverflow          = 14,
    /// Withdrawal amount exceeds the supplier's own deposited balance.
    WithdrawExceedsBalance  = 15,
    /// The contract is paused - new deposits, borrows, and USDC supply are
    /// refused. Existing positions can still repay, withdraw, and liquidate;
    /// a pause only blocks new risk-taking.
    Paused                  = 16,
    /// `raw_tx` has no output paying `Config.zk_vault_script_pubkey` -
    /// this deposit's Bitcoin transaction never funded the protocol at all
    /// (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6, GHSA-mg4x-cr23-4x3v).
    VaultOutputNotFound     = 17,
    /// The proof's private `collateral_satoshis` (bound in-circuit to the
    /// public `actual_satoshis` signal) does not match the amount this
    /// contract independently parsed from `raw_tx`.
    CollateralAmountMismatch = 18,
}
