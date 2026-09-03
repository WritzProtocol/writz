# Writz Protocol Documentation

> **Bitcoin was built to be yours. Your loans should be too.**

Writz is a trustless Bitcoin lending protocol on Stellar. Lock real BTC. Borrow real USDC. Every position stays private - always.

*(Not a "first on Stellar" claim: Solv Protocol and Templar Protocol both have live BTC infrastructure on Stellar. Writz's differentiator is combining trustless SPV-verified native BTC collateral with ZK-private positions - a combination neither of them offers today. See `docs/research/market-landscape.md` for the current competitive picture.)*

---

## Find Your Path

| You are | Start here |
|---|---|
| New to Writz | [What is Writz? →](introduction/what-is-writz.md) |
| Want to understand how it works (no jargon) | [How Writz Works →](introduction/how-writz-works.md) |
| Ready to use PrivateLend | [PrivateLend Guide →](products/privatelend.md) |
| A developer building on Stellar | [Quick Start →](developers/quick-start.md) |
| A Stellar protocol that needs Bitcoin verification | [SPV SDK →](developers/spv-sdk.md) |
| An institution exploring Proof of Reserve | [ZK Proof of Reserve →](products/zk-proof-of-reserve.md) |
| An investor or grant reviewer | [Vision →](roadmap/vision.md) |

---

## Documentation Map

### Introduction
- [What is Writz?](introduction/what-is-writz.md) - The home metaphor. Plain English. 5 minutes.
- [The Problem](introduction/the-problem.md) - Why public DeFi fails Bitcoin holders.
- [How Writz Works](introduction/how-writz-works.md) - Anyone can understand this. No jargon.
- [Why Stellar, Why Now](introduction/why-stellar-why-now.md) - The strategic window. Protocol X-Ray. First-mover.

### Products
- [PrivateLend](products/privatelend.md) - BTC collateral → private USDC loan. Step-by-step guide.
- [Dark Swap](products/dark-swap.md) - Private BTC↔USDC conversion (Phase 3).
- [BTC Savings](products/btc-savings.md) - BTC collateral + USDC yield (Phase 3).
- [ZK Proof of Reserve](products/zk-proof-of-reserve.md) - Enterprise B2B attestation product.

### How It Works (Technical)
- [Bitcoin Side](how-it-works/bitcoin-side.md) - P2WSH script, spending paths, co-signing architecture.
- [SPV Verification](how-it-works/spv-verification.md) - Trustless Bitcoin transaction verification on Soroban.
- [ZK Privacy Layer](how-it-works/zk-privacy-layer.md) - Groth16 circuits, Poseidon commitments, nullifiers.
- [Stellar Side](how-it-works/stellar-side.md) - Four contracts, interest model, USDC pool, oracles.

### Developers
- [Quick Start](developers/quick-start.md) - Clone, build, test, deploy in under 5 minutes.
- [SPV SDK](developers/spv-sdk.md) - Free Bitcoin verification for any Stellar protocol.
- [Contract Reference](developers/contract-reference.md) - All public interfaces, parameters, events.
- [Contributing](developers/contribution-guide.md) - How to contribute code, docs, and security research.

### Security
- [Security Model](security/security-model.md) - Trust assumptions, failure scenarios, what Writz can't do.
- [Audits](security/audits.md) - Audit roadmap, target firms, Audit Bank process.
- [Bug Bounty](security/bug-bounty.md) - Responsible disclosure. Up to $50,000 for critical findings.

### Roadmap
- [Vision](roadmap/vision.md) - Where Writz goes by 2028. The three-layer moat.
- [Phases](roadmap/phases.md) - Phase-by-phase execution plan with milestones and metrics.

### Research (Internal Reference)
- [Bitcoin SPV on Other Chains](research/spv-implementations.md)
- [Market Landscape](research/market-landscape.md)
- [Protocol X-Ray Capabilities](research/protocol-x-ray-capabilities.md)
- [Soroban Compute Benchmarks](research/soroban-compute-benchmarks.md)
- [Bitcoin Locking Script Design](research/bitcoin-locking-script.md)
- [Oracle Design](research/oracle-design.md)
- [Interest Rate Model](research/interest-rate-model.md)
- [Liquidation Mechanism](research/liquidation-mechanism.md)
- [Circom Circuit Design](research/circom-circuit-design.md)
- [Relayer Incentive Design](research/relayer-incentive-design.md)
- [Tokenomics & Fee Model](research/tokenomics-fee-model.md)
- [Security Audit Strategy](research/security-audit-strategy.md)
- [Regulatory Landscape](research/regulatory-landscape.md)
- [Growth Strategy](research/growth-strategy.md)

### SCF Application (draft - not submitted, no short-term plan to submit)
- [Application](scf/application.md) - Full Open Track Build Award application text.
- [Milestone Plan](scf/milestone-plan.md) - Four-tranche deliverables and verification steps.
- [STRIDE Threat Model](scf/stride-threat-model.md) - Security threat model for SCF review.

---

## Current Status

**Phase:** 1 - Foundation (in progress, August 2026)

**All four contracts are deployed on Soroban testnet. 397 tests passing.** See `contracts/deployments/testnet.md` for verified calls and known gaps before further testing.

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| `zk-verifier` | `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| `commitment-tree` | `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP` |
| `private-lend` | `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR` |
