use soroban_sdk::contracterror;

/// All error conditions that can arise during SPV verification.
///
/// Error codes are stable — never reassign or remove an existing code,
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
}
