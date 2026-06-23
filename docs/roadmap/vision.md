# Vision

**In 2028, any Bitcoin holder in the world will be able to borrow USDC privately, in minutes, without giving up custody — from their phone.**

That is the Writz vision. No custody. No KYC. No public record of the loan. A transaction that starts with Bitcoin in your wallet and ends with USDC in your account, enforced entirely by math.

---

## Why This Vision Is Worth Building

Bitcoin is the world's largest crypto asset by market cap. Over 900 million people own it. The vast majority of them — 77% by most estimates — have never used it in DeFi.

Not because they don't want to. Because every option today requires one of two concessions: give your BTC to a custodian (WBTC, tBTC), or accept that your financial life is public (Aave, Compound, Blend).

Writz removes both barriers simultaneously.

The BTC stays on Bitcoin — secured by Bitcoin Script, accessible only by the user. The loan happens on Stellar — where native USDC lives, where ZK proof infrastructure exists, where compliance-grade privacy makes institutional participation possible. The position stays private — zero-knowledge proofs ensure that nobody watching the blockchain can see your collateral, your debt, or your liquidation threshold.

This is not an incremental improvement on existing BTCfi. It is a different category.

---

## The Three-Layer Moat

Writz's competitive position is not built on branding or funding. It is built on compounding technical depth.

### Layer 1 — Time

Building a Bitcoin SPV client on Soroban from scratch and getting it audited takes 12–18 months. A well-funded team starting today arrives in late 2027 — by which time Writz will have:

- Over a year of mainnet operation with no security incidents
- Real TVL, organic user growth, and verifiable on-chain metrics
- An open-source SPV SDK integrated into the Stellar ecosystem

The first-mover in a technical niche this specific tends to hold the position. The cost of switching from an established, audited protocol to an unproven one is too high for rational users.

### Layer 2 — The Trusted Setup Ceremony

The Groth16 ZK circuits require a one-time **trusted setup ceremony** — a multi-party computation event that is public, permanent, and irreplaceable. The ceremony produces verification keys that are baked into every Writz ZK proof. A competitor cannot "copy" Writz's ceremony — they need their own, with their own participants, their own public transcript, and their own community trust-building process.

This creates an asymmetric advantage: Writz's ceremony happens once, with community participation, and establishes cryptographic legitimacy. Building that trust takes time.

### Layer 3 — Ecosystem Lock-in

The Writz Bitcoin SPV SDK is free infrastructure for the Stellar ecosystem. Every Stellar wallet that integrates it, every protocol that builds on it, every developer who ships a product using it: these are switching costs that accumulate invisibly.

By the time there are 5 integrations, Writz is load-bearing infrastructure for Stellar's Bitcoin-awareness. By 10 integrations, Writz is the canonical answer to "how does Bitcoin work on Stellar?" Replacing it requires not just building a better contract — it requires convincing every integration partner to migrate simultaneously.

---

## Writz in 2028 — The Full Picture

### $100M+ TVL in PrivateLend

Bitcoin holders trust Writz because:
- The smart contracts have passed two Audit Bank engagements (initial + Growth Audit)
- Over a year of mainnet operation with zero critical incidents
- TVL grew progressively from $50K → $250K → $1M → $5M → $20M → $100M
- The ZK privacy has been validated in practice — no position has ever been traced on-chain

The protocol generates real revenue: at $100M TVL and a 5% average borrow rate, with a 15% protocol fee, annual revenue is approximately $750,000 — enough to fund ongoing development, audits, and the insurance fund.

### The WRTZ Token — Real Yield, No Speculation

The WRTZ token launches at $5M TVL (Q2–Q3 2027), with a community-first structure:

- Fair IDO / Liquidity Bootstrapping Pool — no VC cliff dumps at steep discounts
- Real-yield mechanics: protocol revenue is used to buy and burn WRTZ from the open market
- Governance: WRTZ holders vote on TVL cap increases, fee adjustments, new product launches, and insurance fund payouts

This is not a token launched to raise money. It is a token launched to give ownership to the community that built the TVL.

### The Full Product Suite

By 2028, all four products are live:

- **PrivateLend** — the flagship, proven, at $100M TVL
- **Dark Swap** — processing $10M+/month in BTC-to-USDC conversions, capturing a category that currently requires KYC-gated exchanges
- **BTC Savings** — serving retail and institutional Bitcoin holders who want USDC yield without selling
- **ZK Proof of Reserve** — 20+ enterprise customers paying monthly subscriptions

### Stellar Ecosystem Infrastructure

The Writz Bitcoin SPV SDK is integrated into:
- Xverse (BTC wallet with a "Writz" button in the DeFi section)
- Freighter (Stellar wallet with BTC collateral option)
- Lobstr (BTC yield product in the savings section)
- 7+ Stellar DeFi protocols using the SDK for Bitcoin verification

Writz has proposed and is co-authoring a Stellar SEP (Standards Evolution Proposal) for Bitcoin SPV on Stellar — establishing the verification interface as a standard across the ecosystem.

### Institutional Presence

Writz has 5+ institutional deposits of $100K+ each — crypto funds, family offices, and mining companies using the protocol for treasury management. The ZK privacy layer makes institutional participation possible: no competitor can see positions, no front-running risk, compliance documentation available via ASP selective disclosure.

---

## The Bigger Picture

Writz is not just a product. It is the protocol that connects the world's largest crypto asset to the world's most compliance-friendly blockchain.

Bitcoin is the foundation. Stellar is the network. ZK is the fence. The house is where the financial future lives.

What starts as a lending protocol becomes infrastructure. The SPV SDK becomes the standard. The USDC loans become a gateway for BTC holders who have never touched DeFi. The ZK privacy layer becomes the template for how all sensitive DeFi should work — not just for crypto, but for any financial activity that deserves confidentiality.

That is the 2028 vision. The first step is a single Bitcoin transaction, verified by a Soroban contract, followed by the first private USDC loan issued against real BTC collateral.

That step is months away.

---

**See the execution plan:** [Phases →](phases.md)
