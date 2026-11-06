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
| Fees | Variable, often high | Low per transaction |
| Bitcoin lending today | Wrapped BTC in established markets | No trustless native-BTC lending yet |
| Bitcoin verification on chain | Possible, gas-heavy | Feasible within Soroban's compute budget |

Stellar is not the obvious choice. It is the *correct* choice for Writz specifically: a chain with native USDC, low fees, and no trustless native-BTC lending yet.

---

## The Timing Argument in One Sentence

The compute budget for on-chain Bitcoin verification was confirmed feasible. The Rust SPV library exists. Native USDC is live. No protocol on Stellar offers trustless native BTC collateral yet.

---

**Next:** [Writz Lend - the flagship product →](/products/writz-lend)
