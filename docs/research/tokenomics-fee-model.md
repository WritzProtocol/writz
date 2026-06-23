# Research: Tokenomics & Fee Model

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Writz Protocol's economic sustainability depends on a well-designed fee model. This document defines all revenue streams, the protocol fee structure, treasury allocation, and the governance token strategy — informed by the 2025–2026 shift in DeFi toward real-yield tokenomics.

---

## Industry Context: The Real-Yield Shift (2025–2026)

The DeFi industry has fundamentally changed its tokenomics approach:

**Old model (2020–2023):** Emit governance tokens as liquidity mining rewards. Users farm tokens, dump them, APYs collapse, protocol dies.

**New model (2024–2026):**
- Uniswap: 17% of swap fees auto-buy and burn UNI tokens
- Aave's "Aave Will Win": protocol revenue directly tied to AAVE token through buyback mechanism
- Compound, Curve: fee revenue distributed to stakers/veTokens

**The paradigm:** Governance tokens must be backed by real protocol revenue, not emissions. Writz will design tokenomics from day one around real cash flows.

---

## Revenue Streams

### Primary: Lending Spread (PrivateLend)
The difference between the borrow rate (what borrowers pay) and the supply rate (what lenders earn).

```
At 75% utilization (Uoptimal):
  Borrow rate: 8% APR
  Supply rate: 6.8% APR (= 8% × 75% × 85%)
  Protocol spread: 1.2% APR on borrowed amount
```

At $1M TVL with 75% utilization ($750K borrowed): ~$9,000/year in spread revenue.

### Secondary: SPV Verification API
Other Stellar protocols pay to use Writz's Bitcoin SPV client.

**Pricing model:**
- Per-verification fee: $0.10–$0.50 per proof verification
- Monthly subscription: $500–$5,000/month for high-volume protocols

Early adopter pricing is aggressive — the goal is ecosystem adoption, not maximizing API revenue in Year 1.

### Tertiary: Swap Fees (Dark Swap)
Basis points on BTC/USDC swaps. Target: 0.3% per swap (comparable to Uniswap v3).

At $10M monthly swap volume: $30,000/month in swap fees.

### Quaternary: ZK Proof of Reserve SaaS (B2B)
Enterprise customers pay for private, verifiable BTC reserve attestations.

**Pricing model:**
- Starter: $500/month — up to 5 attestations
- Professional: $2,000/month — unlimited attestations, custom reporting
- Enterprise: $10,000+/month — SLA, dedicated support, compliance documentation

Target: 10 paying enterprise customers in Year 1 = $20,000–$100,000/year.

### Liquidation Fees
2% of liquidated collateral value goes to the protocol.

At 10 liquidations/month averaging $20,000 each: $4,000/month.

---

## Fee Distribution

All protocol revenue flows into a distribution contract that routes funds to:

```
100% of Protocol Revenue
├── 30% → Insurance Fund (on-chain safety reserve)
├── 30% → Token Buyback & Burn (reduces supply, supports token price)
├── 25% → Operations Treasury (salaries, infrastructure, audits)
└── 15% → Ecosystem Grants (developer grants, integrations)
```

**Insurance Fund:** Accumulates until it reaches 10% of TVL. After that, excess flows to buyback instead. This ensures the protocol can cover bad debt without relying on tokenomics.

**Buyback & Burn:** Protocol buys WRTZ tokens from the open market and burns them. This creates deflationary pressure tied directly to protocol usage — more borrowers = more revenue = more buybacks = less token supply.

---

## Governance Token: WRTZ

### Design principles
- Total supply: **100,000,000 WRTZ** (fixed, no inflation)
- 100% backed by real protocol revenue (no liquidity mining emissions)
- Governance rights over protocol parameters
- Revenue sharing via buyback/burn (not direct dividends — cleaner tax treatment)

### Distribution

| Allocation | % | Amount | Vesting |
|---|---|---|---|
| Team | 20% | 20M | 4 years, 1-year cliff |
| Investors (seed) | 15% | 15M | 2 years, 6-month cliff |
| Ecosystem/grants | 20% | 20M | 3 years, monthly release |
| Community/DAO treasury | 25% | 25M | Governed by DAO |
| Protocol-owned liquidity | 10% | 10M | Used to seed USDC pools |
| Public launch | 10% | 10M | IDO / fair launch |

**No pre-mine for team beyond the 20% with vesting.** The community treasury (25%) is controlled by WRTZ governance from day one.

### Token utility

1. **Governance:** Vote on protocol parameters (interest rate curves, collateral ratios, fee splits, new features)
2. **Fee capture:** Buyback/burn mechanism means holding WRTZ benefits from protocol growth
3. **Staking for enhanced yields:** WRTZ stakers receive 10% boost on USDC lending yields (creates demand for staking)
4. **Liquidation priority:** WRTZ stakers have first access to liquidation opportunities (creates demand from keeper operators)

### When to launch the token

**Not in Phase 1 or Phase 2.** Token launches before product-market fit destroy communities and set unrealistic expectations.

**Token launch criteria:**
- $5M TVL sustained for 60+ days
- 500+ active users
- At least one completed external audit
- Clear governance use cases ready to deploy

Expected timeline: Q2–Q3 2027.

---

## Financial Projections (Conservative)

### Year 1 (2027, post-launch)

| Revenue Stream | Monthly | Annual |
|---|---|---|
| Lending spread (@ $2M TVL, 75% util) | $1,500 | $18,000 |
| Dark Swap fees ($500K/month volume) | $1,500 | $18,000 |
| SPV API | $500 | $6,000 |
| Proof of Reserve (5 customers) | $5,000 | $60,000 |
| Liquidation fees | $1,000 | $12,000 |
| **Total** | **$9,500/month** | **$114,000/year** |

### Year 2 (2028)

| Revenue Stream | Monthly | Annual |
|---|---|---|
| Lending spread (@ $20M TVL, 75% util) | $15,000 | $180,000 |
| Dark Swap fees ($5M/month volume) | $15,000 | $180,000 |
| SPV API | $5,000 | $60,000 |
| Proof of Reserve (25 customers) | $25,000 | $300,000 |
| Liquidation fees | $5,000 | $60,000 |
| **Total** | **$65,000/month** | **$780,000/year** |

These are conservative estimates. At BTCfi's current 28× annual TVL growth rate, the upside scenario significantly exceeds these numbers.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Token model | Real-yield, buyback/burn | 2026 industry standard; no inflationary emissions |
| Token supply | 100M fixed | Simple, no inflation |
| Token launch timing | Post $5M TVL | Product-market fit first |
| Protocol fee % | 15% of interest spread | Higher than Aave (10%) due to ZK infrastructure costs |
| Insurance fund target | 10% of TVL | Industry standard; covers typical bad debt scenarios |
| Revenue distribution | 30/30/25/15 | Balanced between safety, token health, operations, growth |

---

*Last updated: 2026-06-22*
*Sources: [DeFi Protocol Revenue Rankings — DefiLlama](https://defillama.com/revenue) · [Aave Interest Rate Model](https://rareskills.io/post/aave-interest-rate-model) · [DeFi 2.0 Lending Protocols](https://1bitup.com/blog/defi-lending-protocols)*
