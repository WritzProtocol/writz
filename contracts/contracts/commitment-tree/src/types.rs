use soroban_sdk::{contracttype, Address, BytesN};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Singleton: protocol configuration (set once at initialization).
    Config,
    /// Singleton: aggregate USDC pool state.
    Pool,
    /// The current Poseidon Merkle root of the position commitment tree.
    MerkleRoot,
    /// Marks a nullifier as spent.  Entry existence means "spent".
    SpentNullifier(BytesN<32>),
    /// Commitment pending Merkle tree insertion by the relayer.
    /// Set by `deposit`, cleared by `insert_commitment`.
    PendingCommitment(BytesN<32>),
    /// Maps a Bitcoin txid to its deposit commitment.
    TxCommitment(BytesN<32>),
    /// Per-lender USDC supply balance in stroops.
    SupplyBalance(Address),
    /// Singleton: index of the next empty Merkle leaf. Every insertion proof
    /// must target exactly this leaf (#211).
    NextLeafIndex,
}

// ── Protocol config ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    pub admin:                    Address,
    pub spv_contract:             Address,
    pub zk_verifier:              Address,
    pub usdc_token:               Address,
    pub oracle:                   Address,
    pub min_confirmations:        u32,
    /// The protocol's 33-byte compressed Bitcoin co-signing key. Every ZK
    /// deposit must pay the Writz P2WSH built from this key, the depositor's
    /// own key and a bounded timelock - the same script `private-lend`
    /// checks, so the depositor keeps a unilateral timelock exit and the
    /// protocol can only ever co-sign. Immutable per contract; rotating it
    /// means a new deployment (#177).
    pub protocol_pubkey:          BytesN<33>,
    pub min_deposit_satoshis:     u64,
    pub min_collateral_ratio_bp:  u32,
    pub liquidation_threshold_bp: u32,
    /// Ceiling on `PoolState::total_borrowed`, in USDC stroops. A ZK
    /// borrower can reclaim their BTC through the timelock exit while still
    /// owing USDC, and the protocol cannot seize it, so total exposure is
    /// capped the same way as `private-lend` (GHSA-5rxp). Admin-set via
    /// `set_max_total_borrowed`.
    pub max_total_borrowed:       i128,
    /// When true, `deposit`/`borrow`/`supply_usdc` (new risk-taking actions)
    /// are refused. `repay`/`withdraw_supply`/`liquidate` stay open so users
    /// can always exit - a pause is an emergency brake on new exposure, not
    /// a freeze on existing positions. Admin-gated via `set_paused`. See
    /// `docs/architecture/contract-migration-runbook.md`, Track 2.
    pub paused: bool,
}

// ── Pool accounting ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolState {
    pub total_supplied: i128,
    pub total_borrowed: i128,
}

// ── Cross-contract mirrors ────────────────────────────────────────────────────

/// BN254 G1 affine point - 64 bytes (X || Y, big-endian).
/// Mirrors `zk_verifier::G1Point`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct G1Point {
    pub bytes: BytesN<64>,
}

/// BN254 G2 affine point - 128 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
/// Mirrors `zk_verifier::G2Point`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct G2Point {
    pub bytes: BytesN<128>,
}

/// Groth16 proof.  Mirrors `zk_verifier::Proof`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proof {
    pub pi_a: G1Point,
    pub pi_b: G2Point,
    pub pi_c: G1Point,
}

// ── Public signal indices ─────────────────────────────────────────────────────
//
// These match the public input declaration order in each circom circuit.
// The contract reads every signal - these constants are all used in lib.rs.

/// Public signals of the insert circuit (`circuits/src/insert.circom`).
pub mod insert_signals {
    /// Root after the insertion.
    pub const NEW_ROOT:   usize = 0;
    /// Root before the insertion; must equal the stored root.
    pub const OLD_ROOT:   usize = 1;
    /// The leaf written into the empty slot; must be a pending deposit.
    pub const COMMITMENT: usize = 2;
    /// The slot written; must equal `DataKey::NextLeafIndex`.
    pub const LEAF_INDEX: usize = 3;
    pub const COUNT:      usize = 4;
}

pub mod deposit_signals {
    /// Poseidon(collateral_satoshis, 0, secret, nonce)
    pub const COMMITMENT:       usize = 0;
    /// Poseidon(secret, nonce) - prevents replay of the same position secret.
    pub const NULLIFIER:        usize = 1;
    /// Low 128 bits of the Bitcoin txid as a BN254 field element.
    pub const BTC_TXID_LO:     usize = 2;
    /// High 128 bits of the Bitcoin txid as a BN254 field element.
    pub const BTC_TXID_HI:     usize = 3;
    /// Protocol minimum deposit in satoshis (must equal Config.min_deposit_satoshis).
    pub const MIN_DEPOSIT_SATS: usize = 4;
    /// The real BTC amount paid to the depositor's Writz P2WSH, parsed
    /// on-chain from `raw_tx` - `collateral_satoshis === actual_satoshis` is
    /// enforced inside the circuit (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6,
    /// GHSA-mg4x-cr23-4x3v), so the contract only has to check this against
    /// its own independently-parsed amount, not against the private witness.
    pub const ACTUAL_SATOSHIS:  usize = 5;
    pub const COUNT:            usize = 6;
}

pub mod borrow_repay_signals {
    /// Updated Merkle root after commitment swap.
    pub const NEW_ROOT:       usize = 0;
    /// Nullifier of the old commitment - spent by this operation.
    pub const OLD_NULLIFIER:  usize = 1;
    /// New commitment (updated debt + new nonce).
    pub const NEW_COMMITMENT: usize = 2;
    /// Previous Merkle root (must equal the stored root).
    pub const OLD_ROOT:       usize = 3;
    /// USDC delta: positive for borrow, negative (p − amount) for repay.
    pub const DELTA_STROOPS:  usize = 4;
    /// 1 = borrow, 0 = repay.
    pub const IS_BORROW:      usize = 5;
    /// BTC/USD price in USDC stroops per BTC (must match oracle).
    pub const BTC_PRICE:      usize = 6;
    /// Minimum collateral ratio in bp (must equal Config.min_collateral_ratio_bp).
    pub const MIN_RATIO_BP:   usize = 7;
    /// Low 128 bits of sha256(recipient's Stellar strkey address). Checked
    /// against the authenticated `borrower` in `borrow()` only - `repay()`
    /// pulls funds FROM the caller so has no arbitrary-recipient risk
    /// (GHSA-xxqv-6vhx-hhrx, GHSA-mhp9-jmvc-x9mw).
    pub const RECIPIENT_LO:   usize = 8;
    /// High 128 bits of sha256(recipient's Stellar strkey address).
    pub const RECIPIENT_HI:   usize = 9;
    pub const COUNT:          usize = 10;
}

pub mod liquidation_signals {
    /// Nullifier of the position being liquidated (circuit output, index 0).
    pub const NULLIFIER:             usize = 0;
    /// Outstanding USDC debt proven inside the commitment (circuit output, index 1).
    /// The circuit constrains usdc_debt == debt_stroops so the contract can trust
    /// this value matches the private debt field that was hashed into the commitment.
    pub const USDC_DEBT:             usize = 1;
    /// Merkle root at proof time (must equal the stored root).
    pub const MERKLE_ROOT:           usize = 2;
    /// BTC/USD price in USDC stroops per BTC (must match oracle).
    pub const BTC_PRICE:             usize = 3;
    /// Liquidation threshold in bp (must equal Config.liquidation_threshold_bp).
    pub const LIQUIDATION_THRESHOLD: usize = 4;
    pub const COUNT:                 usize = 5;
}
