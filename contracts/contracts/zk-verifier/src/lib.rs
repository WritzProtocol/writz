#![no_std]

mod types;
#[cfg(test)]
mod test;

pub use types::{CircuitId, G1Point, G2Point, Proof, VerificationKey};

use soroban_sdk::{
    contract, contractimpl, contracterror, crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Address, BytesN, Env, Vec, U256,
};
use types::DataKey;

/// Convenience alias used only within this crate.
type PublicSignals = Vec<BytesN<32>>;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ZkVerifierError {
    AlreadyInitialized      = 1,
    NotInitialized          = 2,
    Unauthorized            = 3,
    VerificationKeyNotSet   = 4,
    /// Number of public signals doesn't match the verification key's IC length.
    PublicInputCountMismatch = 5,
    /// Proof verification failed — the proof is invalid.
    InvalidProof            = 6,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ZkVerifierContract;

#[contractimpl]
impl ZkVerifierContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time setup: record the admin address.
    /// The admin is the only account that can call `set_verification_key`.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ZkVerifierError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ZkVerifierError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    // ── Verification key management ───────────────────────────────────────────

    /// Store or replace the verification key for a circuit.
    ///
    /// Called once after the trusted setup ceremony for each circuit.
    /// The verification key is derived from the snarkjs `.zkey` file via
    /// `snarkjs zkey export verificationkey`.
    pub fn set_verification_key(
        env: Env,
        caller: Address,
        circuit: CircuitId,
        vk: VerificationKey,
    ) -> Result<(), ZkVerifierError> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ZkVerifierError::NotInitialized)?;
        if caller != admin {
            return Err(ZkVerifierError::Unauthorized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::VerificationKey(circuit), &vk);
        Ok(())
    }

    /// Returns the stored verification key for a circuit, or None.
    pub fn get_verification_key(
        env: Env,
        circuit: CircuitId,
    ) -> Option<VerificationKey> {
        env.storage()
            .persistent()
            .get(&DataKey::VerificationKey(circuit))
    }

    // ── Proof verification ────────────────────────────────────────────────────

    /// Verify a Groth16 proof for the deposit circuit.
    ///
    /// Public signals (in order, matching the circuit's public input declaration):
    ///   [0] commitment        — Poseidon position commitment
    ///   [1] nullifier         — Poseidon(secret, nonce)
    ///   [2] btc_txid_lo       — low 128 bits of Bitcoin txid
    ///   [3] btc_txid_hi       — high 128 bits of Bitcoin txid
    ///   [4] min_deposit_sats  — minimum deposit threshold
    pub fn verify_deposit(
        env: Env,
        proof: Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> Result<bool, ZkVerifierError> {
        Self::verify_for_circuit(&env, CircuitId::Deposit, proof, public_signals)
    }

    /// Verify a Groth16 proof for the borrow/repay circuit.
    ///
    /// Public signals (in order):
    ///   [0] new_root                  — updated Merkle root
    ///   [1] old_nullifier             — nullifier for the old commitment
    ///   [2] new_commitment            — new position commitment
    ///   [3] old_root                  — previous Merkle root (must match on-chain state)
    ///   [4] delta_stroops             — USDC amount borrowed (positive) or repaid (negative)
    ///   [5] is_borrow                 — 1 = borrow, 0 = repay
    ///   [6] btc_price_stroops_per_btc — oracle price used for ratio check
    ///   [7] min_ratio_bp              — minimum collateral ratio (15_000 = 150%)
    pub fn verify_borrow_repay(
        env: Env,
        proof: Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> Result<bool, ZkVerifierError> {
        Self::verify_for_circuit(&env, CircuitId::BorrowRepay, proof, public_signals)
    }

    /// Verify a Groth16 proof for the liquidation circuit.
    ///
    /// Public signals (in order):
    ///   [0] nullifier                 — marks this position as liquidated
    ///   [1] merkle_root               — Merkle root (must match on-chain state)
    ///   [2] btc_price_stroops_per_btc — oracle price used for ratio check
    ///   [3] liquidation_threshold_bp  — liquidation threshold (12_000 = 120%)
    pub fn verify_liquidation(
        env: Env,
        proof: Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> Result<bool, ZkVerifierError> {
        Self::verify_for_circuit(&env, CircuitId::Liquidation, proof, public_signals)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn verify_for_circuit(
        env: &Env,
        circuit: CircuitId,
        proof: Proof,
        public_signals: PublicSignals,
    ) -> Result<bool, ZkVerifierError> {
        let vk: VerificationKey = env
            .storage()
            .persistent()
            .get(&DataKey::VerificationKey(circuit))
            .ok_or(ZkVerifierError::VerificationKeyNotSet)?;

        // IC has nPublic + 1 elements; public_signals must have exactly nPublic.
        if public_signals.len() + 1 != vk.ic.len() {
            return Err(ZkVerifierError::PublicInputCountMismatch);
        }

        Ok(verify_groth16(env, &vk, &proof, &public_signals))
    }
}

// ── Core Groth16 verification ─────────────────────────────────────────────────

/// Verifies a Groth16 proof against a verification key and public signals.
///
/// Algorithm:
///   1. vk_x = IC[0] + Σᵢ (public_signals[i] · IC[i+1])   [using g1_msm]
///   2. Check: e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1   [pairing_check]
///
/// The pairing_check host function returns true when the product of all
/// pairings equals 1 in the target group GT — this is the multi-pairing
/// form of the Groth16 verification equation.
fn verify_groth16(
    env: &Env,
    vk: &VerificationKey,
    proof: &Proof,
    public_signals: &PublicSignals,
) -> bool {
    let bn254 = env.crypto().bn254();

    // ── Step 1: Compute vk_x via MSM ─────────────────────────────────────────
    // vk_x = IC[0]*1 + IC[1]*x[0] + IC[2]*x[1] + ...
    //
    // g1_msm is the Protocol 26 host function that computes
    // Σᵢ (scalars[i] · points[i]) efficiently in a single host call.

    let n = public_signals.len();
    let mut msm_points: Vec<Bn254G1Affine> = Vec::new(env);
    let mut msm_scalars: Vec<Bn254Fr> = Vec::new(env);

    // IC[0] with scalar 1 (the constant term)
    msm_points.push_back(g1_from_point(env, &vk.ic.get(0).unwrap_optimized()));
    msm_scalars.push_back(Bn254Fr::from_u256(U256::from_u32(env, 1)));

    // IC[i+1] with scalar public_signals[i]
    for i in 0..n {
        msm_points.push_back(g1_from_point(env, &vk.ic.get(i + 1).unwrap_optimized()));
        let scalar_bytes = public_signals.get(i).unwrap_optimized();
        let scalar = Bn254Fr::from_bytes(scalar_bytes);
        msm_scalars.push_back(scalar);
    }

    let vk_x = bn254.g1_msm(msm_points, msm_scalars);

    // ── Step 2: Multi-pairing check ───────────────────────────────────────────
    // We check: e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
    //
    // Negating A (the G1 proof element) inverts its contribution:
    // e(-A, B) = e(A, B)⁻¹, so multiplying both sides by e(A, B) gives
    // the standard form: e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)

    let neg_pi_a = -(g1_from_point(env, &proof.pi_a));

    let g1_points: Vec<Bn254G1Affine> = Vec::from_array(env, [
        neg_pi_a,
        g1_from_point(env, &vk.alpha_g1),
        vk_x,
        g1_from_point(env, &proof.pi_c),
    ]);

    let g2_points: Vec<Bn254G2Affine> = Vec::from_array(env, [
        g2_from_point(env, &proof.pi_b),
        g2_from_point(env, &vk.beta_g2),
        g2_from_point(env, &vk.gamma_g2),
        g2_from_point(env, &vk.delta_g2),
    ]);

    bn254.pairing_check(g1_points, g2_points)
}

// ── Conversion helpers ────────────────────────────────────────────────────────

fn g1_from_point(env: &Env, p: &G1Point) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &p.bytes.to_array()))
}

fn g2_from_point(env: &Env, p: &G2Point) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, &p.bytes.to_array()))
}

// Re-export for use in other crates (e.g. PrivateLend cross-contract call).
pub use soroban_sdk::unwrap::UnwrapOptimized;
