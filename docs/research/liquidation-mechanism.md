---
title: "Research: Liquidation Mechanism Design"
sidebarTitle: "Liquidation Mechanism Design"
---

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Liquidations are the safety mechanism that keeps Writz Lend solvent. When a user's BTC collateral drops in value and their loan becomes undercollateralized, a liquidation must occur quickly to protect the USDC lenders.

The challenge for Writz: Bitcoin collateral cannot be seized on Stellar, so a liquidation clears debt on Stellar and relies on the position's script on Bitcoin.

This document designs the liquidation system.

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

## Recommended Liquidation Architecture

### Phase 1: Keeper + Emergency Timelock

```
Writz Keeper (off-chain)
├── Reads plaintext positions from writz-lend
├── Monitors BTC/USD price continuously
├── When BTC price × collateral / debt < 120%:
│   Calls writz-lend.liquidate(txid)
└── Emergency fallback: if the keeper is stale for 24 hours, anyone can
    liquidate a position that is below the threshold
```

**Emergency fallback:** `writz-lend::liquidate` restricts liquidation to a designated keeper by default, with a **time-based** fallback: `Config.keeper_stale_after_secs` (default 86,400 = 24h) and `ProtocolState.last_keeper_heartbeat`. If the designated keeper hasn't successfully liquidated or called `keeper_heartbeat` within that window, `liquidate` opens to any caller who can satisfy the (caller-independent) undercollateralization check. See `contracts/contracts/writz-lend/src/lib.rs`.

### Phase 2: Decentralized Keeper Network

Multiple keeper nodes compete to liquidate. The first valid call wins. Keepers are incentivized by the liquidation bonus. A stake/bond mechanism ensures keepers don't collude to delay liquidations.

---

## Liquidation Parameters

### Collateralization ratios

| Parameter | Value | Rationale |
|---|---|---|
| **Minimum collateral ratio** | 150% | User can borrow up to 66.7% of BTC value in USDC |
| **Liquidation threshold** | 120% | Position liquidated if BTC value drops to 1.2× the debt |
| **Liquidation buffer** | 30% | Distance from min ratio to liquidation: safety margin for BTC volatility |
| **Liquidation bonus** | 10% | Liquidator receives BTC at 10% below market - their profit |
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

For large positions, full liquidation in one transaction may not be practical. Writz supports partial liquidations - a liquidator pays some of the debt and receives proportional collateral.

**Minimum liquidation amount:** 10% of outstanding debt per liquidation call. This prevents dust liquidations that waste gas without meaningful risk reduction.

---

## Liquidation UX for Users

Users should be notified well before liquidation:
- **150% → 140%:** Warning notification (email, in-app)
- **140% → 130%:** Urgent notification with one-click repay button
- **130% → 120%:** Critical alert - liquidation imminent
- **< 120%:** Keeper initiates liquidation

The Writz frontend should show users their health factor in real-time using their locally-stored position secret (the frontend knows the position details even though the chain doesn't).

---

*Last updated: 2026-06-22*
*Sources: [What is Health Factor in DeFi - Otomato](https://otomato.xyz/blog/what-is-health-factor-defi-lending) · [Aave Liquidation Mechanism](https://docs.aave.com/faq/liquidations)*
