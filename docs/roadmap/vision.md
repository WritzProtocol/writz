---
title: "Vision"
---

**By 2028, any Bitcoin holder should be able to borrow USDC against real BTC in minutes, from a phone, without giving up custody.**

That is the Writz vision. No custodian, no bridge, no wrapped BTC: a loan that starts with Bitcoin in your wallet and ends with USDC in your account, enforced by a Bitcoin script and Stellar smart contracts.

---

## Why This Vision Is Worth Building

Bitcoin is the largest crypto asset by market capitalization, and most of it has never been used in DeFi. Every option today requires one of two concessions: give your BTC to a custodian or signer set (WBTC, tBTC), or bridge it onto another chain as a wrapped token.

Writz removes both.

The BTC stays on Bitcoin, in a script that cannot move it without the user's signature. The loan happens on Stellar, where native USDC lives, and the deposit is verified there by an on-chain Bitcoin light client, not by a bridge or an oracle. If Writz disappears, a timelock in the Bitcoin script lets the user take the BTC back alone.

It is a different category from wrapped BTC, not a better wrapper.

---

## The Two-Layer Moat

Writz's position rests on technical depth that compounds over time.

### Layer 1: Time

Building a Bitcoin light client on Soroban, getting it audited and running it on mainnet takes time. A team starting now would also have to earn what Writz aims to have by then:

- A mainnet record with no security incidents
- Real TVL and on-chain metrics anyone can verify
- An open-source SPV SDK used by other Stellar projects

In a niche this specific, users have little reason to move from an audited protocol with a track record to an unproven one.

### Layer 2: Ecosystem Lock-in

The Writz Bitcoin SPV SDK is free infrastructure for the Stellar ecosystem. Every wallet that integrates it and every protocol that builds on it adds to the cost of switching away.

By the time there are 5 integrations, Writz is load-bearing infrastructure for Stellar's Bitcoin-awareness. By 10 integrations, Writz is the canonical answer to "how does Bitcoin work on Stellar?" Replacing it would take more than a better contract: every integration would have to migrate.

---

## Writz in 2028

### $100M+ TVL in Writz Lend

Bitcoin holders trust Writz because:
- The smart contracts have passed external audits
- Over a year of mainnet operation with zero critical incidents
- TVL grew progressively from $50K → $250K → $1M → $5M → $20M → $100M

The protocol generates real revenue: at $100M TVL and a 5% average borrow rate, with a 15% protocol fee, annual revenue is approximately $750,000 - enough to fund ongoing development, audits, and the insurance fund.

### The WRTZ Token - Real Yield, No Speculation

The WRTZ token launches at $5M TVL (Q2–Q3 2027), with a community-first structure:

- Fair IDO / Liquidity Bootstrapping Pool - no VC cliff dumps at steep discounts
- Real-yield mechanics: protocol revenue is used to buy and burn WRTZ from the open market
- Governance: WRTZ holders vote on TVL cap increases, fee adjustments, new product launches, and insurance fund payouts

This is not a token launched to raise money. It is a token launched to give ownership to the community that built the TVL.

### Stellar Ecosystem Infrastructure

The Writz Bitcoin SPV SDK is integrated into:
- Xverse (BTC wallet with a "Writz" button in the DeFi section)
- Varial, formerly Freighter (Stellar wallet with BTC collateral option)
- Lobstr (BTC yield product in the savings section)
- 7+ Stellar DeFi protocols using the SDK for Bitcoin verification

A Stellar SEP (Stellar Ecosystem Proposal) for Bitcoin SPV, co-authored by Writz, makes the verification interface a standard across the ecosystem.

### Institutional Presence

Five or more institutions, such as crypto funds, family offices and mining companies, each deposit $100K or more and use the protocol for treasury management.

---

## Planned for later

Writz has one product: Writz Lend. The SPV SDK is the open infrastructure behind it.

The features below are directions we want to explore after Writz Lend is live on mainnet. They are not products. None has a date, and none is promised.

- **Privacy.** A possible future direction.
- **Private conversion.** Turning Bitcoin into USDC directly, without Writz ever holding the Bitcoin. Nothing is built, and no design meets that condition yet.
- **Automatic yield.** Putting borrowed USDC to work without adding risk the borrower did not choose. Nothing is built.

---

## The Bigger Picture

Writz connects the largest crypto asset to a network built for payments and regulated stablecoins.

What starts as a lending protocol becomes infrastructure. The SPV SDK becomes the standard. The USDC loans become a gateway for BTC holders who have never touched DeFi.

That is the 2028 vision. Bitcoin deposits are already verified by a Soroban contract on testnet. The next step is the first USDC loan against real BTC on mainnet, targeted for Q2 to Q3 2027.
