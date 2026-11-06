---
title: "What is Writz?"
---

Bitcoin is where many people keep their savings. USDC is a dollar stablecoin used to pay and to move money.

**Writz connects the two on Stellar, without moving your Bitcoin off Bitcoin.**

You deposit real Bitcoin. You borrow real USDC. Your BTC stays in a Bitcoin script that you co-own with the protocol, and if Writz ever disappears, a timelock lets you take it back alone.

---

## The Short Version

Writz lets Bitcoin holders borrow USDC without:

- Giving their BTC to a custodian
- Wrapping their BTC into a synthetic token
- Trusting a bridge or a federation

The BTC stays on Bitcoin, locked by a Bitcoin Script that cannot move it without the user's signature. The USDC arrives on Stellar. The position lives in the `writz-lend` contract and is public on chain, as in any other lending market.

---

## Why This Hasn't Existed Before

Writz depends on two things that exist on Stellar today:

**1. Bitcoin SPV on Soroban.** A Soroban smart contract can check that a Bitcoin transaction happened, using Simplified Payment Verification: proof of work over a chain of Bitcoin block headers stored on Stellar, and a Merkle proof that places the transaction in a block. The work fits within Soroban's compute budget.

**2. Native USDC on Stellar.** Circle issues USDC natively on Stellar, not bridged and not synthetic. Writz borrowers receive the same USDC that payment apps and wallets on Stellar already use.

Writz combines them: native BTC collateral verified on Stellar, borrowed against in native USDC.

---

## What You Can Do With Writz

### Writz Lend *(on testnet today, mainnet planned for Q2 to Q3 2027)*

Deposit BTC as collateral. Borrow USDC up to about 66.7% of your BTC's value. Interest accrues at a variable rate set by how much of the pool is borrowed. Repay at any time and get your BTC back.

This is a loan against your Bitcoin savings, taken without giving up custody of your Bitcoin.

### Lend USDC *(lender side of Writz Lend, on testnet today)*

Lend USDC to the Writz Lend pool and earn the interest Bitcoin borrowers pay. The rate is variable and follows how much of the pool is borrowed, so it is zero while nothing is borrowed. Withdraw your USDC and its interest at any time, up to what is not lent out at that moment. See [Writz Lend, For USDC Lenders](/products/writz-lend#for-usdc-lenders-earn).

Writz Lend is the only product today. Features planned for later are listed in [Vision](/roadmap/vision#planned-for-later).

---

## How Writz Compares

| | WBTC | tBTC | Stacks sBTC | **Writz** |
|---|---|---|---|---|
| Who controls the BTC | Custodians | A threshold signer network | A signer set | **The script: the borrower's key plus the protocol key, or the borrower alone after the timelock** |
| Turns your BTC into a token on another chain | Yes | Yes | Yes | **No** |

---

## Current Status

Writz runs on Stellar testnet today:

- `bitcoin-spv` deployed on testnet since 2026-10-25, the current `writz-lend` since 2026-11-02
- 839 tests passing across all modules
- Deposits and releases broadcast and confirmed on Bitcoin signet

Writz Lend is not on mainnet. The mainnet launch is targeted for Q2 to Q3 2027, starting with low borrowing caps.

Positions are public on chain. Privacy is not part of the protocol.

---

**Next:** [How Writz Works →](/introduction/how-writz-works), a plain-English walkthrough.
