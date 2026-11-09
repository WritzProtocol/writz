# Writz Protocol Documentation

> **Bitcoin was built to be yours. Your loans should be too.**

Writz is a lending protocol on Stellar backed by native BTC. Lock real BTC on Bitcoin, borrow USDC on Stellar. No bridge, no custodian, no wrapped BTC. On testnet today.

---

## Find Your Path

| You are | Start here |
|---|---|
| New to Writz | [What is Writz? →](/introduction/what-is-writz) |
| Want to understand how it works (no jargon) | [How Writz Works →](/introduction/how-writz-works) |
| Ready to try Writz Lend on testnet | [Start here →](/guides/start-here) |
| A developer building on Stellar | [Build on Writz →](/developers/integrate) |
| A Stellar protocol that needs Bitcoin verification | [SPV SDK →](/developers/spv-sdk) |
| A USDC holder who wants to supply the lending pool | [Lend USDC →](/products/writz-lend#for-usdc-lenders-earn) |
| Want to know where Writz is going | [Vision →](/roadmap/vision) |

---

## Documentation Map

### Introduction
- [What is Writz?](/introduction/what-is-writz): the short version, in plain English.
- [The Problem](/introduction/the-problem): why borrowing against Bitcoin means trusting someone with it.
- [How Writz Works](/introduction/how-writz-works): a loan from deposit to release, without jargon.
- [Why Stellar, Why Now](/introduction/why-stellar-why-now): what Writz builds on, and why Stellar.

### Guides
- [Start here](/guides/start-here): what you need to try the testnet app, with free test coins.
- [Borrow](/guides/borrow), [Repay and release](/guides/repay-and-release) and [Lend](/guides/lend): click-by-click walkthroughs.

### Products
- [Writz Lend](/products/writz-lend): BTC collateral, USDC loans, parameters and the lender side.

### How It Works (Technical)
- [Bitcoin Side](/how-it-works/bitcoin-side): the P2WSH script, its spending paths and co-signing.
- [SPV Verification](/how-it-works/spv-verification): how Soroban verifies a Bitcoin transaction.
- [Stellar Side](/how-it-works/stellar-side): `bitcoin-spv` and `writz-lend`, the interest model, the USDC pool and the oracle.
- [Manual Emergency Recovery](/how-it-works/manual-emergency-recovery): take your BTC back alone once the timelock opens.

### Developers
- [Build on Writz](/developers/integrate): prove a Bitcoin transaction from your contract or app, on testnet.
- [For AI Agents](/developers/for-ai-agents): exact IDs, signatures and verified examples for coding agents.
- [Quick Start](/developers/quick-start): clone, build, test and deploy.
- [SPV SDK](/developers/spv-sdk): Bitcoin verification for any Stellar protocol, free to call.
- [Contract Reference](/developers/contract-reference): public functions, parameters and events.
- [Contributing](/developers/contribution-guide): how to contribute code, docs and security research.

### Security
- [Security Model](/security/security-model): trust assumptions, failure scenarios and what Writz cannot do.
- [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped): where a light client differs from wrapped BTC and bridges, and where it shares their risks.
- [Audits](/security/audits): audit scope, readiness and how reports will be published.
- [Bug Bounty](/security/bug-bounty): responsible disclosure. Cash rewards start with the mainnet launch.
- [STRIDE Threat Model](/security/stride-threat-model): threats by component, trust boundaries and mitigations.

### Roadmap
- [Vision](/roadmap/vision): where Writz goes by 2028.

---

## Current Status

**The protocol's two contracts are deployed on Stellar testnet. 845 tests pass across all modules.** See [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md) for verified calls and known gaps.

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO` |
| `writz-lend` | `CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS` |

Both were redeployed on 2026-10-25 because testnet rent rose sharply; positions on the previous contracts were closed and their BTC released. `writz-lend` was redeployed twice more, on 2026-11-01 for lender events that carry the scaled amount and the supply index, and on 2026-11-02 for read views that project interest to the current ledger; `bitcoin-spv` was not. See [Storage and TTL management](/how-it-works/stellar-side#storage-and-ttl-management).
