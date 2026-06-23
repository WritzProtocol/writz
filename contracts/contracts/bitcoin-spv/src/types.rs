use soroban_sdk::{contracttype, BytesN};

/// Returned by a successful `verify_transaction` call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationResult {
    /// The transaction identifier: SHA256d of the non-witness serialization.
    pub txid: BytesN<32>,

    /// The hash (SHA256d) of the block that contains the transaction.
    /// This is the hash of `headers[0]`.
    pub block_hash: BytesN<32>,

    /// Number of block headers supplied by the caller.
    /// Equal to the number of confirmations the caller is asserting.
    pub confirmations: u32,
}
