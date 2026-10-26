---
title: "Why Stellar, Why Now"
---

Writz is not bringing Bitcoin to DeFi. Writz is making Bitcoin verifiable on Stellar, where native USDC already lives.

That distinction matters. "Bringing Bitcoin to DeFi" is what every wrapped-token protocol tries to do - WBTC, tBTC, sBTC. They all require trusting someone to hold the real BTC. Writz makes the Bitcoin transaction itself verifiable on Stellar, without moving the BTC or trusting anyone. The BTC stays on Bitcoin. Only the proof crosses chains.

This was not possible until 2026. Here is why it is possible now - and why Stellar is the right chain.

---

## The Infrastructure That Had to Exist First

### Soroban compute for Bitcoin verification

Verifying a Bitcoin transaction on-chain means double-SHA256 over block headers, proof-of-work and difficulty checks, and a Merkle inclusion proof, all inside one Soroban transaction. Soroban's compute budget and Rust toolchain make that practical: `bitcoin-spv` keeps a compact header chain on Stellar and `writz-lend` verifies a deposit against it in a single call.

Stellar's Protocol X-Ray (January 2026) and Protocol 26 also added BN254 host functions for Groth16 verification. Writz v1 does not use them; they matter only to the separate [privacy edition (in progress)](/how-it-works/privacy-edition).

### Native USDC - No Bridge Risk

Circle issues USDC natively on Stellar. This is not bridged USDC, not a synthetic representation, not a wrapped token. When a Writz user borrows, they receive the same USDC used by cross-border payment networks, fintechs, and financial institutions worldwide.

The output of Writz has real-world utility from day one. There is no bridge to break, no peg to maintain, no synthetic to redeem. The USDC simply exists on Stellar because Stellar is one of Circle's native USDC chains.

Stellar processes over $500 million in USDC volume per month. That is real liquidity, not speculative volume.

### Soroban - Production-Grade Smart Contracts

Stellar's Soroban smart contract platform reached production grade with Protocol 23 (September 2025), which introduced parallel transaction execution. By the time Writz began building, Soroban had:

- A mature Rust SDK with comprehensive documentation
- Billions of operations processed on mainnet
- Known compute costs and resource limits (benchmarked and published)
- A growing ecosystem of DeFi protocols (Blend, Phoenix DEX, and others)

Writz's Soroban contracts are written in Rust - the same language as the best Bitcoin SPV library in existence (`summa-tx/bitcoin-spv`). Porting the Bitcoin verification logic to Soroban was a natural fit.

### Protocol 27 - Delegation Infrastructure

Protocol 27 (Zipper) introduced `delegate_account_auth`, which lets authority on the Stellar side be distributed across delegated accounts. On the Bitcoin side, Writz plans a 2-of-3 protocol side written into the P2WSH script itself, so no single key can co-sign a release; the signing policy will be published.

---

## Why Not Ethereum?

The natural question is: why build on Stellar rather than Ethereum, where the existing BTCfi ecosystem lives?

| Factor | Ethereum | Stellar |
|---|---|---|
| Native USDC | No (bridged) | Yes (Circle native issuance) |
| Fees | Variable, often high | Low per transaction |
| BTC DeFi competition | Saturated (WBTC, Aave, Compound) | Zero - the category doesn't exist on Stellar |
| Regulatory posture | Uncertain | Clear - Stellar SDF has regulatory relationships |

Stellar is not the obvious choice. It is the *correct* choice for Writz specifically: a chain with native USDC, low fees, and no trustless native-BTC lending yet.

---

## The First-Mover Window

*(Updated 2026-08-04 - see `docs/research/market-landscape.md` for the full competitive picture.)* The BTCfi category on Stellar is not empty anymore: Solv Protocol runs an audited, custodial wrapped-BTC deployment with real trading volume, and Templar Protocol has a live, audited Soroban vault plus native-BTC-without-wrapping lending tech already proven on NEAR. Neither offers what Writz does: **trustless, SPV-verified native BTC collateral that never leaves Bitcoin, with a timelock exit the user controls alone.** That is still open on Stellar today.

The window for a from-scratch entrant to replicate that combination is 12 to 18 months wide - building a Bitcoin SPV client on Soroban, getting audited, and launching mainnet is not a weekend project. But for Templar specifically, that window is materially shorter: their Stellar infrastructure and native-BTC tech already exist separately, so connecting them is integration work, not a from-scratch build. Testnet-to-mainnet speed is a real competitive variable against Templar, not just a generic risk. A well-funded team starting today would arrive in early-to-mid 2028 - by which time Writz will have:

- Established TVL and organic user growth
- An open-source SPV SDK integrated into Stellar wallets and protocols
- A completed external audit with zero open critical findings
- A community that has been using the protocol for over a year

The first protocol to make Bitcoin natively verifiable on Stellar will hold that position for years - not because of lock-in mechanics, but because infrastructure compounds. Every wallet that integrates the Writz SPV SDK, every protocol that builds on it, every user who has a working position: these are switching costs that accumulate with each passing month.

---

## The Timing Argument in One Sentence

The compute budget for on-chain Bitcoin verification was confirmed feasible. The Rust SPV library exists. Native USDC is live. No protocol on Stellar offers trustless native BTC collateral yet - but Templar Protocol already has the adjacent infrastructure live and in active development. The window is open right now, and it will not stay open forever.

---

**Next:** [Writz Lend - the flagship product →](/products/writz-lend)
