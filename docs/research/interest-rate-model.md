# Research: Interest Rate Model

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

PrivateLend's interest rate model determines how much borrowers pay and how much lenders earn. A well-calibrated model keeps liquidity available, prevents extreme rate volatility, and ensures the protocol remains solvent under stress.

This document analyzes production models from Aave v3, Compound v2, and Blend, then proposes Writz's specific parameters.

---

## The Utilization Rate

All major lending protocols drive rates from a single variable: **utilization rate (U)**.

```
U = total_borrowed_USDC / total_supplied_USDC
```

- U = 0%: No one is borrowing. Lenders earn nothing.
- U = 80%: Healthy target. Good yield for lenders, reasonable cost for borrowers.
- U = 100%: All liquidity is borrowed. No withdrawals possible. Crisis state.

The model's job is to automatically adjust rates so that U gravitates toward a target (usually 70–90%) through price signals.

---

## The Kinked (Two-Slope) Interest Rate Model

Aave v3, Compound v2, and Blend all use a **piecewise linear model** — often called the "kinked" model — with two distinct slopes separated by an optimal utilization point.

```
          Borrow Rate
              │
slope2 →  ████│                                    ← steep rise
              │                                 ████
              │                           ██████
              │                     ██████
slope1 →  ████│               ██████
              │         ██████
              │   ██████
    base  →  █│███
              └────────────────────────────────── Utilization
              0%           Uoptimal              100%
                            (80%)
```

### Formula

```
if U ≤ Uoptimal:
    borrow_rate = base_rate + (U / Uoptimal) × slope1

if U > Uoptimal:
    borrow_rate = base_rate + slope1 + ((U - Uoptimal) / (1 - Uoptimal)) × slope2

supply_rate = borrow_rate × U × (1 - protocol_fee)
```

### Parameter comparison across protocols

| Parameter | Aave v3 (WBTC) | Compound v2 | Blend (Stellar) | **Writz (proposed)** |
|---|---|---|---|---|
| Base rate | 0% | 2% | 0% | **0%** |
| Uoptimal | 45% | 80% | 80% | **75%** |
| Slope 1 (below optimal) | 7% | 15% | 8% | **8%** |
| Slope 2 (above optimal) | 300% | 200% | 150% | **200%** |
| Protocol fee | 10% | 20% | 10% | **15%** |

### Why Writz's parameters differ from standard

**Uoptimal = 75% (not 80%):**
BTC-collateralized loans carry higher liquidation risk than stablecoin loans. In a BTC price crash, multiple positions may need liquidation simultaneously, requiring liquidity to be available. A lower Uoptimal ensures more USDC is always available for withdrawals during a crisis.

**Slope 2 = 200%:**
An aggressive slope 2 is essential. At 100% utilization, USDC cannot be withdrawn. The steep slope 2 creates a powerful price signal to repay loans or supply more USDC before the system is illiquid. At U=90%, the borrow rate would be: 0% + 8% + ((90%-75%)/(25%)) × 200% = 8% + 120% = 128% APR. Nobody stays borrowed at 128% — the slope works.

**Protocol fee = 15%:**
Higher than Aave's 10%, justified by Writz's additional privacy infrastructure costs (ZK proof verification per transaction). The remaining 85% of interest goes to USDC lenders.

---

## Example Rate Scenarios

| Utilization | Borrow Rate | Supply Rate (after 15% fee) |
|---|---|---|
| 0% | 0% | 0% |
| 25% | 2.67% | 0.57% |
| 50% | 5.33% | 2.27% |
| 75% (optimal) | 8% | 5.1% |
| 80% | 48% | 32.6% |
| 90% | 128% | 97.9% |
| 95% | 168% | 134.7% |

The jump from 75% → 80% creates a powerful incentive (8% → 48%) that strongly discourages the pool from going above the optimal utilization point.

---

## Interest Accrual Mechanism

### Continuous accrual

Interest accrues continuously on outstanding loans, calculated per Stellar ledger close (~5 seconds). This avoids the "interest cliff" problem where large amounts accrue at discrete intervals.

### Implementation

```rust
// Per-ledger interest calculation
let blocks_elapsed = current_ledger - last_update_ledger;
let ledger_rate = annual_borrow_rate / (365 * 24 * 720); // 720 ledgers per hour
let interest_accrued = outstanding_debt × ledger_rate × blocks_elapsed;
debt = outstanding_debt + interest_accrued;
```

### Compound interest

Writz uses compound interest (interest on interest). This matches Aave/Compound behavior and simplifies the accounting model — the outstanding debt grows continuously, and the protocol fee is taken from the spread.

---

## Protocol Revenue Flow

```
USDC supplied by lenders:         $1,000,000
Utilization (example):            75%
USDC borrowed:                    $750,000
Annual borrow rate at 75% util:   8%

Annual interest generated:        $750,000 × 8% = $60,000

Distribution:
├── USDC lenders (85%):           $51,000/year → 5.1% APY on supplied capital
└── Writz Protocol (15%):         $9,000/year  → protocol revenue

Protocol revenue breakdown:
├── Insurance fund (30%):         $2,700 → on-chain safety reserve
├── Operations (50%):             $4,500 → operational expenses
└── Protocol treasury (20%):      $1,800 → future development
```

---

## Stress Test: BTC Price Crash Scenario

**Scenario:** BTC drops 40% in 24 hours. Many positions approach liquidation threshold.

1. Liquidators activate — they need USDC to pay off loans
2. USDC demand spikes → U rises rapidly
3. Borrow rate jumps (e.g., from 8% to 50%+)
4. Existing borrowers are incentivized to repay immediately
5. USDC suppliers see high yields → new suppliers enter the pool
6. U stabilizes below the crisis threshold

**Key risk:** If ALL positions become liquidatable simultaneously and the pool is at 75%+ utilization, there may not be enough free USDC for liquidators.

**Mitigation:** The 75% Uoptimal (lower than Blend's 80%) ensures a larger free liquidity buffer during normal operations. Additionally, the liquidation bonus (BTC discount for liquidators) creates strong incentive for external liquidators to supply USDC even when the pool is stressed.

---

## Comparison: Blend Integration Option

Rather than building a standalone lending contract, Writz could **use Blend as the underlying lending primitive** and add the BTC SPV + ZK privacy layer on top.

**Pros:**
- Reuse Blend's $80M+ TVL and audited contracts
- Faster time to market
- Shared liquidity with the broader Stellar DeFi ecosystem

**Cons:**
- Blend controls collateral types and parameters — BTC support requires Blend to support it
- Privacy layer integration with Blend's architecture would require significant modification
- Less control over the economic model
- Revenue sharing with Blend protocol

**Recommendation:** Build independent PrivateLend for Phase 1. The ZK privacy requirement necessitates deep integration with the position management system — Blend's architecture makes this very difficult to retrofit. Use Blend as inspiration, not as the foundation.

---

*Last updated: 2026-06-22*
*Sources: [Aave Interest Rate Model — RareSkills](https://rareskills.io/post/aave-interest-rate-model) · [Aave v3 Rate Model Deep Dive — Medium](https://medium.com/@ancilartech/how-aave-calculates-interest-rates-a-deep-dive-into-defis-dynamic-rate-engine-23e75c5f1819) · [Blend Protocol — blend-capital/blend-contracts-v2](https://github.com/blend-capital/blend-contracts-v2)*
