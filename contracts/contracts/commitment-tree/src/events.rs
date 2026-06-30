use soroban_sdk::{contractevent, Address, Bytes, BytesN};

/// Emitted when a BTC deposit is successfully registered and the ZK
/// commitment is queued for insertion into the Merkle tree.
#[contractevent(topics = ["deposit"])]
pub struct DepositEvent {
    #[topic]
    pub commitment: BytesN<32>,
    pub depositor:  Address,
    pub txid:       BytesN<32>,
    pub nullifier:  BytesN<32>,
    /// Opaque ciphertext of the position note ({collateral, debt, nonce, ...})
    /// encrypted to the owner's viewing key, for cross-device recovery. The
    /// contract never decrypts it — it only echoes the client-supplied blob.
    pub enc_note:   Bytes,
}

/// Emitted when the admin/relayer inserts a pending commitment into the
/// on-chain Merkle tree and advances the root.
#[contractevent(topics = ["insert_leaf"])]
pub struct InsertLeafEvent {
    #[topic]
    pub new_root:   BytesN<32>,
    pub commitment: BytesN<32>,
}

/// Emitted when a borrower draws USDC against a ZK position.
/// `old_nullifier` marks the previous commitment as spent.
#[contractevent(topics = ["borrow"])]
pub struct BorrowEvent {
    #[topic]
    pub new_root:      BytesN<32>,
    pub borrower:      Address,
    pub usdc_amount:   i128,
    pub old_nullifier: BytesN<32>,
    /// Encrypted position note for the new (higher-debt) commitment. See DepositEvent.
    pub enc_note:      Bytes,
}

/// Emitted when a borrower repays USDC debt on a ZK position.
/// `new_commitment` encodes the updated (lower) debt — a zero-debt commitment
/// signals full repayment; the backend co-signs the BTC release on seeing it.
#[contractevent(topics = ["repay"])]
pub struct RepayEvent {
    #[topic]
    pub new_root:       BytesN<32>,
    pub repayer:        Address,
    pub usdc_amount:    i128,
    pub old_nullifier:  BytesN<32>,
    pub new_commitment: BytesN<32>,
    /// Encrypted position note for the new (lower-debt) commitment. See DepositEvent.
    pub enc_note:       Bytes,
}

/// Emitted when a keeper liquidates an undercollateralized ZK position.
/// The backend monitors this event to co-sign the BTC release to the keeper.
#[contractevent(topics = ["liquidate"])]
pub struct LiquidateEvent {
    #[topic]
    pub nullifier: BytesN<32>,
    pub keeper:    Address,
    pub usdc_debt: i128,
}
