# What is Writz?

Bitcoin is where wealth lives. It is the foundation — scarce, reliable, and built to hold value through anything. USDC is where wealth moves — the stablecoin that pays invoices, covers expenses, and flows through the real economy. And wrapped around both, an electric fence: zero-knowledge proofs that make your financial position visible only to you.

**Writz is the house where these three things live together, for the first time, on Stellar.**

You deposit real Bitcoin. You borrow real USDC. Your position — how much you deposited, how much you borrowed, how close you are to liquidation — is protected by mathematics. Nobody watching the blockchain can see it. Not bots. Not competitors. Not anyone.

---

## The Short Version

Writz lets Bitcoin holders borrow USDC without:

- Giving their BTC to a custodian
- Wrapping their BTC into a synthetic token
- Exposing their position on a public ledger

The BTC stays on Bitcoin, locked by a Bitcoin Script that nobody but the user controls. The USDC arrives on Stellar, native and real. The position stays private, protected by zero-knowledge proofs running on Stellar's ZK infrastructure.

---

## Why This Hasn't Existed Before

Three technologies had to converge before Writz was possible:

**1. Bitcoin SPV on Soroban.** A Soroban smart contract can now verify that a Bitcoin transaction happened — cryptographically, without trusting anyone — using Simplified Payment Verification. This was technically possible only after Soroban matured enough to handle the compute (Protocol 23, September 2025) and after the right Rust libraries existed to port the verification logic.

**2. ZK proofs on Stellar.** Stellar's Protocol X-Ray (January 2026) brought Groth16 zero-knowledge proof verification to Soroban smart contracts. For the first time, a Stellar contract can validate a ZK proof — making it possible to prove "this loan is adequately collateralized" without revealing the amount.

**3. Native USDC on Stellar.** Circle issues USDC natively on Stellar — not bridged, not synthetic. Writz borrowers receive the same USDC used by banks and fintechs worldwide. The output has real-world utility from day one.

All three became production-ready in 2025–2026. Writz is the first protocol to combine them.

---

## What You Can Do With Writz

### PrivateLend *(available Phase 2 — mainnet)*

Deposit BTC as collateral. Borrow USDC up to 66% of your BTC's value. Your collateral amount, loan size, and health ratio stay private — visible only to you. Interest accrues at market rates. Repay anytime and get your BTC back.

This is a loan against your Bitcoin savings, taken without giving up your Bitcoin or your privacy.

### Dark Swap *(Phase 3)*

Convert BTC to USDC directly — no exchange account, no KYC, no visible order book. The SPV contract verifies your BTC deposit; USDC is released instantly. The swap size is hidden behind a ZK proof.

### BTC Savings *(Phase 3)*

Deposit BTC as collateral and receive USDC that automatically routes to the highest-yield pools on Stellar — Blend, AMMs, and beyond. Your BTC stays yours. Your savings generate yield in USDC while Bitcoin does what Bitcoin does.

### ZK Proof of Reserve *(Phase 3 — B2B)*

Enterprises and exchanges can prove they hold a specific amount of Bitcoin without revealing wallet addresses or exact figures. A cryptographic attestation that satisfies auditors, regulators, and counterparties — without exposing the underlying holdings.

---

## How Writz Compares

| | WBTC / tBTC | Stacks sBTC | Blend | **Writz** |
|---|---|---|---|---|
| Needs a custodian | Yes | Partial | N/A | **No** |
| Wraps your BTC | Yes | Yes | N/A | **No** |
| Works with real BTC | No | Partial | No | **Yes** |
| Private positions | No | No | No | **Yes** |
| On Stellar | No | No | Yes | **Yes** |
| Native USDC output | No | No | Yes | **Yes** |

---

## The Moat

Writz's competitive position compounds with time:

- **Technical depth:** A Bitcoin SPV client on Soroban takes 12–18 months to build, audit, and deploy safely. A competitor starting today arrives after Writz is established with real TVL and ecosystem integrations.
- **The trusted setup ceremony:** The Groth16 ZK circuits require a one-time multi-party trusted setup — a transparent, public event. Every Writz proof is verified against these keys. A competitor needs their own ceremony, their own community trust-building.
- **SDK ecosystem lock-in:** The Writz Bitcoin SPV SDK is free for any Stellar protocol. Once wallets and protocols build on it, switching costs compound. Writz becomes load-bearing infrastructure for the entire Stellar ecosystem.

---

## Current Status

As of June 2026, Writz has completed Phase 1 — Foundation:

- Four Soroban contracts deployed on testnet
- 268 tests passing across all modules
- Full ZK proof cycle (deposit → borrow → repay) verified on-chain
- Real Bitcoin transactions broadcast and confirmed on Bitcoin Signet
- SCF Build Award application in progress

The protocol is not yet available on mainnet. Mainnet launch is targeted for Q4 2026 (Phase 2), starting with a gated, TVL-capped release of PrivateLend.

---

**Next:** [How Writz Works →](how-writz-works.md) — A plain-English explanation anyone can follow.
