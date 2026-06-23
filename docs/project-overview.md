# Writz Protocol — Project Overview

**Version:** 0.2 (Phase 1 foundation — testnet)
**Last updated:** 2026-06-22

---

## What is Writz Protocol?

Writz Protocol is the first trustless Bitcoin DeFi layer on Stellar. It enables users to deposit real BTC — directly from a Bitcoin wallet — and interact with Stellar's DeFi ecosystem: borrowing USDC, swapping assets, and earning yield. All positions are private by default using Stellar's zero-knowledge proof infrastructure.

The protocol is built on two pillars:

1. **A Bitcoin SPV client on Soroban** — a smart contract that cryptographically verifies Bitcoin transactions without a custodian or bridge. No third party holds your BTC.
2. **ZK privacy layer via Protocol X-Ray** — positions, collateral amounts, and loan sizes are hidden using zero-knowledge proofs built into Stellar's mainnet.

---

## The Problem

Bitcoin is the world's largest crypto asset by market cap, but it is largely excluded from DeFi. Existing solutions either:

- **Require a custodian** (WBTC, tBTC) — introducing counterparty risk and regulatory exposure
- **Are fully public** (Aave, Compound, Blend) — exposing position sizes, collateral ratios, and liquidation thresholds to anyone watching the chain
- **Live on ecosystems without compliance-grade privacy** — making institutional participation impractical

Meanwhile, Stellar processes $500M/month in USDC and launched Protocol X-Ray (January 2026), bringing ZK proof capabilities to Soroban smart contracts. Nobody has connected these two realities.

---

## The Solution

Writz Protocol connects Bitcoin natively to Stellar's DeFi and privacy infrastructure.

```
Bitcoin Network                    Stellar / Soroban
─────────────────                  ──────────────────────────────────
User BTC Wallet (Xverse)           SPV Client Contract
      │                                    │
      │  BTC locked in P2WSH script        │  Verifies Merkle proof
      └───────────────────────────────────►│  of BTC transaction
                                           │
                                           ▼
                                    ZK Privacy Layer (Noir / X-Ray)
                                           │
                                           ▼
                             ┌─────────────────────────┐
                             │     User Products        │
                             │  PrivateLend  Dark Swap  │
                             │  BTC Savings  PoR B2B    │
                             └─────────────────────────┘
```

### How BTC locking works

1. User sends BTC to a **P2WSH script address** on Bitcoin that has two spending conditions:
   - The protocol co-signs the release (loan repaid) ✅
   - A timelock expiry triggers after a safety period (protocol unavailable) ✅
2. User submits an **SPV proof** to the Soroban contract: a Bitcoin block header + Merkle proof showing their transaction is included in a confirmed block.
3. The contract verifies the proof cryptographically and recognizes the deposit.
4. USDC credit or swap is issued on Stellar. The position is wrapped in a **ZK proof** — nobody on-chain sees the amount or the user's identity.

---

## Products

### PrivateLend *(star product)*
Deposit BTC as collateral → borrow USDC. Positions are private. Interest paid over time. USDC lenders on the other side earn yield. Protocol captures the spread.

### Dark Swap
Convert BTC to USDC directly — no custodial exchange, no KYC exposure, no public order book. The SPV client verifies BTC receipt, USDC is released instantly.

### BTC Savings
Deposit BTC → receive USDC that auto-routes to the highest-yield pools on Stellar (Blend, AMMs). Returns accumulate in USDC while BTC remains the collateral. A savings account that benefits from BTC upside and generates USDC yield passively.

### ZK Proof of Reserve *(B2B feature)*
Crypto companies (exchanges, fintechs, funds) prove they hold BTC without revealing wallet addresses or exact amounts. Cryptographic attestation with ZK privacy. SaaS model, charged per attestation or monthly subscription.

---

## Infrastructure Layer

The SPV client is open infrastructure, not just internal tooling. Any Stellar protocol that needs to verify a Bitcoin transaction can use it. Writz charges a fee per verification.

An open-source SDK allows any wallet or protocol to integrate Bitcoin SPV verification into their product with minimal code. Writz becomes the infrastructure layer that makes the Stellar ecosystem Bitcoin-aware.

---

## Business Model

| Revenue Stream | Mechanism |
|---|---|
| **Lending spread** | Borrow rate minus supply rate on PrivateLend |
| **Swap fees** | Basis points on each Dark Swap |
| **SPV API fees** | Per-verification or subscription for third-party protocol integrations |
| **Proof of Reserve SaaS** | Monthly subscription for enterprise B2B customers |
| **Insurance fund** | % of all fees auto-routed to an on-chain reserve |

---

## Why Stellar?

- **Protocol X-Ray (Jan 2026):** ZK proofs via Noir circuits live on Soroban mainnet — the best compliance-friendly privacy infrastructure in any blockchain ecosystem today
- **USDC dominance:** $500M/month USDC volume on Stellar — real liquidity, not speculative
- **Rust-native smart contracts:** Soroban contracts are written in Rust, the same language as the best existing Bitcoin SPV libraries (summa-tx)
- **Low fees:** Stellar's fee structure makes per-verification SPV economically viable at scale
- **First-mover:** No BTCfi protocol exists on Stellar today

---

## Key Risks

| Risk | Mitigation |
|---|---|
| User trust and adoption | Open source, audits, progressive TVL caps, on-chain insurance fund |
| Relayer liveness (header submission) | Economic incentives for relayers built into protocol fees |
| Bitcoin confirmation time (~60 min) | Accept 3-confirmation deposits at higher fees; 6-confirmation at standard fees |
| Smart contract exploits | Audits (OtterSec / Trail of Bits) before mainnet; bug bounty program |
| Regulatory exposure | Compliance hooks via Stellar ASPs; no capital controls use cases |

---

## Team Requirements

To build Writz Protocol, the team needs:
- **Rust/Soroban engineer** — SPV client implementation, ZK circuit integration
- **Bitcoin protocol engineer** — P2WSH scripting, relayer design
- **DeFi product designer** — UX for PrivateLend, Dark Swap
- **Business/BD** — SDF grants, ecosystem partnerships, B2B Proof of Reserve sales

---

## Current Status

Ideation phase. Brainstorming session completed 2026-06-22. Roadmap research in progress.

Next step: Technical feasibility deep-dive on Bitcoin SPV in Soroban.

> See: `docs/research/spv-implementations.md` for prior art analysis
> See: `docs/roadmap/roadmap.md` for full execution plan
