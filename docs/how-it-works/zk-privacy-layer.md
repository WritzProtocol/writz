# The ZK Privacy Layer

**How your position stays hidden — even from the protocol.**

Zero-knowledge proofs are the electric fence around the Writz house. They allow the protocol to verify facts about your position — that your loan is adequately collateralized, that you actually made the deposit you claim, that your repayment amount is correct — without ever learning the underlying numbers.

This page explains how the ZK layer works, what it hides, and what the cryptographic guarantees are.

---

## Zero-Knowledge Proofs in Plain English

A zero-knowledge proof lets you prove something is true without revealing anything else.

The classic analogy: imagine you want to prove to someone that you know the solution to a Sudoku puzzle, without revealing the solution. A ZK proof is a mathematical protocol that makes this possible — you can demonstrate you know the answer, and the verifier becomes convinced, without ever seeing the answer.

In Writz, the "fact" being proved is: *"I have a deposit commitment in this Merkle tree, my loan amount is X% or less of my collateral value, and I have the secret that unlocks this commitment."*

The ZK proof convinces the Soroban contract that all of this is true — without the contract ever learning the deposit amount, the loan amount, or anything else about the position.

---

## What Is Hidden, What Is Visible

| Information | Visibility |
|---|---|
| That a commitment exists in the tree | Public (commitment hash stored on-chain) |
| The collateral amount | **Private — never on-chain** |
| The loan amount | **Private — never on-chain** |
| The health factor | **Private — never on-chain** |
| The user's public key linked to a position | **Private** |
| That a liquidation occurred | Public (event emitted) |
| Who was liquidated or for how much | **Private** |
| Total TVL (aggregate) | Public |
| Total USDC outstanding (aggregate) | Public |

The protocol sees only commitments and nullifiers — opaque hashes that prove actions occurred without revealing the substance of those actions.

---

## The Commitment Scheme

At the heart of the ZK layer is a **commitment**. A commitment is a hash of private data:

```
commitment = Poseidon(amount, secret, nonce)
```

Where:
- `amount` is the BTC deposit amount in satoshis (private)
- `secret` is a random number only the user knows (private)
- `nonce` is a unique value preventing commitment reuse (private)

**Poseidon** is a ZK-friendly hash function — designed specifically to be efficient inside ZK circuits. It is collision-resistant and hiding: given only the commitment, computing the preimage (amount, secret, nonce) is computationally infeasible.

The commitment is stored on-chain in a Merkle tree. The preimage stays with the user.

---

## The Nullifier

When a commitment is "consumed" (used in a borrow, repay, or withdraw), a **nullifier** is published:

```
nullifier = Poseidon(secret, nonce)
```

The nullifier is stored on-chain in a spent-nullifier set. It proves this commitment has been used — preventing double-spending — without revealing which commitment it corresponds to or what amount it represents.

This is the same technique used by Tornado Cash, Aztec Network, and other ZK privacy protocols: the nullifier is the receipt that something happened, but it is unlinkable to the original commitment without the private `secret`.

---

## The Three ZK Circuits

Writz uses three Circom circuits, each compiled to a Groth16 proof system over the BN254 curve.

### 1. Deposit Circuit

**What it proves:** "I know (amount, secret, nonce) such that `commitment = Poseidon(amount, secret, nonce)` AND the transaction ID from SPV verification matches my claimed deposit."

**Public inputs:**
- The commitment hash (stored on-chain)
- The `txid` returned by the SPV contract (binding the ZK proof to a specific Bitcoin transaction)

**Private inputs:**
- Amount (satoshis)
- Secret
- Nonce

**Constraint count:** ~597 non-linear + 714 linear constraints

**Why the txid binding matters:** Without this binding, a malicious user could submit a ZK deposit proof that references a Bitcoin transaction that doesn't actually exist. The txid binding ensures that every ZK commitment corresponds to a real, SPV-verified Bitcoin deposit.

---

### 2. Borrow/Repay Circuit

**What it proves for borrow:** "I know the preimage of a commitment in the Merkle tree, the Oracle price P, and a loan amount L such that: `L / (amount × P) ≤ 1/min_ratio` (the loan is within the allowed LTV)."

**What it proves for repay:** "I know the preimage of a commitment in the Merkle tree, and the repay amount correctly reduces the outstanding debt."

**Public inputs:**
- The Merkle root (current state of the commitment tree)
- The oracle price
- The minimum collateral ratio (150%)
- A nullifier for the old state
- A new commitment for the updated state (after borrow or repay)

**Private inputs:**
- Amount, secret, nonce (commitment preimage)
- Current debt
- Delta (borrow or repay amount)
- Merkle path (proof of membership in the tree)

**Constraint count:** ~10,935 non-linear + 12,114 linear constraints

**Key design decision — no division in ZK circuits:** Division is expensive in ZK (requires a range proof for the denominator). The collateral ratio check is implemented as a multiplication: `loan_amount × min_ratio_bp ≤ collateral_amount × price × 10000`. This avoids division entirely.

**Field negation for repay:** The repay amount is encoded as a field element negation — `p − delta_stroops` where `p` is the BN254 field prime. The circuit recovers the repay amount correctly. This was verified on-chain.

---

### 3. Liquidation Circuit

**What it proves:** "I know the preimage of a commitment in the Merkle tree, and the position's current health ratio is below 120% at the current oracle price."

**Public inputs:**
- The Merkle root
- The oracle price
- The usdc_debt (the debt amount — extracted from the proof so the liquidator cannot inflate it)
- The liquidation threshold (120%)

**Private inputs:**
- Amount, secret, nonce (commitment preimage)
- Current debt
- Merkle path

**Constraint count:** ~5,594 non-linear + ~6,196 linear constraints

**Critical security property — `usdc_debt` binding:** The liquidation circuit's `usdc_debt` public output is computed inside the circuit from the private `debt_stroops` field. The liquidator cannot supply an arbitrary debt amount — it is derived from the private commitment and constrained by the circuit. This prevents a malicious keeper from claiming a larger debt than actually exists.

---

## Groth16 and Protocol X-Ray

All three circuits use **Groth16** — the most widely deployed ZK proof system, used by Zcash, Tornado Cash, and Stellar's own Private Payments reference implementation.

A Groth16 proof is a small constant-size object (3 elliptic curve points, ~128 bytes on BN254) that can be verified in constant time — regardless of the size of the computation being proven.

Verification uses **BN254 pairing checks**: elliptic curve operations that confirm the relationship between the proof and the verification key. These are computationally expensive but deterministic.

Stellar's **Protocol X-Ray** (Protocol 26) added native host functions for BN254 operations:
- `bn254_g1_msm` — multi-scalar multiplication on the G1 curve
- `bn254_pairing_check` — pairing check across multiple pairs

The `zk-verifier` contract uses these host functions to run the Groth16 verification:
```
verify = e(A, B) == e(vk.alpha, vk.beta) × e(vk_x, vk.gamma) × e(C, vk.delta)
```

This is a 4-pair pairing check. Using Protocol 26 host functions, it costs approximately 15–20M instructions — within budget for a Soroban transaction.

---

## The Merkle Commitment Tree

All commitments are stored in a Poseidon Merkle tree with depth 20 — supporting up to 1,048,576 (2²⁰) positions.

The tree root is stored on-chain. When a new commitment is inserted, the root is updated. Every ZK proof that references the tree must match the current root — ensuring ZK proofs are valid only against the current state of the protocol.

**Sparse tree:** The tree uses a sparse representation. Only occupied leaves require storage. Empty subtrees are represented by a precomputed empty-subtree hash.

**On-chain initial root:** `0x2134e76ac74b4b8765b6e37992aa15f06ff... ` (Poseidon-2 empty tree root — verified on-chain on Soroban testnet)

---

## The Trusted Setup Ceremony

Groth16 requires a one-time **trusted setup ceremony** — a multi-party computation event that generates the proving and verification keys for each circuit.

The ceremony has two phases:
1. **Powers of Tau (Phase 1):** A universal setup shared across all circuits. Writz will use the Hermez ceremony artifact (the same trusted setup used by Stellar's own Private Payments reference implementation).
2. **Phase 2 (circuit-specific):** A separate ceremony for each of Writz's three circuits, incorporating the circuit-specific parameters.

The ceremony requires multiple independent participants. The security guarantee is: as long as at least one participant honestly discards their randomness, the setup is sound. A ceremony with 5+ parties from different organizations and jurisdictions provides strong security.

The ceremony transcript is published publicly. Anyone can verify it was executed correctly.

**When:** The trusted setup ceremony is planned for Q3–Q4 2026, before mainnet launch. The current development keys (`pot15` from snarkjs) are used for testing only — they are NOT suitable for production.

---

## What Gets Stored On-Chain

The ZK layer is designed to minimize on-chain storage while preventing double-spending and enabling verifiable state.

| Data | Storage type | Lifetime |
|---|---|---|
| Commitment (leaf hash) | Per-entry persistent | 180-day window (refreshable) |
| Nullifier (spent marker) | Per-entry persistent | 180-day window (refreshable) |
| Merkle root | Instance persistent | 180-day window (refreshable) |
| Verification keys | Instance persistent | Permanent |

**TTL management:** Soroban's storage has a time-to-live (TTL) system. Entries that are not accessed expire. Writz provides permissionless `refresh_*` functions that any keeper can call to extend the TTL of critical entries — ensuring user positions never expire unexpectedly.

---

**Next:** [The Stellar Side →](stellar-side.md)
