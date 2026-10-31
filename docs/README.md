# Writz Protocol Documentation

> **Bitcoin was built to be yours. Your loans should be too.**

Writz is a trustless Bitcoin lending protocol on Stellar. Lock real BTC. Borrow real USDC. No bridge, no custodian, no wrapped BTC.

*(Not a "first on Stellar" claim: Solv Protocol and Templar Protocol both have live BTC infrastructure on Stellar. Writz's differentiator is trustless, SPV-verified native BTC collateral that never leaves Bitcoin and carries a timelock exit the user controls alone. See `docs/research/market-landscape.md` for the current competitive picture.)*

---

## Find Your Path

| You are | Start here |
|---|---|
| New to Writz | [What is Writz? →](/introduction/what-is-writz) |
| Want to understand how it works (no jargon) | [How Writz Works →](/introduction/how-writz-works) |
| Ready to use Writz Lend | [Writz Lend Guide →](/products/writz-lend) |
| A developer building on Stellar | [Build on Writz →](/developers/integrate) |
| A Stellar protocol that needs Bitcoin verification | [SPV SDK →](/developers/spv-sdk) |
| A USDC holder who wants to supply the lending pool | [Lend USDC →](/products/writz-lend#for-usdc-lenders-earn) |
| An investor or grant reviewer | [Vision →](/roadmap/vision) |

---

## Documentation Map

### Introduction
- [What is Writz?](/introduction/what-is-writz) - The home metaphor. Plain English. 5 minutes.
- [The Problem](/introduction/the-problem) - Why public DeFi fails Bitcoin holders.
- [How Writz Works](/introduction/how-writz-works) - Anyone can understand this. No jargon.
- [Why Stellar, Why Now](/introduction/why-stellar-why-now) - The strategic window. Protocol X-Ray. First-mover.

### Products
- [Writz Lend](/products/writz-lend) - BTC collateral → USDC loan. Step-by-step guide.

### How It Works (Technical)
- [Bitcoin Side](/how-it-works/bitcoin-side) - P2WSH script, spending paths, co-signing architecture.
- [SPV Verification](/how-it-works/spv-verification) - Trustless Bitcoin transaction verification on Soroban.
- [Stellar Side](/how-it-works/stellar-side) - `bitcoin-spv` and `writz-lend`, interest model, USDC pool, oracle.
- [Privacy edition (in progress)](/how-it-works/privacy-edition) - Design of the separate, opt-in privacy edition. Testnet only, not part of v1.

### Developers
- [Build on Writz](/developers/integrate) - Prove a Bitcoin transaction from your contract or app, on testnet, in 15 minutes.
- [For AI Agents](/developers/for-ai-agents) - Exact IDs, signatures and verified examples for coding agents.
- [Quick Start](/developers/quick-start) - Clone, build, test, deploy in under 5 minutes.
- [SPV SDK](/developers/spv-sdk) - Free Bitcoin verification for any Stellar protocol.
- [Contract Reference](/developers/contract-reference) - All public interfaces, parameters, events.
- [Contributing](/developers/contribution-guide) - How to contribute code, docs, and security research.

### Security
- [Security Model](/security/security-model) - Trust assumptions, failure scenarios, what Writz can't do.
- [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped) - Where a light client differs from wrapped BTC and bridges, and where it shares their risks.
- [Audits](/security/audits) - Audit roadmap, target firms, Audit Bank process.
- [Bug Bounty](/security/bug-bounty) - Responsible disclosure. Up to $50,000 for critical findings.
- [STRIDE Threat Model](/security/stride-threat-model) - Threats by component, trust boundaries, mitigations.

### Roadmap
- [Vision](/roadmap/vision) - Where Writz goes by 2028.

### Research (Internal Reference)
- [Bitcoin SPV on Other Chains](/research/spv-implementations)
- [Market Landscape](/research/market-landscape)
- [Protocol X-Ray Capabilities](/research/protocol-x-ray-capabilities)
- [Soroban Compute Benchmarks](/research/soroban-compute-benchmarks)
- [Bitcoin Locking Script Design](/research/bitcoin-locking-script)
- [Oracle Design](/research/oracle-design)
- [Interest Rate Model](/research/interest-rate-model)
- [Liquidation Mechanism](/research/liquidation-mechanism)
- [Circom Circuit Design](/research/circom-circuit-design)
- [Relayer Incentive Design](/research/relayer-incentive-design)
- [Tokenomics & Fee Model](/research/tokenomics-fee-model)
- [Security Audit Strategy](/research/security-audit-strategy)
- [Regulatory Landscape](/research/regulatory-landscape)
- [Growth Strategy](/research/growth-strategy) - June 2026 note, replaced by [Go-to-market strategy](/go-to-market/overview).

---

## Current Status

**Phase:** 1 - Foundation (in progress, August 2026)

**The protocol's two contracts are deployed on Stellar testnet. 623 tests passing.** See `contracts/deployments/testnet.md` for verified calls and known gaps before further testing.

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO` |
| `writz-lend` | `CABF7VK7F25ZGDLV6EWSAU3NYQYKDQNDSJIISDMDZAUASMSXUADSHZGG` |

Both were redeployed on 2026-10-25 because testnet rent rose sharply; positions on the previous contracts were closed and their BTC released. See [Storage and TTL management](/how-it-works/stellar-side#storage-and-ttl-management).

The [privacy edition (in progress)](/how-it-works/privacy-edition) has its own testnet contracts, which `writz-lend` never calls:

| Contract | Address |
|---|---|
| `zk-verifier` | `CB5XAP6MF2GVVFATFTVCKVEXUODWWRQP4B3QFDMRTM55REP7N2YMXEUD` |
| `commitment-tree` | `CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM` |
