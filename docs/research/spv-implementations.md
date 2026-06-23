# Research: Bitcoin SPV Implementations on Other Chains

**Author:** Justin (Business Analyst)
**Date:** 2026-06-22
**Status:** Complete — initial survey
**Relevance:** Directly informs Writz Protocol's core technical approach

---

## Overview

Bitcoin SPV (Simplified Payment Verification) allows a system to verify that a Bitcoin transaction occurred without running a full Bitcoin node. It works by checking a Merkle proof against a block header — a computationally cheap operation that can be performed inside a smart contract.

This document surveys every meaningful attempt to implement Bitcoin SPV verification on another blockchain, extracting lessons that directly apply to building the SPV client on Stellar's Soroban.

---

## 1. BTC Relay — Ethereum (2016)

**Status:** Deprecated / inactive
**Chain:** Ethereum (Solidity)
**Repository:** [github.com/ethereum/btcrelay](https://github.com/ethereum/btcrelay)

### What it was

BTC Relay was the first implementation of a Bitcoin light client on another blockchain. It stored Bitcoin block headers in an Ethereum smart contract, building a mini Bitcoin chain on Ethereum. Other contracts could then verify that a specific BTC transaction was included in a confirmed block.

### How it worked

1. **Relayers** submitted Bitcoin block headers to the Ethereum contract
2. The contract maintained a chain of verified headers
3. Any Ethereum application could query the contract to verify a BTC transaction using a Merkle proof
4. Relayers were compensated with fees when their submitted headers were used for verification

### Why it failed

| Problem | Detail |
|---|---|
| **Relayer incentive failure** | When usage dropped, fees dried up. Relayers had no reason to keep submitting headers. The system became stale and stopped tracking Bitcoin. |
| **Gas cost at scale** | Storing every Bitcoin block header on Ethereum was expensive. Each header is 80 bytes, but Ethereum storage costs made this economically unfeasible at high throughput. |
| **No liveness guarantee** | There was no mechanism to ensure headers would always be submitted. The system had a single point of liveness failure. |
| **Orphan chain handling** | Bitcoin occasionally produces orphan blocks (temporary forks). The contract needed to handle reorgs, which added significant complexity. |

### What worked

- The **cryptographic verification was correct** — Merkle proof validation worked as designed
- The **SPV approach was sound** — the concept proved valid even if the implementation had issues
- It demonstrated that cross-chain Bitcoin verification was technically possible

### Key lesson for Writz

> The cryptographic core is not the problem. **Relayer incentive design is the #1 existential risk.** Writz must build economic incentives for header relaying directly into the protocol fee structure from day one.

---

## 2. summa-tx/bitcoin-spv — Multi-chain (2019–present)

**Status:** Actively maintained (last update: 2024)
**Chains:** EVM (Ethereum, Celo), Cosmos SDK, others
**Repository:** [github.com/summa-tx/bitcoin-spv](https://github.com/summa-tx/bitcoin-spv)

### What it is

A low-level toolkit for Bitcoin SPV proof verification. Unlike BTC Relay, it does NOT maintain a chain of block headers on-chain. Instead, it verifies a **specific slice of headers** provided at call time — a "stateless" approach.

Available implementations:
- **Solidity** — for EVM chains
- **Rust** — directly applicable to Soroban ⭐
- **Go** — for Cosmos SDK chains
- **Python** — for tooling
- **JavaScript/ES6** — for off-chain tooling

### The stateless SPV insight

Traditional SPV (BTC Relay) is *stateful*: it stores and tracks the full Bitcoin header chain on-chain. This is expensive and creates liveness dependency.

Stateless SPV shifts the storage burden off-chain. The caller provides:
1. A set of Bitcoin block headers proving sufficient proof-of-work
2. A Merkle inclusion proof for their specific transaction

The contract verifies everything in a single call without storing anything permanently.

**Tradeoff:** Stateless SPV is cheaper and simpler but requires the caller to provide valid headers. It assumes a reasonably honest environment (the Bitcoin network consensus provides this guarantee implicitly).

### What this means for Writz

This is the **most directly relevant existing work**. The Rust library (`bitcoin-spv` in Rust) is written in the same language as Soroban contracts. It provides:

- `validateHeader()` — verifies a Bitcoin block header is valid (correct PoW, correct format)
- `validateHeaderChain()` — verifies a sequence of headers forms a valid chain
- `prove()` — verifies a transaction is included in a block via Merkle proof
- `extractTxOutputValue()` — extracts the output value from a Bitcoin transaction

**Recommended action:** Evaluate the Rust implementation of `summa-tx/bitcoin-spv` as the starting point for the Soroban SPV contract, rather than implementing from scratch.

---

## 3. Interlay / interBTC — Polkadot (2021–present)

**Status:** Active — deployed on Polkadot (Interlay) and Kusama (Kintsugi)
**Chain:** Substrate/Polkadot (Rust)
**Repository:** [github.com/interlay/interbtc](https://github.com/interlay/interbtc)
**Spec:** [github.com/interlay/interbtc-spec](https://github.com/interlay/interbtc-spec)

### What it is

The most complete production implementation of trustless BTC DeFi on another chain. interBTC is a 1:1 Bitcoin-backed asset secured by a network of decentralized vault operators who lock collateral (DOT/KSM) as insurance.

### Architecture

```
Bitcoin Network              Polkadot/Substrate
───────────────              ──────────────────────────
User BTC Wallet              BTC-Relay pallet (SPV)
      │                             │
      │  BTC → Vault address        │  Verifies Bitcoin tx
      └────────────────────────────►│  via Merkle proof
                                    ▼
                          Issue pallet (mints iBTC)
                                    │
                                    ▼
                          Vault operators (collateralized)
                          If vault steals BTC →
                          collateral slashed → user repaid
```

### Key innovations

**Collateralized vault system:** Vault operators lock overcollateralized DOT/KSM. If they steal the BTC, their collateral is automatically slashed and distributed to the user. This solves the "what if the custodian steals the BTC?" problem without requiring trustlessness at the cryptographic level.

**BTC-Relay pallet:** The SPV verification component is implemented as a Substrate pallet (module) in Rust. It maintains a chain of Bitcoin block headers on-chain and provides inclusion proof verification. Similar to BTC Relay but in a more efficient Rust/Substrate environment.

**Relayer incentives:** Anyone can submit Bitcoin headers and earn fees. The system is permissionless for relayers.

### Challenges

- Polkadot ecosystem adoption has been slower than expected
- Vault operator bootstrapping is a chicken-and-egg problem
- Collateralization requirements can be capital-inefficient for vault operators

### Key lessons for Writz

| Lesson | Application |
|---|---|
| The vault collateral model solves theft risk | Writz can consider a similar model: relayer/vault operators stake USDC or XLM as insurance |
| Header chain maintenance in Rust is feasible | The BTC-Relay pallet in Rust is a direct reference for the Soroban implementation |
| Permissionless relayers with fee incentives work | Design the relayer fee model into the Writz protocol from the start |
| Polkadot's Rust environment is closest to Soroban | The interBTC Rust code is the most transferable reference for Writz |

---

## 4. Solana BTC SPV — Experimental (2020–2021)

**Status:** Minimal maintenance
**Chain:** Solana
**Packages:** `solana-btc-spv-program` (v1.2.32), `solana-btc-spv-api` (v0.19.1)
**Reference:** [lib.rs/crates/solana-btc-spv-program](https://lib.rs/crates/solana-btc-spv-program)

### What it was

An experimental implementation of Bitcoin SPV verification as a Solana on-chain program. There was also an open GitHub issue on the main Solana repository proposing a "marketplace for Bitcoin transaction proofs" where users could request and providers could supply SPV proofs.

### Why it didn't progress

- Never achieved production readiness or meaningful adoption
- Solana's programming model at the time made on-chain Bitcoin header verification expensive in terms of compute units
- The ecosystem prioritized other infrastructure

### Key lesson for Writz

Solana attempted this and stalled — not because the idea was wrong, but because the ecosystem incentives and developer focus were elsewhere. Stellar's situation is different: the SDF actively wants BTC to enter the ecosystem, and Soroban's fee model is more favorable.

---

## 5. Succinct Labs SP1 + BitVM — Bitcoin-Native ZK (2024–2026)

**Status:** Active / cutting-edge
**Direction:** ZK proofs ON Bitcoin (reverse direction)
**References:**
- [blog.succinct.xyz/bitcoin-sp1](https://blog.succinct.xyz/bitcoin-sp1/)
- [zkBitcoin on zksecurity.xyz](https://blog.zksecurity.xyz/posts/zkbitcoin/)

### What it is

SP1 is a zkVM (zero-knowledge virtual machine) that can prove the execution of arbitrary Rust programs. It is optimized for Bitcoin. Combined with **BitVM** — a computing paradigm that allows Bitcoin to verify ZK proofs without changing Bitcoin's consensus rules — it enables a new class of trust-minimized Bitcoin bridges.

### How it works

BitVM uses an optimistic challenge-response model:
1. A prover claims "I executed program X with result Y"
2. Anyone can challenge this claim on Bitcoin
3. If the claim is false, the challenger wins the prover's bond
4. If no challenge succeeds, the claim is accepted

This allows Bitcoin to effectively verify ZK proofs by making fraud economically unviable rather than cryptographically impossible.

### Why this matters for Writz (long-term)

This is the **long-term convergence point** of ZK and Bitcoin. Today, Writz uses an SPV client on Soroban to verify Bitcoin state from Stellar's side. In the future, BitVM + SP1 could enable the reverse: Bitcoin verifying state from Stellar, enabling fully trustless bidirectional verification.

### Current limitations

- BitVM is still experimental — real-world deployments are limited
- Proof generation for complex programs can take minutes
- The challenge-response model adds latency and requires capital at risk
- Not ready for production DeFi today

### Key lesson for Writz

This is the **Phase 3 vision** for Writz Protocol — not the starting point. Track actively. When BitVM matures to production readiness, Writz should be the first protocol on Stellar to integrate it.

---

## Comparative Summary

| Project | Chain | Approach | Status | Rust Code? | Lessons Weight |
|---|---|---|---|---|---|
| **BTC Relay** | Ethereum | Stateful headers on-chain | Deprecated | No (Solidity) | High — what NOT to do |
| **summa-tx/bitcoin-spv** | Multi-chain | Stateless SPV toolkit | Active | ✅ Yes | Very high — direct reference |
| **Interlay/interBTC** | Polkadot | SPV + collateralized vaults | Active | ✅ Yes | Very high — closest to Writz |
| **Solana BTC SPV** | Solana | Experimental program | Minimal | ✅ Yes | Medium — shows pitfalls |
| **SP1 + BitVM** | Bitcoin-native | ZK proofs on Bitcoin | Cutting-edge | ✅ Yes | Medium — long-term vision |

---

## Critical Findings for Writz Protocol

### 1. Start with stateless SPV (summa-tx approach)
Don't build a stateful header chain — it's expensive and creates relayer dependency. Use stateless SPV where the caller provides headers at verification time. The Soroban contract only needs to verify the math, not store state.

### 2. The Rust ecosystem is already there
Both `summa-tx/bitcoin-spv` (Rust) and `interbtc` (Rust/Substrate) are written in Rust. Soroban contracts are written in Rust. This is a significant advantage — the hardest parts of the implementation have precedent in the same language.

### 3. Relayer incentives must be designed from day 0
Every failed implementation either ignored relayer incentives or added them as an afterthought. For stateless SPV, relayers are less critical (no on-chain header chain to maintain), but someone still needs to provide valid headers to users. A small fee mechanism for header provision should be designed into the protocol.

### 4. Bitcoin confirmation time is a UX problem, not a technical one
6 confirmations ≈ 60 minutes. Writz should offer tiered confirmation options:
- **Fast lane:** 3 confirmations (~30 min) with a higher protocol fee and smaller max deposit
- **Standard lane:** 6 confirmations (~60 min) with standard fees

### 5. The SPV math is solved — focus engineering effort on economics
The cryptographic verification (SHA256d, Merkle proofs, header validation) is well-understood and implemented. The unsolved problems are: incentive design, reorg handling, UX around Bitcoin's slow finality, and the BTC locking mechanism on the Bitcoin side.

---

## Recommended Next Steps

1. **Fork and study** the Rust implementation of `summa-tx/bitcoin-spv` — map every function to what Writz needs
2. **Read the interBTC specification** (`interlay/interbtc-spec`) — it's the most complete formal specification of a trustless BTC bridge and directly applicable
3. **Prototype stateless SPV verification** in a Soroban contract on testnet — target: verify a single mainnet Bitcoin transaction
4. **Design the P2WSH locking script** — the Bitcoin-side of the mechanism that prevents users from moving BTC after depositing

---

*Last updated: 2026-06-22*
*Sources: [BTC Relay](https://github.com/ethereum/btcrelay) · [summa-tx/bitcoin-spv](https://github.com/summa-tx/bitcoin-spv) · [interlay/interbtc](https://github.com/interlay/interbtc) · [Succinct Labs SP1](https://blog.succinct.xyz/bitcoin-sp1/) · [SoK: Blockchain Light Clients](https://fc22.ifca.ai/preproceedings/176.pdf)*
