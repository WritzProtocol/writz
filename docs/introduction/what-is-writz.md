---
title: "What is Writz?"
---

Bitcoin is where wealth lives. It is the foundation - scarce, reliable, and built to hold value through anything. USDC is where wealth moves - the stablecoin that pays invoices, covers expenses, and flows through the real economy.

**Writz connects the two on Stellar, without moving your Bitcoin off Bitcoin.**

You deposit real Bitcoin. You borrow real USDC. Your BTC stays in a Bitcoin script that you co-own with the protocol, and if Writz ever disappears, a timelock lets you take it back alone.

---

## The Short Version

Writz lets Bitcoin holders borrow USDC without:

- Giving their BTC to a custodian
- Wrapping their BTC into a synthetic token
- Trusting a bridge or a federation

The BTC stays on Bitcoin, locked by a Bitcoin Script that nobody but the user controls. The USDC arrives on Stellar, native and real. The position lives in the `writz-lend` contract and is public on chain, like any other lending market.

---

## Why This Hasn't Existed Before

Two technologies had to converge before Writz was possible:

**1. Bitcoin SPV on Soroban.** A Soroban smart contract can now verify that a Bitcoin transaction happened - cryptographically, without trusting anyone - using Simplified Payment Verification. This was technically possible only after Soroban matured enough to handle the compute (Protocol 23, September 2025) and after the right Rust libraries existed to port the verification logic.

**2. Native USDC on Stellar.** Circle issues USDC natively on Stellar - not bridged, not synthetic. Writz borrowers receive the same USDC used by banks and fintechs worldwide. The output has real-world utility from day one.

Both are production-ready. Writz combines them: native BTC collateral verified on Stellar, borrowed against in native USDC.

---

## What You Can Do With Writz

### Writz Lend *(on testnet today, mainnet planned for Q2 to Q3 2027)*

Deposit BTC as collateral. Borrow USDC up to 66% of your BTC's value. Interest accrues at market rates. Repay anytime and get your BTC back.

This is a loan against your Bitcoin savings, taken without giving up custody of your Bitcoin.

### Earn *(lender side of Writz Lend, live on testnet)*

Lend USDC to the Writz Lend pool and earn the interest Bitcoin borrowers pay. The rate is variable and follows how much of the pool is borrowed, so it is zero while nothing is borrowed. Withdraw your USDC and its interest at any time, up to what is not lent out at that moment. See [Writz Lend, For USDC Lenders](/products/writz-lend#for-usdc-lenders-earn).

Writz Lend is the only product today. Features planned for later are listed in [Vision](/roadmap/vision#planned-for-later).

---

## How Writz Compares

| | WBTC / tBTC | Stacks sBTC | Blend | **Writz** |
|---|---|---|---|---|
| Needs a custodian | Yes | Partial | N/A | **No** |
| Wraps your BTC | Yes | Yes | N/A | **No** |
| Works with real BTC | No | Partial | No | **Yes** |
| On Stellar | No | No | Yes | **Yes** |
| Native USDC output | No | No | Yes | **Yes** |

---

## The Moat

Writz's competitive position compounds with time:

- **Technical depth:** A Bitcoin SPV client on Soroban takes 12–18 months to build, audit, and deploy safely. A competitor starting today arrives after Writz is established with real TVL and ecosystem integrations.
- **SDK ecosystem lock-in:** The Writz Bitcoin SPV SDK is free for any Stellar protocol. Once wallets and protocols build on it, switching costs compound. Writz becomes load-bearing infrastructure for the entire Stellar ecosystem.

---

## Current Status

As of June 2026, Writz has completed Phase 1 - Foundation:

- `bitcoin-spv` and `writz-lend` deployed on testnet
- 623 tests passing across all modules
- Real Bitcoin transactions broadcast and confirmed on Bitcoin Signet

The protocol is not yet available on mainnet. Mainnet launch is targeted for Q2 to Q3 2027 (Phase 2), starting with a gated, TVL-capped release of Writz Lend. No trusted-setup ceremony is on that path.

**Privacy** is not part of the protocol. It is being designed as a separate, opt-in edition, in progress and on testnet only: see [Privacy edition (in progress)](/how-it-works/privacy-edition).

---

**Next:** [How Writz Works →](/introduction/how-writz-works) - A plain-English explanation anyone can follow.
