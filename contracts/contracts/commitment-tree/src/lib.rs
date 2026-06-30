#![no_std]

mod error;
mod events;
mod oracle;
mod types;

#[cfg(test)]
mod test;

use error::CommitmentTreeError;
use events::{BorrowEvent, DepositEvent, InsertLeafEvent, LiquidateEvent, RepayEvent};
use oracle::get_btc_price_stroops;
use soroban_sdk::{
    contract, contractimpl, token, Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};
use types::{
    borrow_repay_signals as br, deposit_signals as ds, liquidation_signals as lq, Config,
    DataKey, PoolState, Proof, SpvResult,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Poseidon-2 empty Merkle tree root at depth 20.
///
/// Computed with circomlibjs:
///   zeros[0] = 0n
///   zeros[i] = Poseidon(zeros[i-1], zeros[i-1])  for i = 1..=20
///
/// zeros[20] = 0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e
pub const EMPTY_TREE_ROOT: [u8; 32] = [
    0x21, 0x34, 0xe7, 0x6a, 0xc5, 0xd2, 0x1a, 0xab,
    0x18, 0x6c, 0x2b, 0xe1, 0xdd, 0x8f, 0x84, 0xee,
    0x88, 0x0a, 0x1e, 0x46, 0xea, 0xf7, 0x12, 0xf9,
    0xd3, 0x71, 0xb6, 0xdf, 0x22, 0x19, 0x1f, 0x3e,
];

/// BN254 scalar field prime (big-endian).
///
/// p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
///   = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
///
/// Used to recover a repay amount from its negated field representation:
///   repay_amount = p − signal[DELTA_STROOPS]
pub const BN254_PRIME: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

// Each ledger targets a 5-second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

// Regular persistent entries (pool, commitments, supply balances):
// extend to 90 days; only extend when less than 30 days remain.
const PERSISTENT_BUMP:      u32 = 90 * LEDGERS_PER_DAY;
const PERSISTENT_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

// Spent-nullifier entries must outlive any active position.
// Extend to 180 days (near the current Soroban mainnet cap); only extend
// when less than 30 days remain so the cost is paid infrequently.
const NULLIFIER_BUMP:      u32 = 180 * LEDGERS_PER_DAY;
const NULLIFIER_THRESHOLD: u32 =  30 * LEDGERS_PER_DAY;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CommitmentTreeContract;

#[contractimpl]
impl CommitmentTreeContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time contract initialization.
    ///
    /// Stores the admin, external contract addresses, and protocol parameters.
    /// Initializes the on-chain Merkle root to the depth-20 Poseidon empty-tree
    /// root so that the first borrow proof's `old_root` can be independently
    /// verified off-chain without any trusted setup.
    pub fn initialize(
        env: Env,
        admin: Address,
        spv_contract: Address,
        zk_verifier: Address,
        usdc_token: Address,
        oracle: Address,
        min_confirmations: u32,
    ) -> Result<(), CommitmentTreeError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(CommitmentTreeError::AlreadyInitialized);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                spv_contract,
                zk_verifier,
                usdc_token,
                oracle,
                min_confirmations,
                min_deposit_satoshis:     100_000,
                min_collateral_ratio_bp:  15_000,
                liquidation_threshold_bp: 12_000,
            },
        );
        env.storage().instance().extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
        let empty = BytesN::from_array(&env, &EMPTY_TREE_ROOT);
        env.storage().persistent().set(&DataKey::MerkleRoot, &empty);
        env.storage().persistent().extend_ttl(
            &DataKey::MerkleRoot,
            NULLIFIER_THRESHOLD,
            NULLIFIER_BUMP,
        );
        Ok(())
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Register a BTC deposit with a ZK commitment.
    ///
    /// The function performs the following checks, in order:
    ///
    /// 1. **SPV** — the BTC transaction is confirmed with `min_confirmations`.
    /// 2. **Duplicate guard** — the txid has not been deposited before.
    /// 3. **Txid binding** — `signal[BTC_TXID_LO]` and `signal[BTC_TXID_HI]`
    ///    encode the same txid that the SPV call returned.  This prevents
    ///    replaying a proof from a different transaction.
    /// 4. **Protocol param** — `signal[MIN_DEPOSIT_SATS]` equals the
    ///    configured minimum.  This prevents generating a proof with a lower
    ///    minimum to sneak in an undersized deposit.
    /// 5. **Nullifier freshness** — the nullifier was not previously spent.
    /// 6. **ZK proof** — Groth16 verification via the `zk-verifier` contract.
    ///
    /// On success, the commitment is stored as *pending* tree insertion.
    /// Call `insert_commitment` (admin/relayer) to advance the Merkle root
    /// and make the position borrowable.
    ///
    /// # Public signals (deposit circuit)
    /// | Index | Signal | Description |
    /// |-------|--------|-------------|
    /// | 0 | `commitment` | Poseidon(collateral, 0, secret, nonce) |
    /// | 1 | `nullifier` | Poseidon(secret, nonce) |
    /// | 2 | `btc_txid_lo` | Low 128 bits of txid as Fr element |
    /// | 3 | `btc_txid_hi` | High 128 bits of txid as Fr element |
    /// | 4 | `min_deposit_sats` | Must equal `Config.min_deposit_satoshis` |
    ///
    /// # Returns
    /// The commitment (the leaf value to be inserted into the Merkle tree).
    pub fn deposit(
        env: Env,
        depositor: Address,
        headers: Vec<BytesN<80>>,
        merkle_proof_btc: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        zk_proof: Proof,
        public_signals: Vec<BytesN<32>>,
        enc_note: Bytes,
    ) -> Result<BytesN<32>, CommitmentTreeError> {
        depositor.require_auth();
        let config = Self::load_config(&env)?;

        if public_signals.len() != ds::COUNT as u32 {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        // 1. Bitcoin SPV verification.
        let spv: SpvResult = env.invoke_contract(
            &config.spv_contract,
            &Symbol::new(&env, "verify_transaction"),
            (headers, merkle_proof_btc, tx_index, raw_tx, config.min_confirmations)
                .into_val(&env),
        );

        // 2. Reject duplicate deposits.
        if env.storage().persistent().has(&DataKey::TxCommitment(spv.txid.clone())) {
            return Err(CommitmentTreeError::DuplicateDeposit);
        }

        // 3. Txid binding: the ZK proof must commit to this exact Bitcoin txid.
        //
        //    The circuit encodes the 32-byte txid as two 128-bit field elements:
        //      btc_txid_hi = txid[0..16]  (high 128 bits, stored in signal bytes 16..32)
        //      btc_txid_lo = txid[16..32] (low  128 bits, stored in signal bytes 16..32)
        //    Both signal field elements have zero in their high 16 bytes.
        let txid_arr = spv.txid.to_array();
        let sig_lo = public_signals.get(ds::BTC_TXID_LO as u32).unwrap().to_array();
        let sig_hi = public_signals.get(ds::BTC_TXID_HI as u32).unwrap().to_array();
        let lo_ok = sig_lo[0..16] == [0u8; 16] && sig_lo[16..32] == txid_arr[16..32];
        let hi_ok = sig_hi[0..16] == [0u8; 16] && sig_hi[16..32] == txid_arr[0..16];
        if !lo_ok || !hi_ok {
            return Err(CommitmentTreeError::TxidMismatch);
        }

        // 4. Protocol parameter binding.
        //    Signal[MIN_DEPOSIT_SATS] must equal the configured minimum so that
        //    a proof generated with a lower threshold cannot be replayed here.
        let min_sats_signal = sig_u64(&public_signals.get(ds::MIN_DEPOSIT_SATS as u32).unwrap());
        if min_sats_signal != config.min_deposit_satoshis {
            return Err(CommitmentTreeError::ProtocolParamMismatch);
        }

        let commitment: BytesN<32> = public_signals.get(ds::COMMITMENT as u32).unwrap();
        let nullifier:  BytesN<32> = public_signals.get(ds::NULLIFIER  as u32).unwrap();

        // 5. Nullifier must not be spent.
        if env.storage().persistent().has(&DataKey::SpentNullifier(nullifier.clone())) {
            return Err(CommitmentTreeError::NullifierAlreadySpent);
        }

        // 6. Groth16 proof verification.
        let verified: bool = env.invoke_contract(
            &config.zk_verifier,
            &Symbol::new(&env, "verify_deposit"),
            (zk_proof, public_signals).into_val(&env),
        );
        if !verified {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        // Record commitment as pending tree insertion; extend TTL on both entries.
        let txid_key    = DataKey::TxCommitment(spv.txid.clone());
        let pending_key = DataKey::PendingCommitment(commitment.clone());
        env.storage().persistent().set(&txid_key, &commitment);
        env.storage().persistent().extend_ttl(&txid_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);
        env.storage().persistent().set(&pending_key, &spv.txid);
        env.storage().persistent().extend_ttl(&pending_key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        DepositEvent { commitment: commitment.clone(), depositor, txid: spv.txid, nullifier, enc_note }
            .publish(&env);

        Ok(commitment)
    }

    // ── Merkle root management (Phase 1: trusted relayer) ─────────────────────

    /// Insert a pending commitment into the Merkle tree and advance the root.
    ///
    /// **Phase 1 (trusted admin):** the relayer runs the Poseidon tree off-chain
    /// with circomlibjs, inserts the commitment at the next available leaf, and
    /// submits the resulting root here.
    ///
    /// **Phase 2 (planned):** will require a ZK proof of correct insertion
    /// (using `MerkleTreeUpdater`) making this operation fully trustless.
    ///
    /// The commitment must have been previously registered via `deposit`.
    pub fn insert_commitment(
        env: Env,
        caller: Address,
        commitment: BytesN<32>,
        new_root: BytesN<32>,
    ) -> Result<(), CommitmentTreeError> {
        caller.require_auth();
        let config = Self::load_config(&env)?;
        if caller != config.admin {
            return Err(CommitmentTreeError::Unauthorized);
        }
        if !env.storage().persistent().has(&DataKey::PendingCommitment(commitment.clone())) {
            return Err(CommitmentTreeError::CommitmentNotFound);
        }
        env.storage().persistent().remove(&DataKey::PendingCommitment(commitment.clone()));
        env.storage().persistent().set(&DataKey::MerkleRoot, &new_root);
        env.storage().persistent().extend_ttl(
            &DataKey::MerkleRoot,
            NULLIFIER_THRESHOLD,
            NULLIFIER_BUMP,
        );

        InsertLeafEvent { new_root, commitment }.publish(&env);
        Ok(())
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    /// Borrow USDC against a BTC position using a ZK proof.
    ///
    /// The borrow_repay proof (with `is_borrow = 1`) proves — without
    /// revealing collateral, debt amount, or position owner — that:
    /// * The caller's commitment exists in the tree at `old_root`.
    /// * After adding `delta_stroops`, collateral ratio ≥ 150%.
    /// * `new_root` correctly reflects the updated commitment.
    ///
    /// The USDC amount transferred to the borrower is derived **from the
    /// proof's `delta_stroops` signal**, not from a caller-provided parameter.
    /// This ensures the on-chain transfer exactly matches what the circuit
    /// committed to.
    ///
    /// # Validations
    /// Beyond Groth16 correctness, the contract enforces:
    /// * `old_root == stored_root` — no stale proofs.
    /// * `is_borrow == 1` — prevents a repay proof being used here.
    /// * `min_ratio_bp == config.min_collateral_ratio_bp` — no custom thresholds.
    /// * `btc_price == oracle price` — no inflated collateral valuations.
    /// * `old_nullifier` not spent — no double-borrow.
    ///
    /// # Public signals (borrow_repay circuit)
    /// | Index | Signal |
    /// |-------|--------|
    /// | 0 | `new_root` |
    /// | 1 | `old_nullifier` |
    /// | 2 | `new_commitment` |
    /// | 3 | `old_root` |
    /// | 4 | `delta_stroops` (positive i128 for borrow) |
    /// | 5 | `is_borrow` (1) |
    /// | 6 | `btc_price_stroops_per_btc` |
    /// | 7 | `min_ratio_bp` |
    pub fn borrow(
        env: Env,
        borrower: Address,
        zk_proof: Proof,
        public_signals: Vec<BytesN<32>>,
        enc_note: Bytes,
    ) -> Result<(), CommitmentTreeError> {
        borrower.require_auth();
        let config = Self::load_config(&env)?;

        if public_signals.len() != br::COUNT as u32 {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        let old_root_sig  = public_signals.get(br::OLD_ROOT      as u32).unwrap();
        let old_nullifier = public_signals.get(br::OLD_NULLIFIER as u32).unwrap();
        let new_root      = public_signals.get(br::NEW_ROOT      as u32).unwrap();

        // old_root must match stored root — prevents stale proofs.
        if old_root_sig != Self::stored_root(&env) {
            return Err(CommitmentTreeError::RootMismatch);
        }

        // Nullifier must not be spent.
        if env.storage().persistent().has(&DataKey::SpentNullifier(old_nullifier.clone())) {
            return Err(CommitmentTreeError::NullifierAlreadySpent);
        }

        // is_borrow must be 1 — prevents a repay proof being submitted here.
        let is_borrow = sig_u32(&public_signals.get(br::IS_BORROW as u32).unwrap());
        if is_borrow != 1 {
            return Err(CommitmentTreeError::WrongCircuitMode);
        }

        // min_ratio_bp must match the configured protocol parameter — prevents
        // generating a proof with a lower threshold to exceed the allowed LTV.
        let min_ratio = sig_u32(&public_signals.get(br::MIN_RATIO_BP as u32).unwrap());
        if min_ratio != config.min_collateral_ratio_bp {
            return Err(CommitmentTreeError::ProtocolParamMismatch);
        }

        // btc_price must match the oracle — prevents inflating collateral value
        // with a stale or fabricated price to borrow beyond true LTV.
        let price_signal = sig_i128(&public_signals.get(br::BTC_PRICE as u32).unwrap())
            .ok_or(CommitmentTreeError::SignalOverflow)?;
        if price_signal != get_btc_price_stroops(&env, &config.oracle) {
            return Err(CommitmentTreeError::PriceMismatch);
        }

        // Extract the borrow amount from the proof — not from the caller.
        // delta_stroops is a positive 120-bit number for borrow operations.
        let usdc_amount = sig_i128(&public_signals.get(br::DELTA_STROOPS as u32).unwrap())
            .ok_or(CommitmentTreeError::SignalOverflow)?;

        // Check pool liquidity.
        let mut pool = Self::load_pool(&env);
        let available = pool.total_supplied.saturating_sub(pool.total_borrowed);
        if usdc_amount > available {
            return Err(CommitmentTreeError::InsufficientLiquidity);
        }

        // Groth16 proof verification — must come after all signal-level checks
        // so we don't pay the cross-contract call cost on a clearly invalid request.
        let verified: bool = env.invoke_contract(
            &config.zk_verifier,
            &Symbol::new(&env, "verify_borrow_repay"),
            (zk_proof, public_signals).into_val(&env),
        );
        if !verified {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        // Atomic state update with TTL extension on every written entry.
        let nullifier_key = DataKey::SpentNullifier(old_nullifier.clone());
        env.storage().persistent().set(&DataKey::MerkleRoot, &new_root);
        env.storage().persistent().extend_ttl(
            &DataKey::MerkleRoot,
            NULLIFIER_THRESHOLD,
            NULLIFIER_BUMP,
        );
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().extend_ttl(&nullifier_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);
        pool.total_borrowed = pool.total_borrowed.saturating_add(usdc_amount);
        env.storage().persistent().set(&DataKey::Pool, &pool);
        env.storage().persistent().extend_ttl(&DataKey::Pool, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        token::Client::new(&env, &config.usdc_token).transfer(
            &env.current_contract_address(),
            &borrower,
            &usdc_amount,
        );

        BorrowEvent { new_root, borrower, usdc_amount, old_nullifier, enc_note }.publish(&env);
        Ok(())
    }

    // ── Repay ─────────────────────────────────────────────────────────────────

    /// Repay USDC debt on a ZK position.
    ///
    /// The borrow_repay proof (with `is_borrow = 0`) proves that:
    /// * The caller's commitment exists in the tree at `old_root`.
    /// * The new commitment correctly reflects the reduced debt.
    /// * `new_root` reflects the updated commitment.
    ///
    /// The USDC amount collected from the repayer is recovered from the
    /// proof's `delta_stroops` signal (encoded as `p − repay_amount`, the
    /// BN254 field negation) so the transfer exactly matches the circuit's
    /// committed value:
    ///   `repay_amount = BN254_PRIME − signal[DELTA_STROOPS]`
    ///
    /// A `new_commitment` with zero debt signals full repayment.  The Writz
    /// backend monitors the `RepayEvent` to co-sign the BTC release (path A).
    ///
    /// # Validations
    /// * `old_root == stored_root`
    /// * `is_borrow == 0`
    /// * `old_nullifier` not spent
    /// * Groth16 proof correctness
    pub fn repay(
        env: Env,
        repayer: Address,
        zk_proof: Proof,
        public_signals: Vec<BytesN<32>>,
        enc_note: Bytes,
    ) -> Result<(), CommitmentTreeError> {
        repayer.require_auth();
        let config = Self::load_config(&env)?;

        if public_signals.len() != br::COUNT as u32 {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        let old_root_sig   = public_signals.get(br::OLD_ROOT      as u32).unwrap();
        let old_nullifier  = public_signals.get(br::OLD_NULLIFIER as u32).unwrap();
        let new_commitment = public_signals.get(br::NEW_COMMITMENT as u32).unwrap();
        let new_root       = public_signals.get(br::NEW_ROOT      as u32).unwrap();

        if old_root_sig != Self::stored_root(&env) {
            return Err(CommitmentTreeError::RootMismatch);
        }
        if env.storage().persistent().has(&DataKey::SpentNullifier(old_nullifier.clone())) {
            return Err(CommitmentTreeError::NullifierAlreadySpent);
        }

        // is_borrow must be 0 — prevents a borrow proof being submitted here.
        let is_borrow = sig_u32(&public_signals.get(br::IS_BORROW as u32).unwrap());
        if is_borrow != 0 {
            return Err(CommitmentTreeError::WrongCircuitMode);
        }

        // Recover the repay amount: for repay, delta_stroops = p − repay_amount
        // in the BN254 field.  Invert the negation to get the positive amount.
        let delta_arr = public_signals.get(br::DELTA_STROOPS as u32).unwrap().to_array();
        let repay_arr = be32_sub(&BN254_PRIME, &delta_arr);
        let usdc_amount = i128_from_be32_low(&repay_arr)
            .ok_or(CommitmentTreeError::SignalOverflow)?;

        // Groth16 proof verification.
        let verified: bool = env.invoke_contract(
            &config.zk_verifier,
            &Symbol::new(&env, "verify_borrow_repay"),
            (zk_proof, public_signals).into_val(&env),
        );
        if !verified {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        // Collect USDC from repayer.
        token::Client::new(&env, &config.usdc_token).transfer(
            &repayer,
            &env.current_contract_address(),
            &usdc_amount,
        );

        // Atomic state update with TTL extension on every written entry.
        let nullifier_key = DataKey::SpentNullifier(old_nullifier.clone());
        env.storage().persistent().set(&DataKey::MerkleRoot, &new_root);
        env.storage().persistent().extend_ttl(
            &DataKey::MerkleRoot,
            NULLIFIER_THRESHOLD,
            NULLIFIER_BUMP,
        );
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().extend_ttl(&nullifier_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);
        let mut pool = Self::load_pool(&env);
        pool.total_borrowed = pool.total_borrowed.saturating_sub(usdc_amount);
        env.storage().persistent().set(&DataKey::Pool, &pool);
        env.storage().persistent().extend_ttl(&DataKey::Pool, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        RepayEvent { new_root, repayer, usdc_amount, old_nullifier, new_commitment, enc_note }
            .publish(&env);
        Ok(())
    }

    // ── Liquidation ───────────────────────────────────────────────────────────

    /// Liquidate an undercollateralized position using a ZK proof.
    ///
    /// The ZK liquidation proof proves — without revealing the position owner
    /// or collateral amount — that:
    /// * The commitment is in the tree at `merkle_root`.
    /// * The collateral ratio is below `liquidation_threshold_bp`.
    /// * `usdc_debt` matches the private debt encoded in the commitment.
    ///
    /// The debt amount is extracted **from the proof's `usdc_debt` signal**, not
    /// from a caller-supplied parameter.  The circuit constrains
    /// `usdc_debt == debt_stroops` where `debt_stroops` is the private value
    /// hashed into the commitment, so a keeper cannot inflate or deflate the
    /// amount collected.
    ///
    /// Liquidation reveals the debt amount by design — the position is being
    /// publicly closed and the on-chain USDC transfer must match the proven debt.
    ///
    /// # Validations
    /// * `merkle_root == stored_root`
    /// * `liquidation_threshold_bp == config.liquidation_threshold_bp`
    /// * `btc_price == oracle price`
    /// * `nullifier` not spent
    /// * Groth16 proof correctness
    ///
    /// # Public signals (liquidation circuit)
    /// | Index | Signal |
    /// |-------|--------|
    /// | 0 | `nullifier` (circuit output) |
    /// | 1 | `usdc_debt` (circuit output — proven debt from commitment) |
    /// | 2 | `merkle_root` |
    /// | 3 | `btc_price_stroops_per_btc` |
    /// | 4 | `liquidation_threshold_bp` |
    pub fn liquidate(
        env: Env,
        keeper: Address,
        zk_proof: Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> Result<(), CommitmentTreeError> {
        keeper.require_auth();
        let config = Self::load_config(&env)?;

        if public_signals.len() != lq::COUNT as u32 {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        let nullifier   = public_signals.get(lq::NULLIFIER   as u32).unwrap();
        let root_signal = public_signals.get(lq::MERKLE_ROOT as u32).unwrap();

        if root_signal != Self::stored_root(&env) {
            return Err(CommitmentTreeError::RootMismatch);
        }
        if env.storage().persistent().has(&DataKey::SpentNullifier(nullifier.clone())) {
            return Err(CommitmentTreeError::NullifierAlreadySpent);
        }

        // liquidation_threshold_bp must match config — prevents proving
        // undercollateralization at a threshold looser than the protocol allows.
        let threshold = sig_u32(&public_signals.get(lq::LIQUIDATION_THRESHOLD as u32).unwrap());
        if threshold != config.liquidation_threshold_bp {
            return Err(CommitmentTreeError::ProtocolParamMismatch);
        }

        // btc_price must match the oracle — prevents a keeper from using a
        // deflated price to make a healthy position appear undercollateralized.
        let price_signal = sig_i128(&public_signals.get(lq::BTC_PRICE as u32).unwrap())
            .ok_or(CommitmentTreeError::SignalOverflow)?;
        if price_signal != get_btc_price_stroops(&env, &config.oracle) {
            return Err(CommitmentTreeError::PriceMismatch);
        }

        // Extract the debt amount from the proof.  The circuit constrains
        // usdc_debt == debt_stroops, so this value matches the private debt
        // field that was hashed into the position commitment.
        let usdc_debt = sig_i128(&public_signals.get(lq::USDC_DEBT as u32).unwrap())
            .ok_or(CommitmentTreeError::SignalOverflow)?;

        // Groth16 proof verification.
        let verified: bool = env.invoke_contract(
            &config.zk_verifier,
            &Symbol::new(&env, "verify_liquidation"),
            (zk_proof, public_signals).into_val(&env),
        );
        if !verified {
            return Err(CommitmentTreeError::InvalidZkProof);
        }

        // Keeper pays the proven debt into the pool.
        token::Client::new(&env, &config.usdc_token).transfer(
            &keeper,
            &env.current_contract_address(),
            &usdc_debt,
        );

        // Atomic state update with TTL extension on every written entry.
        let nullifier_key = DataKey::SpentNullifier(nullifier.clone());
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().extend_ttl(&nullifier_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);
        let mut pool = Self::load_pool(&env);
        pool.total_borrowed = pool.total_borrowed.saturating_sub(usdc_debt);
        env.storage().persistent().set(&DataKey::Pool, &pool);
        env.storage().persistent().extend_ttl(&DataKey::Pool, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        LiquidateEvent { nullifier, keeper, usdc_debt }.publish(&env);
        Ok(())
    }

    // ── USDC supply pool ──────────────────────────────────────────────────────

    /// Lender supplies USDC to the pool to earn yield from borrower interest.
    ///
    /// Each supplier's balance is tracked individually under
    /// `DataKey::SupplyBalance(supplier)` so that `withdraw_supply` can enforce
    /// that no supplier withdraws more than they deposited.
    pub fn supply_usdc(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), CommitmentTreeError> {
        supplier.require_auth();
        let config = Self::load_config(&env)?;

        token::Client::new(&env, &config.usdc_token).transfer(
            &supplier,
            &env.current_contract_address(),
            &amount,
        );

        let mut pool = Self::load_pool(&env);
        pool.total_supplied = pool.total_supplied.saturating_add(amount);
        env.storage().persistent().set(&DataKey::Pool, &pool);
        env.storage().persistent().extend_ttl(&DataKey::Pool, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        let bal = Self::load_supply_balance(&env, &supplier);
        let bal_key = DataKey::SupplyBalance(supplier.clone());
        env.storage().persistent().set(&bal_key, &bal.saturating_add(amount));
        env.storage().persistent().extend_ttl(&bal_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);

        Ok(())
    }

    /// Lender withdraws USDC from the pool.
    ///
    /// Two limits are enforced:
    /// 1. The supplier cannot withdraw more than their own deposited balance —
    ///    prevents one lender from draining another lender's funds.
    /// 2. The pool must have sufficient undeployed liquidity
    ///    (`total_supplied − total_borrowed`) — prevents withdrawing USDC that
    ///    is currently lent out to borrowers.
    pub fn withdraw_supply(
        env: Env,
        supplier: Address,
        amount: i128,
    ) -> Result<(), CommitmentTreeError> {
        supplier.require_auth();
        let config = Self::load_config(&env)?;

        let bal = Self::load_supply_balance(&env, &supplier);
        if amount > bal {
            return Err(CommitmentTreeError::WithdrawExceedsBalance);
        }

        let mut pool = Self::load_pool(&env);
        let available = pool.total_supplied.saturating_sub(pool.total_borrowed);
        if amount > available {
            return Err(CommitmentTreeError::InsufficientLiquidity);
        }

        let bal_key = DataKey::SupplyBalance(supplier.clone());
        env.storage().persistent().set(&bal_key, &(bal - amount));
        env.storage().persistent().extend_ttl(&bal_key, NULLIFIER_THRESHOLD, NULLIFIER_BUMP);

        pool.total_supplied = pool.total_supplied.saturating_sub(amount);
        env.storage().persistent().set(&DataKey::Pool, &pool);
        env.storage().persistent().extend_ttl(&DataKey::Pool, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);

        token::Client::new(&env, &config.usdc_token).transfer(
            &env.current_contract_address(),
            &supplier,
            &amount,
        );
        Ok(())
    }

    // ── TTL refresh (permissionless) ──────────────────────────────────────────

    /// Extend the TTL of a spent-nullifier entry to another 180-day window.
    ///
    /// Spent nullifiers are the primary double-spend guard for ZK positions.
    /// If a nullifier entry expires, the corresponding old commitment could
    /// theoretically be re-used in a new proof. Keepers should refresh any
    /// nullifier that is approaching its 180-day window.
    /// Returns false if the nullifier is not currently marked as spent.
    pub fn refresh_nullifier_ttl(env: Env, nullifier: BytesN<32>) -> bool {
        let key = DataKey::SpentNullifier(nullifier);
        if !env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().extend_ttl(&key, 0, NULLIFIER_BUMP);
        true
    }

    /// Extend the TTL of the Bitcoin txid → commitment dedup record.
    ///
    /// If this entry expires, the same Bitcoin transaction can be deposited a
    /// second time, creating a duplicate commitment backed by the same UTXO.
    /// Call this periodically for any active or recently-closed deposit.
    /// Returns false if the txid has not been deposited.
    pub fn refresh_commitment_ttl(env: Env, txid: BytesN<32>) -> bool {
        let key = DataKey::TxCommitment(txid);
        if !env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().extend_ttl(&key, 0, NULLIFIER_BUMP);
        true
    }

    /// Extend the TTL of the on-chain Merkle root to another 180-day window.
    ///
    /// If the root entry expires, `stored_root` falls back to `EMPTY_TREE_ROOT`,
    /// making all existing position proofs fail with `RootMismatch` until the
    /// root is restored by a new borrow/repay/insert_commitment. Call this any
    /// time the protocol experiences an extended period of inactivity.
    pub fn refresh_merkle_root_ttl(env: Env) {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::MerkleRoot, 0, NULLIFIER_BUMP);
    }

    /// Extend the TTL of the USDC pool accounting entry.
    pub fn refresh_pool_ttl(env: Env) {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Pool, 0, PERSISTENT_BUMP);
    }

    /// Extend the TTL of a lender's supply balance entry.
    ///
    /// Lenders who supplied USDC and do not interact for an extended period
    /// risk having their balance entry expire, preventing withdrawal.
    /// Returns false if the lender has no recorded balance.
    pub fn refresh_supply_balance_ttl(env: Env, lender: Address) -> bool {
        let key = DataKey::SupplyBalance(lender);
        if !env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().extend_ttl(&key, 0, NULLIFIER_BUMP);
        true
    }

    /// Extend the instance storage TTL to another 90-day window.
    ///
    /// Instance storage holds the contract Config. If the protocol is inactive
    /// for 90 days, the Config entry expires and all functions return
    /// `NotInitialized`. Keepers should call this periodically.
    pub fn refresh_instance_ttl(env: Env) {
        env.storage().instance().extend_ttl(0, PERSISTENT_BUMP);
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns the current Poseidon Merkle root of the position commitment tree.
    pub fn get_merkle_root(env: Env) -> BytesN<32> {
        Self::stored_root(&env)
    }

    /// Returns true if the nullifier has already been spent.
    pub fn is_nullifier_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::SpentNullifier(nullifier))
    }

    /// Returns the commitment for a Bitcoin txid, or None if not deposited.
    pub fn get_commitment(env: Env, txid: BytesN<32>) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::TxCommitment(txid))
    }

    /// Returns true if a commitment is pending Merkle tree insertion.
    pub fn is_commitment_pending(env: Env, commitment: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::PendingCommitment(commitment))
    }

    /// Returns `(total_supplied, total_borrowed)` in USDC stroops.
    pub fn get_pool_state(env: Env) -> (i128, i128) {
        let p = Self::load_pool(&env);
        (p.total_supplied, p.total_borrowed)
    }

    /// Returns the USDC supply balance (in stroops) for a lender.
    pub fn get_supply_balance(env: Env, lender: Address) -> i128 {
        Self::load_supply_balance(&env, &lender)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn load_config(env: &Env) -> Result<Config, CommitmentTreeError> {
        let config = env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(CommitmentTreeError::NotInitialized)?;
        // Extend instance TTL on every call so the contract stays alive as long
        // as it is being used.
        env.storage().instance().extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
        Ok(config)
    }

    fn load_pool(env: &Env) -> PoolState {
        env.storage()
            .persistent()
            .get(&DataKey::Pool)
            .unwrap_or(PoolState { total_supplied: 0, total_borrowed: 0 })
    }

    fn stored_root(env: &Env) -> BytesN<32> {
        env.storage()
            .persistent()
            .get(&DataKey::MerkleRoot)
            .unwrap_or(BytesN::from_array(env, &EMPTY_TREE_ROOT))
    }

    fn load_supply_balance(env: &Env, lender: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SupplyBalance(lender.clone()))
            .unwrap_or(0)
    }
}

// ── Signal extraction helpers ─────────────────────────────────────────────────
//
// BN254 field elements are serialized as 32-byte big-endian integers.
// For values that represent "normal" numbers (amounts, prices, flags),
// the high bytes are zero and the value fits in smaller native types.

/// Extracts a `u32` from the last 4 bytes of a 32-byte field element.
/// Used for boolean flags (`is_borrow`) and basis-point protocol parameters.
pub(crate) fn sig_u32(sig: &BytesN<32>) -> u32 {
    let arr = sig.to_array();
    u32::from_be_bytes([arr[28], arr[29], arr[30], arr[31]])
}

/// Extracts a `u64` from the last 8 bytes of a 32-byte field element.
/// Used for satoshi amounts (Bitcoin amounts fit in 51 bits).
pub(crate) fn sig_u64(sig: &BytesN<32>) -> u64 {
    let arr = sig.to_array();
    u64::from_be_bytes([arr[24], arr[25], arr[26], arr[27], arr[28], arr[29], arr[30], arr[31]])
}

/// Extracts a non-negative `i128` from the low 16 bytes of a 32-byte field element.
///
/// Returns `None` if the high 16 bytes are non-zero, which would indicate a
/// value exceeding 2^127 — impossible for any realistic USDC amount or price.
pub(crate) fn sig_i128(sig: &BytesN<32>) -> Option<i128> {
    let arr = sig.to_array();
    if arr[0..16] != [0u8; 16] {
        return None;
    }
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&arr[16..32]);
    Some(i128::from_be_bytes(buf))
}

/// Big-endian 32-byte subtraction: `a − b`.
///
/// Used to recover a repayment amount from its BN254 negation:
///   `repay_amount = BN254_PRIME − delta_signal`
///
/// Precondition: `a >= b` (guaranteed by the field arithmetic invariant that
/// `delta_signal < p` and `delta_signal = p − repay_amount > 0`).
pub(crate) fn be32_sub(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut borrow: u8 = 0;
    for i in (0..32).rev() {
        let (d1, ov1) = a[i].overflowing_sub(b[i]);
        let (d2, ov2) = d1.overflowing_sub(borrow);
        result[i] = d2;
        borrow = (ov1 || ov2) as u8;
    }
    result
}

/// Extracts an `i128` from the low 16 bytes of a 32-byte big-endian value.
///
/// Returns `None` if the high 16 bytes are non-zero (value exceeds 2^127).
pub(crate) fn i128_from_be32_low(arr: &[u8; 32]) -> Option<i128> {
    if arr[0..16] != [0u8; 16] {
        return None;
    }
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&arr[16..32]);
    Some(i128::from_be_bytes(buf))
}
