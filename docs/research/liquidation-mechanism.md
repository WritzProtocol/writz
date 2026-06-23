# Research: Liquidation Mechanism Design

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Liquidations are the safety mechanism that keeps PrivateLend solvent. When a user's BTC collateral drops in value and their loan becomes undercollateralized, a liquidation must occur quickly to protect the USDC lenders.

The challenge for Writz: **how do you liquidate a private position?** The collateral amount and debt are hidden by ZK proofs. Liquidators can't see who is undercollateralized.

This document designs the full liquidation system, including the novel ZK-private liquidation mechanism.

---

## Standard DeFi Liquidation (Public Protocols)

In Aave, Compound, and Blend, liquidation works as follows:

1. Any position is publicly visible: collateral amount, debt, health factor
2. When health factor < 1.0, anyone can call `liquidate(position_id)`
3. The liquidator pays some or all of the debt in USDC
4. The liquidator receives the BTC collateral at a discount (liquidation bonus)
5. The position is closed or partially reduced

**Why this is easy in public DeFi:** Every bot can scan every position continuously. When a position becomes liquidatable, multiple liquidators compete (race condition), ensuring rapid liquidation.

**Why this breaks for Writz:** Position data is hidden. Liquidators cannot scan positions.

---

## The Private Liquidation Problem

Writz stores positions as ZK commitments:

```
commitment = Poseidon(collateral_satoshis, usdc_debt, secret, nonce)
```

On-chain, only the commitment hash is stored — not the collateral or debt amounts. A liquidation bot cannot determine which positions are undercollateralized by reading the chain.

### Solutions

#### Option A: Privileged Keeper (Operator)
A trusted Writz operator holds the decryption keys for all positions and monitors them privately. When a position becomes liquidatable, the keeper generates a ZK proof and initiates liquidation.

**Pros:** Simplest to implement. Users trust the protocol operator.
**Cons:** Centralization. If the keeper is offline, positions go unliquidated. If the keeper is malicious, they can selectively trigger or delay liquidations.

**Verdict:** Acceptable for Phase 1 (alongside a timelock-based safety mechanism), but must be decentralized by Phase 2.

#### Option B: User Self-Reporting
When a position becomes liquidatable, the protocol emits no signal. Users must periodically submit ZK proofs proving their position is healthy. If a user fails to prove health within a window, the position is assumed liquidatable.

**Pros:** Fully decentralized. No trusted party needed.
**Cons:** Terrible UX. Users must monitor and act regularly or lose their collateral. Not viable for mainstream adoption.

**Verdict:** Not recommended.

#### Option C: ZK Proof of Undercollateralization (Recommended for Phase 2)
A keeper (or any party with position knowledge) generates a ZK proof that a specific position is below the liquidation threshold — **without revealing the actual collateral amount or debt**.

**ZK proof statement:**
```
I know (commitment_preimage = {collateral, debt, secret, nonce}) such that:
  1. Poseidon(collateral, debt, secret, nonce) = commitment  [valid commitment]
  2. commitment is in the current Merkle tree  [position exists]
  3. BTC_price × collateral / debt < liquidation_threshold  [undercollateralized]
  4. nullifier = Poseidon(secret, commitment_index)  [unique, prevents replay]
```

The verifier (Soroban contract) checks the ZK proof using the current oracle price. If valid, it triggers the liquidation of the commitment — releasing the BTC co-sign to the liquidator and burning the USDC debt — without ever revealing the collateral amount or who the position belongs to.

**Pros:** Decentralized and privacy-preserving. Any party can liquidate if they can prove undercollateralization.
**Cons:** The prover must know the position's preimage. This requires the keeper (or the user) to share the position details. In practice, the Writz keeper tracks all positions in encrypted off-chain storage.

---

## Recommended Liquidation Architecture

### Phase 1: Keeper + Emergency Timelock

```
Writz Keeper (off-chain)
├── Stores all position preimages in encrypted database
├── Monitors BTC/USD price continuously
├── When BTC price × collateral / debt < 120%:
│   1. Generates ZK proof of undercollateralization
│   2. Calls PrivateLend.liquidate(zk_proof, liquidator_address)
│   3. Protocol verifies ZK proof on-chain
│   4. Protocol co-signs BTC release to liquidator
│   5. USDC debt is burned
└── Emergency fallback: if keeper offline >24 hours, positions can be liquidated
    by anyone with a valid ZK proof (open liquidation with proof submission)
```

**Emergency fallback mechanism:** The Soroban contract has a `liquidation_open_after_block` parameter. If a position's last health check is older than X blocks (e.g., 1440 blocks = ~2 hours), liquidation becomes open to anyone who can submit a valid ZK proof. This prevents positions from going unliquidated if the keeper is down.

### Phase 2: Decentralized Keeper Network

Multiple keeper nodes compete to submit liquidation proofs. The first valid proof wins. Keepers are incentivized by the liquidation bonus. A stake/bond mechanism ensures keepers don't collude to delay liquidations.

---

## Liquidation Parameters

### Collateralization ratios

| Parameter | Value | Rationale |
|---|---|---|
| **Minimum collateral ratio** | 150% | User can borrow up to 66.7% of BTC value in USDC |
| **Liquidation threshold** | 120% | Position liquidated if BTC value drops to 1.2× the debt |
| **Liquidation buffer** | 30% | Distance from min ratio to liquidation: safety margin for BTC volatility |
| **Liquidation bonus** | 10% | Liquidator receives BTC at 10% below market — their profit |
| **Protocol liquidation fee** | 2% | Writz takes 2% of the liquidated collateral value |

### Example liquidation scenario

```
User deposits:     1 BTC at $100,000 → collateral value = $100,000
User borrows:      $60,000 USDC (60% LTV, collateral ratio = 167%)
Liquidation at:    collateral ratio = 120% → BTC price = $72,000

At BTC = $72,000:
  Collateral value:  $72,000
  Debt:              $60,000 + accrued interest (assume $60,500)
  Collateral ratio:  72,000 / 60,500 = 119% → LIQUIDATABLE

Liquidation:
  Liquidator pays:   $60,500 USDC (full debt)
  Liquidator gets:   $60,500 × 1.10 = $66,550 worth of BTC (10% bonus)
  Protocol gets:     $60,500 × 0.02 = $1,210 worth of BTC (2% fee)
  User gets back:    $72,000 - $66,550 - $1,210 = $4,240 worth of BTC (residual)

Liquidator profit:  $66,550 - $60,500 = $6,050 (~10%)
```

### Partial liquidations

For large positions, full liquidation in one transaction may not be practical. Writz supports partial liquidations — a liquidator pays some of the debt and receives proportional collateral.

**Minimum liquidation amount:** 10% of outstanding debt per liquidation call. This prevents dust liquidations that waste gas without meaningful risk reduction.

---

## Liquidation and the ZK Circuit

The liquidation Circom circuit must prove:

```circom
template LiquidationProof() {
    // Private inputs (never revealed on-chain)
    signal private input collateral_satoshis;
    signal private input usdc_debt;
    signal private input secret;
    signal private input nonce;
    signal private input merkle_path[DEPTH];
    signal private input commitment_index;

    // Public inputs (visible on-chain)
    signal input btc_price_usd;          // from oracle
    signal input liquidation_threshold;  // 120% = 12000 in basis points
    signal input merkle_root;            // current commitment tree root
    signal input nullifier;              // prevents replay

    // Constraints
    // 1. Commitment is correctly formed
    commitment <== Poseidon(collateral_satoshis, usdc_debt, secret, nonce);

    // 2. Commitment is in the Merkle tree
    merkle_root <== MerkleProof(commitment, commitment_index, merkle_path);

    // 3. Position is undercollateralized
    // collateral_value_usd = collateral_satoshis × btc_price_usd / 100_000_000
    // ratio = collateral_value_usd × 10000 / usdc_debt (basis points)
    // ratio < liquidation_threshold
    ratio <== (collateral_satoshis × btc_price_usd / 100_000_000 × 10000) / usdc_debt;
    ratio < liquidation_threshold === 1;

    // 4. Nullifier is correctly derived (prevents double-liquidation)
    nullifier <== Poseidon(secret, commitment_index);
}
```

**Key circuit challenge:** Division and comparison (`ratio < threshold`) are expensive in ZK circuits because they require range proofs. This will be one of the heavier operations in Writz's circuit design. Benchmark this specifically in Phase 1.

---

## Liquidation UX for Users

Users should be notified well before liquidation:
- **150% → 140%:** Warning notification (email, in-app)
- **140% → 130%:** Urgent notification with one-click repay button
- **130% → 120%:** Critical alert — liquidation imminent
- **< 120%:** Keeper initiates liquidation

The Writz frontend should show users their health factor in real-time using their locally-stored position secret (the frontend knows the position details even though the chain doesn't).

---

*Last updated: 2026-06-22*
*Sources: [What is Health Factor in DeFi — Otomato](https://otomato.xyz/blog/what-is-health-factor-defi-lending) · [ZK Lending on Cardano — Catalyst](https://projectcatalyst.io/funds/13/cardano-open-developers/zero-knowledge-privacy-protocol-for-defi-lending-and-borrowing-on-cardano-open-source) · [Aave Liquidation Mechanism](https://docs.aave.com/faq/liquidations)*
