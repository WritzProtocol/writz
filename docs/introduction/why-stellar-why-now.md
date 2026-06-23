# Why Stellar, Why Now

Writz is not bringing Bitcoin to DeFi. Writz is making Bitcoin verifiable — on the most compliance-friendly blockchain that has ever shipped ZK proofs to mainnet.

That distinction matters. "Bringing Bitcoin to DeFi" is what every wrapped-token protocol tries to do — WBTC, tBTC, sBTC. They all require trusting someone to hold the real BTC. Writz makes the Bitcoin transaction itself verifiable on Stellar, without moving the BTC or trusting anyone. The BTC stays on Bitcoin. Only the proof crosses chains.

This was not possible until 2026. Here is why it is possible now — and why Stellar is the right chain.

---

## The Infrastructure That Had to Exist First

### Protocol X-Ray — January 2026

Stellar launched Protocol X-Ray in January 2026, introducing zero-knowledge proof verification to Soroban smart contracts. Specifically: a Soroban contract can now validate a Groth16 proof over the BN254 curve using native host functions.

This is the technical foundation of Writz's privacy layer. Without Protocol X-Ray, ZK-private positions on Soroban were impossible. With it, a Soroban contract can verify that a user's loan is properly collateralized — without ever learning the amount.

Protocol 26 (Yardstick), which followed, added BN254 multi-scalar multiplication as a host function — cutting ZK verification costs significantly. The compute budget for a full deposit transaction (SPV + ZK + state update) now fits comfortably in a single Soroban transaction.

### Native USDC — No Bridge Risk

Circle issues USDC natively on Stellar. This is not bridged USDC, not a synthetic representation, not a wrapped token. When a Writz user borrows, they receive the same USDC used by cross-border payment networks, fintechs, and financial institutions worldwide.

The output of Writz has real-world utility from day one. There is no bridge to break, no peg to maintain, no synthetic to redeem. The USDC simply exists on Stellar because Stellar is one of Circle's native USDC chains.

Stellar processes over $500 million in USDC volume per month. That is real liquidity, not speculative volume.

### Soroban — Production-Grade Smart Contracts

Stellar's Soroban smart contract platform reached production grade with Protocol 23 (September 2025), which introduced parallel transaction execution. By the time Writz began building, Soroban had:

- A mature Rust SDK with comprehensive documentation
- Billions of operations processed on mainnet
- Known compute costs and resource limits (benchmarked and published)
- A growing ecosystem of DeFi protocols (Blend, Phoenix DEX, and others)

Writz's Soroban contracts are written in Rust — the same language as the best Bitcoin SPV library in existence (`summa-tx/bitcoin-spv`). Porting the Bitcoin verification logic to Soroban was a natural fit.

### Protocol 27 — Delegation Infrastructure

Protocol 27 (Zipper), scheduled for July 2026, introduces `delegate_account_auth` — a mechanism that changes how the protocol co-signing key is structured. Writz's Phase 1 architecture is designed to upgrade cleanly after Protocol 27 ships, moving from a single HSM co-signing key toward a more decentralized delegation model.

---

## Why Not Ethereum?

The natural question is: why build on Stellar rather than Ethereum, where the existing BTCfi ecosystem lives?

| Factor | Ethereum | Stellar |
|---|---|---|
| ZK privacy infrastructure | Mature (Aztec, StarkNet) | Production-ready, compliance-friendly (Protocol X-Ray) |
| Native USDC | No (bridged) | Yes (Circle native issuance) |
| Gas costs | High — ZK proofs are expensive | Low — Stellar's fee structure makes per-tx ZK economical |
| Compliance hooks | Minimal | ASP framework (selective disclosure built in) |
| BTC DeFi competition | Saturated (WBTC, Aave, Compound) | Zero — the category doesn't exist on Stellar |
| Regulatory posture | Uncertain | Clear — Stellar SDF has regulatory relationships |

Stellar is not the obvious choice. It is the *correct* choice for Writz specifically: a chain with native USDC, compliance-grade ZK infrastructure, low fees, and no Bitcoin DeFi competition at all.

---

## The First-Mover Window

The BTCfi category on Stellar does not exist. There is no protocol today that handles real BTC as collateral or for trading on Stellar. The entire category is empty.

That window is 12–18 months wide. Building a Bitcoin SPV client on Soroban, running a Groth16 trusted setup ceremony, getting audited, and launching mainnet is not a weekend project. A well-funded team starting today would arrive in early-to-mid 2028 — by which time Writz will have:

- Established TVL and organic user growth
- An open-source SPV SDK integrated into Stellar wallets and protocols
- A trusted setup ceremony with public, verified transcripts
- A completed Audit Bank engagement with zero critical findings
- A community that has been using the protocol for over a year

The first protocol to make Bitcoin natively verifiable on Stellar will hold that position for years — not because of lock-in mechanics, but because infrastructure compounds. Every wallet that integrates the Writz SPV SDK, every protocol that builds on it, every user who has a working position: these are switching costs that accumulate with each passing month.

---

## The Timing Argument in One Sentence

Protocol X-Ray shipped in January 2026. The compute budget was confirmed feasible. The Rust SPV library exists. Native USDC is live. Stellar has no BTCfi competition. The window is open right now, and it will not stay open forever.

---

**Next:** [PrivateLend — the flagship product →](../products/privatelend.md)
