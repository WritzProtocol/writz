# Research: Soroban Compute Cost & Resource Limits

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete
**Roadmap task:** Phase 0.3

---

## Overview

Before writing a single line of Writz contract code, we need to know whether the core operations — Bitcoin SPV verification and ZK proof verification — are feasible within Soroban's resource constraints. This document establishes the cost baseline.

---

## Soroban Resource Model

Soroban fees are determined by **six resource dimensions**, each metered independently:

| Resource | What it measures | Fee type |
|---|---|---|
| **CPU Instructions** | Total Wasm + host instructions executed | Non-refundable |
| **Ledger Entry Reads** | Number of ledger keys read | Non-refundable |
| **Ledger Entry Writes** | Number of ledger keys written | Non-refundable |
| **Read Bytes** | Total bytes read from ledger | Non-refundable |
| **Write Bytes** | Total bytes written to ledger | Non-refundable |
| **Transaction Size** | Serialized transaction size | Non-refundable |
| **Events & Return Value** | Size of emitted events | Refundable |
| **Ledger Space Rent** | Storage rent for persistent entries | Refundable |

**Key insight:** Only Events and Ledger Space Rent are refundable. CPU instructions are always paid, even if the transaction fails after the first instruction. This means simulation before submission (`simulateTransaction`) is critical for estimating costs accurately.

---

## CPU Instruction Limits

### Per-transaction budget (Protocol 23+, parallel execution era)

Based on current Stellar documentation and Protocol 26 mainnet parameters:

| Parameter | Value |
|---|---|
| Max instructions per transaction | ~100 million (approximate mainnet) |
| Typical Groth16 SNARK verification | ~40 million instructions |
| Protocol 26 MSM host function | Significantly cheaper (host-layer, not Wasm) |
| Simulation margin of error | ±20% + 3M minimum floor |

**The 40M instruction figure for Groth16 verification comes directly from Stellar's own documentation** and is approximately 40% of the per-transaction maximum — feasible but not trivial.

### Why Protocol 26 matters for cost

Before Protocol 26, multi-scalar multiplication (MSM) — the dominant computation in Groth16 verification — had to run in Wasm and was counted instruction-by-instruction. After Protocol 26, `bn254_msm` is a host function: it executes at native speed and is billed as a fixed cost at the host layer, dramatically reducing effective instruction consumption for ZK verification.

**Practical implication for Writz:** ZK position proofs should become significantly cheaper after Protocol 26. The 40M instruction figure is likely a pre-Protocol-26 measurement. Real benchmarking post-Protocol-26 is a required Phase 1 task.

---

## Cost Benchmarks — Current Data

### Average transaction costs on Soroban (Protocol 25+ era)

From analysis of 220 community protocol transactions:
- **Average minimum resource fee:** ~215,000 stroops (0.0215 XLM)
- **At current XLM price (~$0.40):** ~$0.0086 per transaction

**For Writz specifically:**

| Operation | Estimated instruction cost | Estimated fee (XLM) |
|---|---|---|
| Groth16 ZK proof verification | ~40M instructions | ~0.02–0.05 XLM |
| Bitcoin Merkle proof verification | ~5–15M instructions (estimate) | ~0.005–0.015 XLM |
| Lending position update (read/write) | ~1–3M instructions | ~0.001–0.003 XLM |
| Full deposit flow (SPV + ZK + state) | ~50–60M instructions | ~0.025–0.06 XLM |

**At $0.40 XLM, a full deposit costs approximately $0.01–0.024.** This is acceptable for DeFi — substantially cheaper than Ethereum, where comparable operations cost $5–50+.

---

## Resource Constraints for Writz Operations

### 1. SPV Verification (Bitcoin Merkle proof)

Bitcoin SPV verification requires:
- `SHA256d` (double-SHA256) for each level of the Merkle tree: typically 12–13 levels for a block with ~1000–4000 transactions
- Block header PoW check: `SHA256d(header) < target` — two SHA256d calls
- Header chain validation: `prev_block_hash` check for each header in the chain

**Wasm SHA256 cost estimate:** Each SHA256d is ~10,000–20,000 instructions in Wasm. For a 13-level Merkle proof: ~130,000–260,000 instructions for the proof itself. Header chain (6 headers): ~120,000–240,000 additional instructions.

**Total SPV estimate:** 5–15M instructions — well within budget, even combined with ZK verification in the same transaction.

**Important:** Soroban does NOT have a native SHA256d host function. Bitcoin uses double-SHA256 (`SHA256(SHA256(data))`), not single SHA256. The circuit must implement this in Wasm. This adds cost vs. SHA256, but is manageable.

### 2. ZK Proof Verification (Groth16 / Circom)

The Groth16 verifier requires:
- Bilinear pairing check (the most expensive operation — `bn254_pairing` host function after P25)
- Multi-scalar multiplication (MSM) — `bn254_msm` host function after P26
- Field arithmetic operations — `bn254_field_*` host functions after P26

With Protocol 26's host functions, the bulk of the ZK verification cost moves off the Wasm instruction counter. The remaining Wasm work is mostly data marshaling and memory operations.

**Post-P26 estimate:** Groth16 verification could be 40–60% cheaper than the pre-P26 40M baseline. Targeting ~20–25M instructions post-P26.

### 3. Combined transaction (deposit = SPV + ZK + state write)

```
SPV verification:    ~10M instructions
ZK proof verify:     ~25M instructions (post-P26)
State reads/writes:  ~2M instructions
Total:               ~37M instructions
```

This fits comfortably within a 100M instruction budget with headroom for circuit complexity growth.

### 4. Transaction size constraints

A Soroban transaction's physical size affects fees. Key sizes to manage:
- Bitcoin block headers: 80 bytes each × 6 headers = 480 bytes
- Merkle proof: ~13 × 32 bytes = 416 bytes
- Raw Bitcoin transaction: varies (200–1,000 bytes typically)
- Groth16 proof: 192 bytes (fixed for Groth16)
- ZK public inputs: depends on circuit, typically 32–128 bytes

**Total transaction payload estimate:** ~1.5–2.5 KB — within Soroban's limits.

---

## Ledger Storage Considerations

### What Writz stores on-chain

| Data | Storage type | Size | Notes |
|---|---|---|---|
| Position commitments (Merkle tree) | Persistent | 32 bytes per commitment | Grows with users |
| Nullifier set | Persistent | 32 bytes per nullifier | Grows with operations |
| USDC pool state | Instance | ~200 bytes | Small, fixed size |
| Protocol config | Instance | ~100 bytes | Minimal |

### CertiK's warning: unbounded storage growth

CertiK specifically flags **unbounded storage growth** as a critical Soroban vulnerability class. If the commitment Merkle tree or nullifier set is stored in `instance` storage, they grow indefinitely and can cause DoS by exceeding storage limits or making reads prohibitively expensive.

**Writz design requirement:** Store individual commitments and nullifiers in separate `persistent` ledger entries keyed by their hash. Never store growing collections in a single `instance` storage entry. Each entry is a fixed-size 32-byte hash — cost is predictable and bounded per user.

---

## Cost Simulation Strategy

Before deploying to testnet, Writz must benchmark all critical operations using `soroban-rpc simulateTransaction`. The simulation workflow:

```
1. Write Soroban contract (Rust)
2. Compile to WASM
3. Deploy to Soroban testnet
4. Call simulateTransaction with real inputs:
   - Real Bitcoin transaction + Merkle proof + 6 block headers
   - Real Groth16 proof (generated by Circom/snarkjs)
5. Record actual instruction counts, not estimates
6. Verify the 20% simulation margin is acceptable
7. Measure at different Bitcoin block sizes (100 tx vs 4000 tx → different Merkle depths)
```

---

## Key Findings

1. **SPV verification is feasible** (~5–15M instructions) — well within budget
2. **ZK Groth16 verification is feasible** (~25–40M instructions post-P26) — within budget
3. **Combined deposit transaction is feasible** (~37–55M instructions) — fits in one transaction
4. **Cost is DeFi-acceptable** (~$0.01–0.06 per operation vs $5–50 on Ethereum)
5. **Unbounded storage growth is the main storage risk** — use per-entry persistent storage, never growing instance collections
6. **Real benchmarking required in Phase 1** — these are estimates; `simulateTransaction` on testnet with real proofs is mandatory before mainnet

---

## Phase 1 Benchmarking Checklist

- [ ] Benchmark SHA256d implementation in Soroban Wasm
- [ ] Benchmark Merkle proof verification at 3 depths: log2(100), log2(1000), log2(4000) transactions
- [ ] Benchmark block header chain validation for 3, 6, 10 headers
- [ ] Benchmark Groth16 verifier using Protocol 26 BN254 host functions
- [ ] Benchmark full deposit flow (SPV + ZK + state writes) end-to-end
- [ ] Measure XLM cost in USD at current price
- [ ] Identify instruction-count bottlenecks and optimize

---

*Last updated: 2026-06-22*
*Sources: [Soroban Fees & Metering — Stellar Docs](https://soroban.stellar.org/docs/soroban-internals/fees-and-metering) · [CertiK: Soroban Contract State Management](https://www.certik.com/blog/soroban-contract-state-management) · [How Much Do Soroban Fees Cost — CheesecakeLabs](https://cheesecakelabs.com/blog/how-much-do-soroban-fees-cost/) · [Stellar ZK Proofs Docs](https://developers.stellar.org/docs/build/apps/zk)*
