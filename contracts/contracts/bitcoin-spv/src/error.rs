use soroban_sdk::contracterror;

/// All error conditions that can arise during SPV verification.
///
/// Error codes are stable - never reassign or remove an existing code,
/// as on-chain callers may branch on them.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SPVError {
    /// The `headers` vector is empty.
    NoHeaders = 1,

    /// Fewer headers were supplied than `min_confirmations` requires.
    InsufficientConfirmations = 2,

    /// `min_confirmations` was passed as zero, which is meaningless.
    ZeroMinConfirmations = 3,

    /// A header's `prev_block_hash` field does not match SHA256d of the
    /// preceding header, breaking the chain.
    HeaderChainBroken = 4,

    /// The Merkle inclusion proof did not reproduce the block's Merkle root.
    MerkleProofInvalid = 5,

    /// A header byte slice could not be interpreted as the expected sub-field.
    /// This should not occur when valid 80-byte headers are supplied.
    InvalidHeaderSlice = 6,

    /// The raw transaction bytes are empty.
    EmptyTransaction = 7,

    /// SHA256d(header) is not less than target(bits) - no valid
    /// proof-of-work behind this header.
    InsufficientProofOfWork = 8,

    /// The `bits` field encodes a negative or overflowing target per
    /// Bitcoin consensus rules (mirrors bitcoind's
    /// `arith_uint256::SetCompact` checks).
    InvalidDifficultyBits = 9,

    /// The contract has not been initialized yet - call `initialize` first.
    NotInitialized = 10,

    /// The contract has already been initialized.
    AlreadyInitialized = 11,

    /// The caller is not the admin.
    Unauthorized = 12,

    /// No checkpoint has been set - call `set_checkpoint` before
    /// `verify_transaction` will succeed.
    CheckpointNotSet = 13,

    /// A submitted header's target is easier than the checkpoint's
    /// difficulty floor allows - prevents a privately-mined,
    /// historically-easy chain from being accepted.
    DifficultyBelowCheckpointFloor = 14,

    /// `raw_tx` is exactly 64 bytes, the size of a Merkle inner-node
    /// preimage (`left || right`). Accepting it would let an attacker prove
    /// an inner node as if it were a transaction.
    AmbiguousTransactionLength = 15,

    /// `set_checkpoint` was already called. The trust root is set once;
    /// after that the chain only grows through `submit_headers`.
    CheckpointAlreadySet = 16,

    /// The checkpoint's fields are inconsistent (e.g. `bits` easier than the
    /// network's proof-of-work limit, or a period start after its time).
    InvalidCheckpoint = 17,

    /// `submit_headers` received more headers than fit in one call.
    TooManyHeaders = 18,

    /// A submitted header's `prev_block_hash` is not a header this contract
    /// already stores, so it does not descend from the checkpoint.
    UnknownParent = 19,

    /// A submitted header's `bits` differ from what Bitcoin's difficulty
    /// rules require at its height.
    UnexpectedDifficulty = 20,

    /// A submitted header's timestamp is more than two hours ahead of the
    /// ledger time.
    TimestampTooFarInFuture = 21,

    /// The block hash passed to `verify_transaction` is not stored.
    HeaderNotFound = 22,

    /// The block is stored but is not on the most-work chain (it was
    /// orphaned, or is not yet buried under the current tip).
    NotOnBestChain = 23,

    /// The block is the checkpoint itself or older; only blocks after the
    /// checkpoint can be proven.
    BlockNotAfterCheckpoint = 24,

    /// Switching to the heavier fork would rewrite more blocks than one
    /// call may touch.
    ReorgTooDeep = 25,
}
