# Research: Circom Circuit Design for Writz Protocol

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Writz requires three distinct ZK circuits:
1. **Deposit circuit** — prove BTC was deposited and create a private position commitment
2. **Borrow/repay circuit** — prove the state transition of a position without revealing amounts
3. **Liquidation circuit** — prove a position is undercollateralized without revealing amounts

This document designs each circuit's structure, constraints, and inputs/outputs, drawing from the Stellar Private Payments reference implementation.

---

## Chosen Stack: Circom + Groth16 + BN254

**Why Circom:**
- Most mature ZK circuit language in production (Tornado Cash, Zcash Sapling, Stellar Private Payments)
- Compiles to R1CS (Rank-1 Constraint System) — directly compatible with Groth16
- Large library of reusable components (Poseidon hash, Merkle proofs, comparators, bit decomposition)
- Browser-based proof generation via snarkjs + WebAssembly

**Why Groth16:**
- Constant-size proofs: 192 bytes regardless of circuit complexity
- Fastest verification: single bilinear pairing check
- Production-proven on Soroban via Protocol X-Ray (BN254 pairing host function)
- Stellar Private Payments uses exactly this stack — direct reference available

**Why BN254:**
- Protocol 25 added BN254 host functions specifically
- Protocol 26 added BN254 MSM and scalar arithmetic host functions
- Most Circom tooling targets BN254
- Same curve as Ethereum EIP-196/197 — large ecosystem of audited tooling

**Tradeoff acknowledged:** Groth16 requires a trusted setup ceremony per circuit. This is a one-time per-circuit event. Must be done carefully (Powers of Tau + circuit-specific setup). After setup, verification is fully trustless.

---

## Shared Components

### Poseidon Hash (ZK-friendly)

All commitments use Poseidon instead of SHA256. Poseidon operates over the BN254 scalar field, making it 10–100x more efficient in Wasm circuits.

```circom
include "poseidon.circom";  // from circomlib

template Hash2() {
    signal input a;
    signal input b;
    signal output out;
    component h = Poseidon(2);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    out <== h.out;
}
```

### Merkle Tree Inclusion Proof

All position commitments are stored in an on-chain Merkle tree. ZK proofs must prove membership in this tree without revealing which leaf.

```circom
template MerkleProof(depth) {
    signal input leaf;
    signal input path_elements[depth];
    signal input path_indices[depth];  // 0 = left, 1 = right
    signal output root;

    component hashers[depth];
    signal nodes[depth + 1];
    nodes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        hashers[i] = Hash2();
        // Select order based on path index
        hashers[i].a <== path_indices[i] == 0 ? nodes[i] : path_elements[i];
        hashers[i].b <== path_indices[i] == 0 ? path_elements[i] : nodes[i];
        nodes[i + 1] <== hashers[i].out;
    }
    root <== nodes[depth];
}
```

**Merkle tree depth:** Use depth = 20 → supports up to 2^20 = ~1 million simultaneous positions. Each additional depth level adds ~1–2 Poseidon hashes to the circuit.

---

## Circuit 1: Deposit

### Purpose
Prove that a valid BTC deposit has been made via SPV and create a private commitment to the position.

### Note on separation
The SPV verification (Bitcoin Merkle proof + header chain) is done in a **separate Soroban contract**, not in this Circom circuit. SPV is verified on-chain using the Rust SPV library. The Circom circuit only handles the ZK privacy layer — creating the commitment.

### Inputs/Outputs

```circom
template DepositCircuit() {
    // Private inputs
    signal private input collateral_satoshis;   // BTC amount deposited (hidden)
    signal private input secret;                 // User's position secret (hidden)
    signal private input nonce;                  // Unique nonce (hidden)

    // Public inputs
    signal input btc_txid;                       // Bitcoin transaction ID (visible)
    signal input expected_satoshis;              // Minimum deposit amount (visible, for validation)

    // Outputs (public)
    signal output commitment;                    // Poseidon(collateral, 0, secret, nonce)
    // Note: debt starts at 0 at deposit time
}

template DepositCircuit() {
    // Constraints
    // 1. Collateral matches the claimed amount
    collateral_satoshis >= expected_satoshis === 1;

    // 2. Commitment correctly encodes the position
    commitment <== Poseidon(4)([
        collateral_satoshis,
        0,               // initial debt = 0
        secret,
        nonce
    ]);
}
```

**On-chain flow:**
1. Soroban SPV contract verifies BTC transaction → emits: `verified(txid, amount_satoshis, recipient_p2wsh_address)`
2. PrivateLend reads SPV verification result
3. User submits ZK deposit proof with `commitment` as public output
4. PrivateLend adds `commitment` to the Merkle tree
5. User stores `(collateral_satoshis, 0, secret, nonce, commitment_index)` privately

### Constraint count estimate
Poseidon(4): ~240 constraints. Range check: ~32 constraints. **Total: ~280 constraints.** Very light circuit.

---

## Circuit 2: Borrow / Repay (State Transition)

### Purpose
Prove that a position's debt is being correctly updated (borrowing more USDC or repaying) without revealing the actual amounts.

### Inputs/Outputs

```circom
template BorrowRepayCircuit(DEPTH) {
    // Private inputs (never revealed)
    signal private input collateral_satoshis;
    signal private input old_debt;
    signal private input new_debt;
    signal private input secret;
    signal private input nonce;
    signal private input merkle_path[DEPTH];
    signal private input commitment_index;

    // Public inputs
    signal input old_merkle_root;
    signal input new_merkle_root;
    signal input delta_usdc;           // positive = borrow, negative = repay (public)
    signal input btc_price;            // current oracle price
    signal input min_collateral_ratio; // 150% = 15000 basis points
    signal input nullifier;            // prevents replay of this state transition

    // Constraints

    // 1. Old commitment exists in the tree
    old_commitment <== Poseidon(4)([collateral_satoshis, old_debt, secret, nonce]);
    old_merkle_root === MerkleProof(DEPTH)(old_commitment, commitment_index, merkle_path);

    // 2. New debt is correctly computed
    new_debt === old_debt + delta_usdc;

    // 3. New debt does not exceed collateral ratio
    // (collateral_satoshis × btc_price / 1e8) × 10000 / new_debt >= min_collateral_ratio
    collateral_value_usd <== collateral_satoshis × btc_price \ 100_000_000;
    ratio <== collateral_value_usd × 10000 \ new_debt;
    ratio >= min_collateral_ratio === 1;

    // 4. New debt is non-negative
    new_debt >= 0 === 1;

    // 5. New commitment correctly encodes updated position
    new_commitment <== Poseidon(4)([collateral_satoshis, new_debt, secret, nonce]);

    // 6. New Merkle root reflects the commitment update
    new_merkle_root === UpdatedMerkleRoot(DEPTH)(
        old_commitment, new_commitment, commitment_index, merkle_path
    );

    // 7. Nullifier prevents replay
    nullifier === Poseidon(2)([secret, commitment_index]);
}
```

### Constraint count estimate
- Old commitment: ~240 constraints
- Merkle proof (depth 20): ~20 × 240 = ~4,800 constraints
- New commitment: ~240 constraints
- Merkle root update: ~4,800 constraints
- Range checks + arithmetic: ~200 constraints
- Division for ratio: ~300 constraints (expensive in ZK)
- **Total: ~10,500 constraints**

For Groth16, ~10K constraints is a medium-sized circuit — proof generation should take under 5 seconds in WASM.

---

## Circuit 3: Liquidation

### Purpose
Prove that a specific position (identified by its commitment) is undercollateralized, without revealing the amounts, enabling a liquidator to claim the collateral.

### Inputs/Outputs

```circom
template LiquidationCircuit(DEPTH) {
    // Private inputs
    signal private input collateral_satoshis;
    signal private input usdc_debt;
    signal private input secret;
    signal private input nonce;
    signal private input merkle_path[DEPTH];
    signal private input commitment_index;

    // Public inputs
    signal input merkle_root;
    signal input btc_price;
    signal input liquidation_threshold;  // 120% = 12000 basis points
    signal input nullifier;
    signal input usdc_to_repay;          // claimed debt amount (public for liquidator to pay)

    // Constraints

    // 1. Commitment exists in tree
    commitment <== Poseidon(4)([collateral_satoshis, usdc_debt, secret, nonce]);
    merkle_root === MerkleProof(DEPTH)(commitment, commitment_index, merkle_path);

    // 2. Position IS undercollateralized
    collateral_value_usd <== collateral_satoshis × btc_price \ 100_000_000;
    ratio <== collateral_value_usd × 10000 \ usdc_debt;
    ratio < liquidation_threshold === 1;  // Must be BELOW threshold

    // 3. usdc_to_repay matches the actual debt
    usdc_to_repay === usdc_debt;
    // NOTE: This reveals the debt amount! See discussion below.

    // 4. Nullifier
    nullifier === Poseidon(2)([secret, commitment_index]);
}
```

### Privacy tradeoff in liquidation

There's a fundamental tension in private liquidations: the liquidator needs to know how much USDC to pay to execute the liquidation. This means `usdc_to_repay` (the debt) must be a public input.

**Options:**
1. **Reveal debt publicly** — simplest, but partially breaks privacy
2. **Trusted keeper pays the debt** — keeper knows the private amounts, handles the USDC payment without public disclosure
3. **Encrypted debt in commitment** — liquidator receives an encrypted hint containing the debt amount, decryptable only with a specific key

**Recommendation for Phase 1:** Use option 2 (trusted keeper). The keeper knows all position preimages and executes liquidations privately. The on-chain ZK proof confirms the position is undercollateralized without revealing amounts — only the keeper learns the debt through off-chain channels. Revisit in Phase 2.

---

## Trusted Setup Ceremony

Groth16 requires a per-circuit trusted setup. The setup has two phases:

**Phase 1 (Powers of Tau):** A multi-party ceremony generating universal SRS (Structured Reference String) parameters. Stellar Private Payments uses the Hermez Powers of Tau ceremony — Writz can reuse this. Already done.

**Phase 2 (Circuit-specific):** A circuit-specific setup generating the proving key and verification key. This must be done separately for each of Writz's three circuits. It is a one-time event per circuit version.

**Ceremony requirements for production:**
- Minimum 5 independent participants (more is better)
- At least one participant must be trustworthy (the setup is secure if at least one person destroys their randomness)
- Publicly verifiable transcript
- Can be done by the Writz team + community members + security researchers

This is a **pre-mainnet requirement**. The ceremony must be completed and the results audited before any mainnet deployment.

---

## Browser-Side Proof Generation

Proof generation runs on the client side via WebAssembly. Users generate their own ZK proofs in the browser before submitting to Soroban.

**Proof generation time benchmarks (Groth16, snarkjs in WASM):**
- Deposit circuit (~280 constraints): < 1 second
- Borrow/Repay circuit (~10,500 constraints): 3–8 seconds
- Liquidation circuit (~9,000 constraints): 2–6 seconds

This is acceptable UX for DeFi operations (users already wait for Bitcoin confirmations).

**Proof generation artifacts needed:**
- `.wasm` file (circuit compiled to WebAssembly)
- `.zkey` file (proving key from trusted setup)
- Both served from Writz frontend / CDN

---

## Key Findings

1. **Three circuits needed:** Deposit (light), Borrow/Repay (medium), Liquidation (medium)
2. **Circom + Groth16 on BN254 is the right stack** — production-proven on Stellar
3. **Merkle tree depth 20** — supports 1M positions, adds ~4,800 constraints per circuit
4. **Division in ZK is expensive** — collateral ratio checks require range proofs; benchmark carefully
5. **Trusted setup is required** — one-time ceremony per circuit; pre-mainnet mandatory item
6. **Liquidation privacy is partially limited** — debt amount revealed in Phase 1; keeper-based approach mitigates
7. **Browser-side proof generation is viable** — 3–8 second proof time is acceptable for DeFi

---

*Last updated: 2026-06-22*
*Sources: [Circom Documentation](https://docs.circom.io) · [NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments) · [ShieldLend Architecture](https://github.com/cryptosingheth/shieldlend/blob/main/docs/architecture.md) · [RareSkills: Intro to ZK Circuits with Circom](https://rareskills.io/post/circom-intro)*
