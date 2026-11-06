---
title: "Why Stellar, Why Now"
---

Writz does not bring Bitcoin to another chain. It makes a Bitcoin transaction verifiable on Stellar, where native USDC already lives.

The difference matters. Wrapped-token systems such as WBTC, tBTC and sBTC move BTC into the hands of a custodian or a signer set and issue a token on another chain in its place. Writz leaves the BTC on Bitcoin, locked in a script the borrower holds a key to. Only the proof that the BTC is locked crosses to Stellar.

This page explains what makes that practical today, and why Stellar is the chain for it.

---

## What Writz Builds On

### Soroban compute for Bitcoin verification

Verifying a Bitcoin transaction on chain means double-SHA256 over block headers, proof-of-work and difficulty checks, and a Merkle inclusion proof. Soroban's compute budget fits that work: `bitcoin-spv` keeps a compact Bitcoin header chain on Stellar, and `writz-lend` verifies a deposit against it in a single contract call. The verification code is written in Rust on the Soroban SDK alone, with no external Bitcoin library.

### Native USDC

Circle issues USDC natively on Stellar. It is not bridged and not wrapped. A Writz borrower receives the same USDC that payment companies and wallets on Stellar already use, so there is no bridge to break and no peg to maintain.

About $327 million of USDC circulates on Stellar (DefiLlama, November 2026).

### A mature smart contract platform

Soroban has run on Stellar mainnet since 2024. Protocol 23 (Whisk, mainnet September 2025) added parallel transaction execution, unified events and changes to state archival. Writz builds on:

- A Rust SDK and a CLI that follow each protocol release
- Published resource limits and fees, so the cost of a verification can be measured before deployment
- Active lending and liquidity protocols. Blend, the largest lending protocol on Stellar, holds about $120 million in its V2 pools; Aquarius, a liquidity network, about $38 million; DeFindex, a vault protocol, about $19 million (DefiLlama, November 2026)

### Protocol signers

Today one protocol key co-signs Bitcoin releases. Writz plans a 2-of-3 protocol side written into the P2WSH script itself, so no single key can co-sign a release. The signing policy will be published.

---

## Why Not Ethereum?

The natural question is why build on Stellar rather than Ethereum, where most Bitcoin in DeFi sits today.

| Factor | Ethereum | Stellar |
|---|---|---|
| Native USDC | Yes | Yes |
| Bitcoin lending today | Wrapped BTC in established markets | No lending against native BTC yet |
| Bitcoin verification on chain | Possible, costly in gas | Fits Soroban's compute budget |

Ethereum already has deep markets for wrapped BTC. Stellar has native USDC and no lending against native BTC yet. That gap is the one Writz fills.

---

## The Timing Argument in One Sentence

On-chain Bitcoin verification fits Soroban's compute budget, native USDC is live on Stellar, and no protocol on Stellar offers native BTC as collateral yet.

---

**Next:** [Writz Lend, the lending product →](/products/writz-lend)
