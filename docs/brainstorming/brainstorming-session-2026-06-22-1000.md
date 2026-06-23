---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'BTCfi + Privacy on Stellar — startup ideation'
session_goals: 'Explore all opportunities at the intersection of BTCfi and privacy on Stellar to identify the most promising startup concept'
selected_approach: 'progressive-flow'
techniques_used: ['what-if-scenarios']
ideas_generated: [14]
context_file: ''
---

# Brainstorming Session — Writz Protocol

**Facilitator:** Sebastian
**Date:** 2026-06-22

## Session Overview

**Topic:** BTCfi + Privacy on Stellar — startup ideation
**Goal:** Explore all opportunities at the intersection of BTCfi and privacy on Stellar to identify the most promising startup concept

### Context

- BTCfi TVL grew from $304M (Jan 2024) to $8.6B+ (mid 2025)
- Stellar launched Protocol X-Ray (Jan 2026): ZK proofs via Noir in Soroban, live on mainnet
- Stellar Private Payments: open-source framework with Groth16 ZK proofs, compliance-friendly
- Nobody has meaningfully connected BTCfi with the Stellar ecosystem
- First-mover opportunity: virgin territory for private BTCfi on Stellar

### Session Setup

_Session started from scratch. User looking for a startup idea. Context pre-researched by the facilitator._

## Technique Selection

**Approach:** Progressive Technique Flow
**Journey Design:** Systematic — from broad exploration to concrete action

**Planned techniques:**
- **Phase 1 - Exploration:** What If Scenarios — maximum idea generation without constraints
- **Phase 2 - Patterns:** Mind Mapping — thematic cluster organization
- **Phase 3 - Development:** Six Thinking Hats — multi-dimensional analysis of top concepts
- **Phase 4 - Action:** Decision Tree Mapping — implementation pathways

**Note:** Phase 1 generated sufficient territory to move directly to organization and prioritization.

---

## Technique Executed: What If Scenarios — Expansive Exploration

### Ideas Generated

**[BTCfi #1]: The Invisible Bridge**
_Concept:_ Stellar acts as the DeFi layer but BTC never leaves the Bitcoin network. The user connects their Bitcoin wallet (Xverse, Leather, etc.), a cryptographic proof system verifies their BTC balance/ownership on Bitcoin, and Stellar executes the financial operations against that collateral — no bridge, no custodian.
_Novelty:_ Eliminates bridge risk (50%+ of all crypto hacks historically) and WBTC friction. BTC never abandons Bitcoin.

**[BTCfi #2]: Corporate BTC Collateral**
_Concept:_ B2B protocol where companies with BTC in their treasury use it as collateral to issue debt/liquidity in USDC on Stellar, with ZK privacy so neither the amount nor the lender identity is public. The protocol charges fees on the volume of generated liquidity (basis points).
_Novelty:_ Combines the corporate BTC treasury market with Stellar's unique privacy-compliant infrastructure. No competitor touches this segment on Stellar today.

**[BTCfi #3]: Dark Bond Market**
_Concept:_ Private debt marketplace where companies issue BTC-backed bonds on Stellar using ZK proofs. Issuers and investors are anonymous on-chain, with selective compliance for regulators via ASPs. Protocol charges issuance fees + % of secondary volume.
_Novelty:_ Private bond markets exist in TradFi but require expensive intermediaries (investment banks). Here it's a smart contract. First native private BTC-backed debt market on blockchain.

**[BTCfi #4]: PrivateLend — Private Blend with BTC Collateral**
_Concept:_ Lending protocol on Soroban where users deposit real BTC (via Xverse + Stellar bridge) as collateral and receive USDC. Positions are private via ZK proofs using Protocol X-Ray — nobody sees how much BTC you have or how much USDC you owe. USDC lenders earn yield. Protocol charges the spread.
_Novelty:_ Blend exists but without BTC and without privacy. Aave/MakerDAO have BTC but no privacy and aren't on Stellar. This protocol is the first intersection of all three.

**[BTCfi #5]: Bitcoin SPV Client on Soroban**
_Concept:_ A Soroban smart contract running a Bitcoin light client. Cryptographically verifies that a BTC transaction occurred using Merkle proofs and block headers — no custodian, no bridge, no third parties. On top of this, the lending protocol issues USDC with ZK-private positions. BTC is locked in a P2WSH script on Bitcoin that requires a protocol co-signature to release.
_Novelty:_ Nobody has built a Bitcoin SPV client on Soroban. Virgin territory in the Stellar ecosystem. The combination of trustless SPV + ZK privacy doesn't exist on any ecosystem today.

**[BTCfi #6]: Dual Protocol — Infrastructure + Product**
_Concept:_ The SPV client operates on two simultaneous layers: (1) public infrastructure that any Stellar protocol uses to verify Bitcoin transactions, charging a fee per verification or monthly subscription; (2) the lending protocol built on top of that infrastructure. The startup is its own infrastructure's first customer.
_Novelty:_ Similar model to Chainlink (infrastructure + ecosystem) but specific to Bitcoin-Stellar. The more protocols use the SPV client, the more valuable the infrastructure becomes and the harder it is to replicate.

**[BTCfi #7]: Dark Swap — Private BTC/USDC Exchange**
_Concept:_ User wants to convert BTC to USDC without going through a centralized exchange. The SPV client verifies that BTC arrived at the protocol address, Soroban instantly releases USDC, with ZK privacy across the entire flow. Not a loan — a direct swap.
_Novelty:_ Current DEXes on Stellar don't have real BTC. Centralized exchanges with BTC have no privacy. This is the first trustless private BTC/USDC swap.

**[BTCfi #8]: Verifiable Bitcoin Proof of Reserve for Enterprises**
_Concept:_ Companies claiming to hold BTC in reserve (exchanges, fintechs, funds) can use the SPV client to publish cryptographic proofs that they actually hold it — without revealing exactly how much or where, thanks to ZK. A proof of reserve that is simultaneously verifiable and private.
_Novelty:_ Post-FTX the market demands proof of reserve, but companies don't want to expose their wallets. ZK + SPV solves exactly that tension. Business model: SaaS for crypto companies.

**[BTCfi #9]: BTC-Backed Savings Account in USDC**
_Concept:_ User deposits BTC via SPV, receives USDC that auto-invests in the highest-yield pools on Stellar. Returns accumulate in USDC while BTC remains the collateral. A savings account that grows with BTC and generates yield in USDC.
_Novelty:_ Combines BTC's upside with the stability of USDC yield. Savings product, not trading — massive retail market.

**[BTCfi #10]: Private BTC→USDC Remittances for Latin America**
_Concept:_ Someone in the US sends BTC. The SPV client verifies the transaction. The recipient in Mexico/Colombia/Argentina receives USDC on Stellar in seconds. Without revealing amounts or identities on-chain. Cheaper than Western Union, faster than a bank.
_Novelty:_ Stellar already dominates USDC remittances. Nobody has connected BTC as the input asset with USDC as the output in a trustless, private way. LATAM remittance market: $150B/year.

**[BTCfi #11]: Open SDK — Wallets Come to You**
_Concept:_ Open-source SDK that any Bitcoin wallet can integrate with a few lines of code to give their users access to DeFi on Stellar. The protocol charges fees regardless of which wallet uses it.
_Novelty:_ Instead of being an Xverse feature, you become the infrastructure layer that makes ALL wallets more powerful. Similar model to Stripe — merchants compete to use you, not the other way around.

**[BTCfi #12]: Stellar Ecosystem as First Customer**
_Concept:_ First go-to-market within Stellar — protocols like Blend, AMMs, and Stellar apps that want BTC exposure but have no way to access it today.
_Novelty:_ B2B distribution within an ecosystem that already knows and needs you. The SDF has incentives to support it — they benefit from BTC entering Stellar.

**[BTCfi #13]: Freighter/Lobstr as Entry Point**
_Concept:_ Integration with native Stellar wallets — Freighter or Lobstr — that already have millions of users. The user connects both their Stellar wallet AND their Bitcoin wallet in the same flow via PSBT standard. No dependency on any specific wallet.
_Novelty:_ Stellar Wallets Kit already supports multiple wallets with a single integration.

**[BTCfi #14]: Launch with Own Frontend First**
_Concept:_ Launch app.writz.io as a direct product. Build an early adopter user base. With demonstrated traction, wallets come to you on their own.
_Novelty:_ Uniswap, Aave and Compound all launched with their own frontend before MetaMask natively integrated them. Traction is the best sales pitch.

### Anti-patterns Detected

**Anti-pattern #1:** A privacy layer on top of existing protocols is perceived as a cost, not generated value. The fee competes against yield the user already had.

**Anti-pattern #2:** Go-to-market dependent on a single strategic partner = concentration risk. If the partner says no, the project dies in distribution before validating the protocol.

---

## Idea Organization and Prioritization

### Thematic Organization

**Theme 1 — Core Infrastructure** ✅ SELECTED
- #5 Bitcoin SPV Client on Soroban (technical foundation)
- #6 Dual Protocol — public infrastructure + own product
- #11 Open SDK — distribution without single-partner dependency

**Theme 2 — Direct-to-User DeFi Products** ✅ SELECTED
- #4 PrivateLend — star product: private BTC → USDC
- #7 Dark Swap — natural extension: private BTC/USDC swap
- #9 BTC Savings — extension: BTC collateral + automatic USDC yield

**Theme 3 — B2B Feature (small scope)** ✅ SELECTED (bounded)
- #8 ZK Proof of Reserve — lightweight B2B feature on existing infrastructure

**Discarded / Out of scope:**
- #3 Dark Bond Market — too much legal and technical complexity for v1
- #10 LATAM Remittances — possible future product, not initial focus
- #2 Corporate Collateral — partially absorbed by Proof of Reserve

### Final Prioritization

**Priority 1 — Foundation:** Bitcoin SPV Client on Soroban
**Priority 2 — Star Product:** PrivateLend (private BTC → USDC)
**Priority 3 — Distribution:** Open SDK + own frontend
**Priority 4 — Light B2B:** ZK Proof of Reserve for enterprises

### Main Risk Identified
**User trust and adoption** — The biggest obstacle is not technical but credibility. The anti-risk strategy includes: open source from day 1, pre-launch audits, progressive TVL caps, on-chain insurance fund, Stellar ecosystem credibility (SDF, validators).

---

## Final Startup Concept

```
WRITZ PROTOCOL
├── INFRASTRUCTURE
│   ├── Bitcoin SPV Client on Soroban (trustless BTC verification)
│   ├── ZK Privacy Layer via Protocol X-Ray / Noir
│   └── Open-source SDK for wallets and protocols
├── USER PRODUCTS
│   ├── PrivateLend: BTC → USDC, private position
│   ├── Dark Swap: private and trustless BTC ↔ USDC
│   └── BTC Savings: BTC collateral + automatic USDC yield
├── B2B FEATURE (bounded scope)
│   └── ZK Proof of Reserve for crypto enterprises
└── GO-TO-MARKET
    ├── Own frontend first → own traction
    ├── SDF grants + Stellar validator credibility
    └── Progressive TVL with audits per milestone
```

---

## Action Plan

### This week
1. Research existing SPV implementations on other chains (BTC Relay on Ethereum, zkBitcoin, Succinct Labs, summa-tx/bitcoin-spv, Interlay/interBTC) to learn without reinventing
2. Review available SDF grants — specific funds for Stellar infrastructure
3. Read Protocol X-Ray and Noir circuit documentation to understand the real limits of ZK in Soroban

### Next month
4. Build MVP of the SPV client on Soroban — goal: verify a single Bitcoin transaction on testnet
5. Define economic model: interest rates, protocol fees, insurance fund
6. Contact 2–3 specialized auditors (OtterSec, Trail of Bits) for quotes and timeline

### Next 3 months
7. Launch on testnet with $50K TVL cap
8. Publish code on GitHub and find contributors from the Stellar community
9. Apply to SCF (Stellar Community Fund) for visibility and initial funding

---

## Session Summary

**Key breakthroughs:**
- The BTC + USDC + ZK Privacy intersection on Stellar is virgin territory — nobody has built it
- Bitcoin SPV on Soroban is the core technical innovation that differentiates this startup from everything existing
- The dual model (public infrastructure + own product) creates two revenue engines and network effects
- Trust is the real risk — the technical strategy must serve the goal of building progressive credibility

**Concept strengths:**
- Real first-mover on Stellar for BTCfi
- Stellar just launched Protocol X-Ray (ZK on mainnet) — perfect timing
- USDC on Stellar has $500M/month in volume — real liquidity available
- No dependency on a single partner for go-to-market

**Creative Facilitation Narrative:**
Sebastian arrived without a formed idea, with genuine curiosity about BTCfi and privacy on Stellar. Through systematic exploration he identified patterns others have missed: Stellar has the best privacy infrastructure in the blockchain ecosystem in 2026, but nobody has connected it with real Bitcoin. The decision to bet on Bitcoin SPV on Soroban — the most technically ambitious option — reflects a long-term view on sustainable competitive advantage.
