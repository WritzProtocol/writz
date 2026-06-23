# Research: Relayer Incentive Design

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Writz uses **stateless SPV** (no on-chain header chain), which means the header relay problem is substantially simpler than BTC Relay's approach. However, users still need a reliable source of Bitcoin block headers and Merkle proofs to construct their SPV proofs. This document designs the relayer service and its incentive model.

---

## The Stateless SPV Relayer Difference

### BTC Relay's failure (stateful approach)
BTC Relay required relayers to continuously submit every Bitcoin block header to Ethereum. When fee revenue dropped, relayers stopped. No headers = system dead.

### Writz's approach (stateless)
Writz does NOT store Bitcoin block headers on Stellar. Instead:
- Users provide the headers themselves at verification time
- The Soroban contract verifies the provided headers on-demand
- No continuous relay is required

**Implication:** The relayer is not a protocol-critical component — it's a **convenience service**. A user can fetch their own headers from any Bitcoin full node or public API. If the Writz relayer goes down, users can use alternative sources.

This fundamentally changes the risk profile from BTC Relay.

---

## What the Relayer Actually Does

When a user wants to prove a Bitcoin deposit to Soroban, they need:

1. The raw Bitcoin transaction (containing their P2WSH output)
2. The Merkle proof for that transaction within its block
3. The block header for that block
4. A chain of N block headers connecting that block to a recent, trusted checkpoint

The relayer is a service that:
- Maintains a connection to a Bitcoin full node
- Given a txid, fetches and packages all of the above into a ready-to-use SPV proof bundle
- Returns the bundle to the user's browser for submission to Soroban

---

## Relayer Architecture Options

### Option A: Writz-Operated Centralized Relayer

A single Bitcoin full node + REST API operated by Writz.

**Endpoint:**
```
GET /spv-proof/{txid}

Response:
{
  "raw_tx": "0200000001...",
  "merkle_proof": ["a1b2c3...", "d4e5f6...", ...],
  "tx_index": 42,
  "block_headers": ["00000020...", "00000020...", ...],  // 6 headers
  "block_height": 845123
}
```

**Pros:** Simple, fast, low cost, full control over reliability.
**Cons:** Centralization. If Writz's server is down, users can't easily generate proofs without technical knowledge.

**Mitigation:** Open the header fetching to any Bitcoin full node. Users who know what they're doing can query any public Bitcoin node (mempool.space API, Blockstream Esplora, their own node). The Writz relayer is a convenience, not a dependency.

### Option B: Decentralized Relayer Network

Multiple independent operators run relayer nodes. Users can query any of them. Operators are paid per proof request.

**Pros:** No single point of failure. Censorship resistant.
**Cons:** Adds complexity. Overkill for Phase 1 where user volume is small.

**Recommendation:** Start with Option A (Phase 1), with a public API that any third party can independently implement. Design the API spec openly so competitors or community members can run alternative relayers. Progressively decentralize as the protocol grows.

### Option C: Pure User Self-Service

No Writz-operated relayer. The frontend guides users to fetch their own proof from public APIs.

**Pros:** Maximum decentralization. No ongoing infrastructure cost.
**Cons:** Very poor UX. Most users cannot fetch and format Merkle proofs manually.

**Verdict:** Suitable as a fallback mode, not as the primary experience.

---

## Relayer Incentive Model (for Decentralized Phase 2)

When Writz launches a decentralized relayer network, relayers need economic incentives to operate reliably.

### Fee model

**Per-proof fee:** Users pay a small fee (e.g., 1,000 satoshis in USDC equivalent ~$1) when requesting a proof bundle. This fee is:
- Charged in USDC on Stellar (simplest for users)
- Collected by the PrivateLend contract as part of the deposit transaction
- Distributed to the relayer that provided the proof bundle

**Collateral requirement:** Relayers post a bond (e.g., $500 in USDC) when registering. If they provide invalid data that causes a failed transaction, the bond is partially slashed and distributed to the affected user.

**Reputation system:** Relayers accumulate a success score. High-reputation relayers get preferential routing from the Writz frontend.

### Liveness guarantee

Unlike BTC Relay, stateless SPV doesn't require 24/7 relayer availability. Users only need a relayer when making a transaction. A relayer that's offline 90% of the time is still useful — as long as it responds when a user needs it.

**Minimum viable liveness:** A relayer that responds within 60 seconds and has >99% uptime over 30-day windows can participate.

---

## Public Data Sources (User Fallback)

If the Writz relayer is unavailable, users can construct their own SPV proof from public sources:

| Source | What it provides | How to use |
|---|---|---|
| **Blockstream Esplora API** | Raw transaction, Merkle proof, block header | `GET https://blockstream.info/api/tx/{txid}/merkle-proof` |
| **mempool.space API** | Same as Blockstream | `GET https://mempool.space/api/tx/{txid}/merkle-proof` |
| **Bitcoin Core RPC** | Full node access, all data | `bitcoin-cli gettxout`, `getblock`, `gettxoutproof` |

Writz's frontend should include a "Manual proof submission" mode that walks technical users through fetching their own data from these sources.

---

## Alternative: zkRelay (Phase 2+ Consideration)

Research found **zkRelay** — a ZK-SNARK-based relay that batches Bitcoin header validation off-chain. Instead of submitting 6 raw headers, a prover submits one ZK proof that 6 (or 504) headers are all valid.

**Cost reduction:** 187× cheaper than per-header verification (achieved in Ethereum research).

**For Writz:** If the raw block header chain verification becomes a cost concern (especially for headers with very high difficulty requiring large PoW numbers), zkRelay-style header batching could significantly reduce the Soroban transaction cost of the SPV verification step.

**Not for Phase 1.** zkRelay adds circuit complexity and a trusted setup. Start with raw header verification; switch to zkRelay batching if needed in Phase 2.

---

## Summary

| Decision | Choice | Rationale |
|---|---|---|
| Relayer type (Phase 1) | Writz-operated API | Simple, fast to ship, adequate for early users |
| Relayer type (Phase 2) | Decentralized with fee incentives | As user volume grows, decentralize for resilience |
| Fallback | User self-service from public APIs | Eliminates complete dependency on Writz relayer |
| Fee model | $1 per proof request (paid in USDC) | Fair compensation, low burden on user |
| zkRelay adoption | Phase 2+ if needed | Only if header verification becomes a cost bottleneck |
| Liveness guarantee | Convenience service, not critical path | Stateless SPV means any Bitcoin data source works |

---

*Last updated: 2026-06-22*
*Sources: [zkRelay paper](https://eprint.iacr.org/2020/433) · [BTC Relay GitHub](https://github.com/ethereum/btcrelay) · [Blockstream Esplora API](https://github.com/Blockstream/esplora) · [TrustBlink: zkSNARK relay](https://link.springer.com/chapter/10.1007/978-981-95-3543-9_7)*
