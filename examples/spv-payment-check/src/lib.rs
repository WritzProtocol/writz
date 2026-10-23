//! Example: a Soroban contract that accepts a Bitcoin payment as proof.
//!
//! `check_payment` asks the Writz `bitcoin-spv` contract to prove that a
//! Bitcoin transaction is in a confirmed block, then parses the transaction
//! itself to find an output that pays `expected_script_pubkey` at least
//! `min_sats`. Each txid is accepted once (replay protection).
//!
//! `bitcoin-spv` proves inclusion and depth only. What the transaction paid,
//! and to whom, is always the caller's check.
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    Bytes, BytesN, Env, Vec,
};

/// Return type of `bitcoin-spv::verify_transaction`. Field names and types
/// must match the deployed contract (they are decoded by name).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    pub txid: BytesN<32>,
    pub block_hash: BytesN<32>,
    pub block_height: u32,
    pub confirmations: u32,
}

/// The subset of the `bitcoin-spv` interface this contract calls.
#[contractclient(name = "BitcoinSpvClient")]
pub trait BitcoinSpv {
    fn verify_transaction(
        env: Env,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> SpvVerificationResult;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// `bitcoin-spv` rejected the proof (unknown block, not enough
    /// confirmations, bad Merkle path, ...). Its own error code is in the
    /// diagnostic events of the failed call.
    ProofRejected = 1,
    /// No output pays `expected_script_pubkey`.
    OutputNotFound = 2,
    /// The matching output pays less than `min_sats`.
    AmountTooLow = 3,
    /// This txid was already accepted.
    AlreadyUsed = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payment {
    pub txid: BytesN<32>,
    pub sats: u64,
    pub block_height: u32,
    pub confirmations: u32,
}

#[contracttype]
enum DataKey {
    Spv,
    MinConfirmations,
    Used(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentAccepted {
    #[topic]
    pub txid: BytesN<32>,
    pub sats: u64,
}

#[contract]
pub struct SpvPaymentCheck;

#[contractimpl]
impl SpvPaymentCheck {
    /// `spv` is the `bitcoin-spv` contract ID. Use at least 1 confirmation;
    /// 6 is the usual choice.
    pub fn __constructor(env: Env, spv: Address, min_confirmations: u32) {
        env.storage().instance().set(&DataKey::Spv, &spv);
        env.storage()
            .instance()
            .set(&DataKey::MinConfirmations, &min_confirmations);
    }

    /// Accepts a Bitcoin payment of at least `min_sats` to
    /// `expected_script_pubkey`, proven by the relayer's `sorobanArgs`.
    pub fn check_payment(
        env: Env,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        expected_script_pubkey: Bytes,
        min_sats: u64,
    ) -> Result<Payment, Error> {
        let spv: Address = env.storage().instance().get(&DataKey::Spv).unwrap();
        let min_conf: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinConfirmations)
            .unwrap();

        // 1. Inclusion and depth, proven by bitcoin-spv. `try_` turns a
        //    callee error into a value instead of aborting this call.
        let proof = match BitcoinSpvClient::new(&env, &spv).try_verify_transaction(
            &block_hash,
            &merkle_proof,
            &tx_index,
            &raw_tx,
            &min_conf,
        ) {
            Ok(Ok(result)) => result,
            _ => return Err(Error::ProofRejected),
        };

        // 2. Replay protection: one acceptance per txid.
        let key = DataKey::Used(proof.txid.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyUsed);
        }

        // 3. What the transaction paid. `find_p2wsh_output` returns the value
        //    of the first output whose scriptPubKey equals the one given, for
        //    any script type (P2WPKH, P2WSH, P2TR, ...).
        let sats = spv_types::btc_parser::find_p2wsh_output(&raw_tx, &expected_script_pubkey)
            .ok_or(Error::OutputNotFound)?;
        if sats < min_sats {
            return Err(Error::AmountTooLow);
        }

        env.storage().persistent().set(&key, &true);
        PaymentAccepted {
            txid: proof.txid.clone(),
            sats,
        }
        .publish(&env);

        Ok(Payment {
            txid: proof.txid,
            sats,
            block_height: proof.block_height,
            confirmations: proof.confirmations,
        })
    }

    /// Whether a txid (internal byte order, as `bitcoin-spv` returns it)
    /// was already accepted.
    pub fn is_used(env: Env, txid: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Used(txid))
    }
}

#[cfg(test)]
mod test;
