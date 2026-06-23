use soroban_sdk::{contracttype, BytesN, Vec};

/// Which circuit's verification key to use.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CircuitId {
    Deposit,
    BorrowRepay,
    Liquidation,
}

/// A BN254 G1 affine point — 64 bytes.
///
/// Serialization (Ethereum-compatible, matching snarkjs output):
///   bytes[0..32]  = X coordinate, big-endian
///   bytes[32..64] = Y coordinate, big-endian
///
/// The point at infinity is encoded as 64 zero bytes.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct G1Point {
    pub bytes: BytesN<64>,
}

/// A BN254 G2 affine point — 128 bytes.
///
/// Serialization (Ethereum-compatible / EIP-197, matching snarkjs output):
///   bytes[0..32]   = X.c1 (imaginary part), big-endian
///   bytes[32..64]  = X.c0 (real part), big-endian
///   bytes[64..96]  = Y.c1 (imaginary part), big-endian
///   bytes[96..128] = Y.c0 (real part), big-endian
///
/// Note: c1 (imaginary) comes before c0 (real) — matches Ethereum EIP-197 / snarkjs output.
/// The point at infinity is encoded as 128 zero bytes.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct G2Point {
    pub bytes: BytesN<128>,
}

/// Groth16 verification key for one circuit.
///
/// Loaded from `snarkjs zkey export verificationkey` and stored at initialization.
/// Only the admin can set or update a verification key.
///
/// Field `ic` has `nPublic + 1` elements:
///   IC[0]     — constant term
///   IC[1..n]  — per-public-input terms (one per circuit public input)
#[contracttype]
#[derive(Clone, Debug)]
pub struct VerificationKey {
    /// α (alpha) — G1 point from the trusted setup.
    pub alpha_g1: G1Point,
    /// β (beta) — G2 point from the trusted setup.
    pub beta_g2: G2Point,
    /// γ (gamma) — G2 point from the trusted setup.
    pub gamma_g2: G2Point,
    /// δ (delta) — G2 point from the trusted setup.
    pub delta_g2: G2Point,
    /// Lagrange basis points: IC[0], IC[1], ..., IC[nPublic].
    /// Length = nPublic + 1.
    pub ic: Vec<G1Point>,
}

/// Groth16 proof — the three elliptic curve elements produced by the prover.
///
/// Encoding matches snarkjs `groth16.fullProve` output after serialisation:
///   pi_a → G1 affine (64 bytes)
///   pi_b → G2 affine (128 bytes, c1 before c0 per EIP-197)
///   pi_c → G1 affine (64 bytes)
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proof {
    pub pi_a: G1Point,
    pub pi_b: G2Point,
    pub pi_c: G1Point,
}

// Public signals are passed as Vec<BytesN<32>> directly (one 32-byte Fr element
// per public circuit input, big-endian, matching snarkjs publicSignals output).
// No type alias — use the concrete type in function signatures so the Stellar
// spec generator can produce a complete ABI.

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Admin address — the only account that can set verification keys.
    Admin,
    /// Verification key for a specific circuit.
    VerificationKey(CircuitId),
}
