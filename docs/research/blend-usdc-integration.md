# Research: Stellar USDC Liquidity & Blend Ecosystem

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

The supply side of PrivateLend — USDC lenders who provide the capital that borrowers draw against — depends on Stellar's existing USDC ecosystem. This document maps the USDC liquidity landscape on Stellar and evaluates how Writz fits into and potentially integrates with existing protocols.

---

## USDC on Stellar — State of Play (2026)

| Metric | Value |
|---|---|
| USDC monthly volume on Stellar | $500M+ |
| USDC issuer | Circle (native issuance — not bridged) |
| Largest USDC protocol | Blend ($80M+ TVL as of early 2026) |
| Network operations (Q3 2025) | 1 billion+ |
| Typical transaction finality | 3–5 seconds |
| Typical transaction fee | < $0.001 |

**Critical point:** Stellar USDC is natively issued by Circle — not a bridged or wrapped version. This means:
- No bridge risk on the USDC side
- Regulatory compliance built-in (Circle's USDC is fully regulated)
- Stellar USDC is the same USDC used in MoneyGram, payments integrations, and enterprise contexts
- Users borrowing USDC from Writz get a real, liquid, institutional-grade asset

---

## Blend Protocol — The Primary Competitor and Reference

**Repository:** [blend-capital/blend-contracts-v2](https://github.com/blend-capital/blend-contracts-v2)
**TVL:** $80M+ (early 2026)
**Built on:** Soroban

### What Blend is

Blend is Stellar's Aave equivalent — a lending protocol primitive that allows anyone to create isolated lending pools. It supports:
- Pool creation by anyone (permissionless)
- Per-pool interest rates and collateral factors
- A unique backstop module (insurance against bad debt)
- Auto-compounding vaults built on top

### Blend's limitation: No BTC, No Privacy

Blend currently supports Stellar native assets and SAC tokens (Stellar Asset Contract). It does **not** support:
- Bitcoin as collateral (no BTC on Stellar today)
- Zero-knowledge position privacy

**This is the gap Writz fills.**

### Blend as a co-existence opportunity

Rather than competing with Blend for USDC liquidity, Writz can potentially co-exist:
- **Short term:** Writz operates its own isolated USDC pools (independent from Blend)
- **Medium term:** Writz could integrate with Blend pools as a source of USDC liquidity for borrowers, acting as a BTC-collateral gateway
- **Long term:** If Blend adds SPV verification support, Writz's open SDK provides the primitive

**Why independent pools first:** The ZK privacy requirement means position state must be managed within Writz's own contracts. Blend's architecture doesn't accommodate ZK-private positions without significant modification.

---

## Oracle Integration: RedStone + SEP-40

Blend is already integrating RedStone for price feeds. This is important for Writz:
- Writz should use the same oracle (RedStone) and same standard (SEP-40)
- When a user's position health is evaluated in Writz, the BTC price comes from the same source Blend uses for its own collateral pricing
- Consistent oracle standards across the Stellar DeFi ecosystem reduce the attack surface for oracle manipulation

---

## USDC Liquidity Bootstrap Strategy

The chicken-and-egg problem: USDC lenders won't supply unless there are BTC borrowers. BTC borrowers won't deposit unless there's USDC to borrow.

### Phase 2 Bootstrap Approaches

**1. Protocol-owned liquidity (POL):**
Writz can use initial funding (from SDF grants, SCF, or equity) to seed the USDC pool with protocol-owned capital. This provides initial liquidity before organic lender supply.

Target seed: $50,000–$100,000 USDC from protocol treasury to bootstrap initial pool.

**2. High initial supply APY:**
Set initial protocol fee to 0% temporarily, routing 100% of interest to USDC suppliers. This creates above-market yields (e.g., 10–15% APY during bootstrap) that attract USDC lenders.

**3. Target Stellar DeFi native users:**
Stellar users who already hold USDC are the easiest to convert — they don't need to bridge anything. Target them via Stellar wallet integrations (Lobstr, Freighter), Stellar Discord communities, and integration with Stellar DeFi newsletters.

**4. Institutional lenders:**
Post-FTX, institutional crypto funds are looking for compliant, audited DeFi yield. Writz's compliance-friendly privacy (ASPs, audit trail available) and Circle's native USDC make it attractive for institutions. Direct outreach to crypto-native family offices and funds.

---

## USDC Pool Architecture in Writz

Writz's USDC pools are separate from Blend's pools. Each pool has:

| Component | Description |
|---|---|
| **Pool contract** | Soroban contract managing supply and withdrawal |
| **Receipt tokens** | Users receive `wUSDC` (Writz USDC) representing their pool share |
| **Interest accrual** | Continuous, per-ledger accrual |
| **Withdrawal queue** | If utilization > 95%, withdrawal requests are queued until liquidity frees up |

### Multiple pool tiers (future consideration)

For Phase 2+, Writz could offer multiple USDC pool tiers with different risk/reward profiles:

| Pool | Collateral ratio | Interest rate | Target user |
|---|---|---|---|
| **Conservative** | 200% min collateral | Lower rates | Risk-averse lenders |
| **Standard** | 150% min collateral | Standard rates | General market |
| **Aggressive** | 130% min collateral | Higher rates | Yield-focused lenders |

---

## Key Findings

1. **Stellar USDC is ideal** — native issuance by Circle, $500M/month volume, real institutional liquidity
2. **Blend is complementary, not a competitor** — Blend has no BTC and no privacy; Writz fills the gap
3. **RedStone + SEP-40 is the oracle standard** — align with the broader Stellar DeFi ecosystem
4. **Protocol-owned liquidity is the best bootstrap mechanism** — use initial grants to seed the pool
5. **Institutional USDC lenders are a realistic target** — compliance-friendly privacy attracts institutional capital
6. **Independent pools required** — ZK position privacy cannot be retrofitted onto Blend's architecture

---

*Last updated: 2026-06-22*
*Sources: [Blend Protocol Introduction](https://medium.com/script3/introducing-blend-95aaf66bdf41) · [Blend Contracts v2](https://github.com/blend-capital/blend-contracts-v2) · [RedStone on Stellar](https://blog.redstone.finance/2026/03/04/stellar-finally-gets-the-oracle-infrastructure-it-deserves/) · [Stellar DeFi Overview](https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar)*
