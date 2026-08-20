# Research: Circom Circuit Design for Writz Protocol

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Writz requires three distinct ZK circuits:
1. **Deposit circuit** - prove BTC was deposited and create a private position commitment
2. **Borrow/repay circuit** - prove the state transition of a position without revealing amounts
3. **Liquidation circuit** - prove a position is undercollateralized without revealing amounts

This document designs each circuit's structure, constraints, and inputs/outputs, drawing from the Stellar Private Payments reference implementation.

---

## Chosen Stack: Circom + Groth16 + BN254

**Why Circom:**
- Most mature ZK circuit language in production (Tornado Cash, Zcash Sapling, Stellar Private Payments)
- Compiles to R1CS (Rank-1 Constraint System) - directly compatible with Groth16
- Large library of reusable components (Poseidon hash, Merkle proofs, comparators, bit decomposition)
- Browser-based proof generation via snarkjs + WebAssembly

**Why Groth16:**
- Constant-size proofs: 192 bytes regardless of circuit complexity
- Fastest verification: single bilinear pairing check
- Production-proven on Soroban via Protocol X-Ray (BN254 pairing host function)
- Stellar Private Payments uses exactly this stack - direct reference available

**Why BN254:**
- Protocol 25 added BN254 host functions specifically
- Protocol 26 added BN254 MSM and scalar arithmetic host functions
- Most Circom tooling targets BN254
- Same curve as Ethereum EIP-196/197 - large ecosystem of audited tooling

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
The SPV verification (Bitcoin Merkle proof + header chain) is done in a **separate Soroban contract**, not in this Circom circuit. SPV is verified on-chain using the Rust SPV library. The Circom circuit only handles the ZK privacy layer - creating the commitment.

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

For Groth16, ~10K constraints is a medium-sized circuit - proof generation should take under 5 seconds in WASM.

*(This section is the original Phase 0 estimate, kept for historical context. The built circuit's real count, after an `is_borrow` soundness fix added a boolean constraint and two debt-direction range checks, is ~11,180 non-linear constraints - see `docs/how-it-works/zk-privacy-layer.md` for the measured figure and `circuits/src/borrow_repay.circom` for the source of truth.)*

---

## Circuit 3: Liquidation

### Purpose
Prove that a specific position (identified by its commitment) is undercollateralized, without revealing the collateral amount or position owner, enabling a liquidator to claim the collateral.

> **Note (updated to match the shipped circuit):** the pseudocode below described an earlier design where `usdc_to_repay` was supplied as a separate **public input**, checked for equality against the private debt field. The circuit as implemented (`circuits/src/liquidation.circom`) is stronger: it has no `usdc_to_repay` input at all. `usdc_debt` is instead a circuit **output**, structurally bound to the private commitment (`usdc_debt <== debt_stroops`). This is a meaningful difference - see "Privacy tradeoff" below.

### Inputs/Outputs (as implemented)

```circom
template LiquidationCircuit(DEPTH) {
    // Private inputs
    signal input collateral_satoshis;
    signal input debt_stroops;
    signal input secret;
    signal input nonce;
    signal input path_elements[DEPTH];
    signal input path_indices[DEPTH];

    // Public inputs
    signal input merkle_root;
    signal input btc_price_stroops_per_btc;
    signal input liquidation_threshold_bp;  // 12_000 = 120%

    // Public outputs
    signal output nullifier;  // Poseidon(secret, nonce)
    signal output usdc_debt;  // bound to debt_stroops - not caller-supplied

    // Constraints

    // 1. Commitment exists in tree
    commitment <== Poseidon(4)([collateral_satoshis, debt_stroops, secret, nonce]);
    merkle_root === MerkleTreeChecker(DEPTH)(commitment, path_elements, path_indices);

    // 2. Position IS undercollateralized (cross-multiplied, no division)
    //    collateral_satoshis × price × 10_000 < debt × 100_000_000 × threshold_bp
    GreaterThan(128)(debt_stroops × 100_000_000 × liquidation_threshold_bp,
                      collateral_satoshis × btc_price_stroops_per_btc × 10_000) === 1;

    // 3. Debt output is bound to the commitment's private debt field - a
    //    keeper cannot claim an arbitrary amount while proving a different
    //    commitment.
    usdc_debt <== debt_stroops;

    // 4. Nullifier
    nullifier <== Poseidon(2)([secret, nonce]);
}
```

### Privacy tradeoff in liquidation

There's a fundamental tension in private liquidations: the liquidator (or the contract, on the liquidator's behalf) needs to know how much USDC to pay to execute the liquidation. This means the debt amount is published on-chain at liquidation time regardless of circuit design - that part of the tradeoff is inherent and cannot be engineered away while liquidation remains permissionless.

What the circuit design *can* control is whether that published amount is **trustworthy** - i.e. whether a keeper (or anyone else constructing the liquidation call) could claim a different amount than what the position actually owes. The original pseudocode above modeled `usdc_to_repay` as a public input checked for equality against the private debt - functionally adequate, but it leaves the "declare the correct amount" burden on an external equality constraint, callable with any input. **The shipped circuit removes that input entirely**: `usdc_debt` is a circuit *output*, computed as `usdc_debt <== debt_stroops` directly from the private commitment. A malicious keeper cannot supply a different value - there is no signal for them to lie in. `contracts/contracts/commitment-tree/src/lib.rs` extracts `usdc_debt` from the proof's output signal, never from a caller-supplied parameter, so this guarantee is enforced on-chain as well as in the circuit.

**Phase 1 status:** debt amount is revealed on-chain at liquidation time (unavoidable given a permissionless/keeper-based liquidator model), but the amount is provably correct - see `docs/how-it-works/zk-privacy-layer.md`.

**Phase 2 options (blocked on a decentralized keeper network):**
1. **Encrypted debt in commitment** - liquidator receives an encrypted hint containing the debt amount, decryptable only with a specific key.
2. **Committed-but-unrevealed liquidation bids** - multiple competing keepers commit to a bid without revealing it, settled without exposing the amount to losing bidders.

Neither of these has a consumer today: a hidden-bid or encrypted-hint scheme only makes sense once there are multiple competing keepers to hide the amount *from*, and that decentralized keeper network is itself Phase 2 and not yet built. Designing this crypto now, before that network exists, would be speculative work against a documented, accepted, non-blocking tradeoff - revisit once that network exists.

---

## Trusted Setup Ceremony

Groth16 requires a per-circuit trusted setup. The setup has two phases:

**Phase 1 (Powers of Tau):** A multi-party ceremony generating universal SRS (Structured Reference String) parameters. Stellar Private Payments uses the Hermez Powers of Tau ceremony - Writz can reuse this. Already done.

**Phase 2 (Circuit-specific):** A circuit-specific setup generating the proving key and verification key. This must be done separately for each of Writz's **four** circuits (the three named throughout this doc, plus `zero_debt`, which gates the cooperative Path A release endpoint and is fund-loss-equivalent in severity to the others). It is a one-time event per circuit version.

**Ceremony requirements for production:**
- Minimum 5 independent participants (more is better)
- At least one participant must be trustworthy (the setup is secure if at least one person destroys their randomness)
- Publicly verifiable transcript
- Can be done by the Writz team + community members + security researchers

This is a **pre-mainnet requirement**. The ceremony must be completed and the results audited before any mainnet deployment.

**Tooling:** the coordinator/participant scripts, transcript format, verification, and on-chain rotation runbook implementing all of the above are in `circuits/scripts/ceremony/` - see that directory's `README.md` for the exact step-by-step process. A CI job (`circuits-ceremony-verify` in `.github/workflows/ci.yml`) mechanically checks the committed manifest's hashes and rejects any transcript with a "dev"-labeled participant before a rotation is accepted; it does not replace the human verification steps in the runbook.

---

## Browser-Side Proof Generation

Proof generation runs on the client side via WebAssembly. Users generate their own ZK proofs in the browser before submitting to Soroban.

**Proof generation time benchmarks (Groth16, snarkjs in WASM):**
- Deposit circuit (~280 constraints): < 1 second
- Borrow/Repay circuit (~11,200 constraints): 3–8 seconds
- Liquidation circuit (~9,000 constraints): 2–6 seconds

This is acceptable UX for DeFi operations (users already wait for Bitcoin confirmations).

**Proof generation artifacts needed:**
- `.wasm` file (circuit compiled to WebAssembly)
- `.zkey` file (proving key from trusted setup)
- Both served from Writz frontend / CDN

---

## Key Findings

1. **Three circuits needed:** Deposit (light), Borrow/Repay (medium), Liquidation (medium)
2. **Circom + Groth16 on BN254 is the right stack** - production-proven on Stellar
3. **Merkle tree depth 20** - supports 1M positions, adds ~4,800 constraints per circuit
4. **Division in ZK is expensive** - collateral ratio checks require range proofs; benchmark carefully
5. **Trusted setup is required** - one-time ceremony per circuit; pre-mainnet mandatory item
6. **Liquidation privacy is partially limited** - debt amount revealed in Phase 1; keeper-based approach mitigates
7. **Browser-side proof generation is viable** - 3–8 second proof time is acceptable for DeFi

---

*Last updated: 2026-06-22*
*Sources: [Circom Documentation](https://docs.circom.io) · [NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments) · [ShieldLend Architecture](https://github.com/cryptosingheth/shieldlend/blob/main/docs/architecture.md) · [RareSkills: Intro to ZK Circuits with Circom](https://rareskills.io/post/circom-intro)*
