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
    pub min_deposit_satoshis:     u64,
    pub min_collateral_ratio_bp:  u32,
    pub liquidation_threshold_bp: u32,
}

// ── Pool accounting ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolState {
    pub total_supplied: i128,
    pub total_borrowed: i128,
}

// ── Cross-contract mirrors ────────────────────────────────────────────────────

/// Mirrors `bitcoin_spv::VerificationResult`.
/// Field names must match exactly for XDR round-tripping through the
/// cross-contract call to work.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SpvResult {
    pub txid:          BytesN<32>,
    pub block_hash:    BytesN<32>,
    pub confirmations: u32,
}

/// BN254 G1 affine point — 64 bytes (X || Y, big-endian).
/// Mirrors `zk_verifier::G1Point`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct G1Point {
    pub bytes: BytesN<64>,
}

/// BN254 G2 affine point — 128 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
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
// The contract reads every signal — these constants are all used in lib.rs.

pub mod deposit_signals {
    /// Poseidon(collateral_satoshis, 0, secret, nonce)
    pub const COMMITMENT:       usize = 0;
    /// Poseidon(secret, nonce) — prevents replay of the same position secret.
    pub const NULLIFIER:        usize = 1;
    /// Low 128 bits of the Bitcoin txid as a BN254 field element.
    pub const BTC_TXID_LO:     usize = 2;
    /// High 128 bits of the Bitcoin txid as a BN254 field element.
    pub const BTC_TXID_HI:     usize = 3;
    /// Protocol minimum deposit in satoshis (must equal Config.min_deposit_satoshis).
    pub const MIN_DEPOSIT_SATS: usize = 4;
    pub const COUNT:            usize = 5;
}

pub mod borrow_repay_signals {
    /// Updated Merkle root after commitment swap.
    pub const NEW_ROOT:       usize = 0;
    /// Nullifier of the old commitment — spent by this operation.
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
    pub const COUNT:          usize = 8;
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
