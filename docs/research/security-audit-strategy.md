# Research: Security Audit Strategy

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

Security is Writz Protocol's most critical non-negotiable. A single exploit could drain all BTC collateral and destroy user trust permanently. This document maps the audit landscape for Soroban, documents common vulnerabilities, and defines Writz's security strategy.

---

## The Soroban Security Audit Bank

**The most important finding in this research: Writz may qualify for FREE security audits through the SDF.**

The Stellar Development Foundation operates the **Soroban Security Audit Bank** — a program that provides up to $1M in security audit credits distributed across 20–30 high-priority Soroban projects.

### Program details

| Parameter | Value |
|---|---|
| Total budget | Up to $1M in audit credits |
| Number of projects | 20–30 |
| Co-payment required | 5% of audit cost (refundable if vulnerabilities are remediated within 20 days) |
| Participating firms | OtterSec, Veridise, Runtime Verification, CoinFabrik, QuarksLab, Coinspect |
| Eligibility pathway | Build an SCF-funded project OR demonstrate sufficient ecosystem impact |
| Follow-up audits | Free at $10M TVL and $100M TVL milestones |

### How to qualify

The primary pathway is through the **Stellar Community Fund (SCF)**. If Writz receives an SCF grant, it automatically qualifies for Audit Bank access. This aligns the grant strategy with the security strategy — SCF funding unlocks both capital AND audit support.

**Action item:** SCF application should explicitly mention the planned Audit Bank participation.

---

## Approved Audit Firms (Official SDF Audit Bank List)

The following firms are officially pre-approved by the SDF for the Soroban Security Audit Bank. Source: SCF handbook.

| Firm | Specialization | Writz relevance |
|---|---|---|
| **Veridise** | Smart contract + ZK circuit audits, advanced vulnerability detection tooling | ✅ Primary — only approved firm with explicit ZK circuit capability |
| **OtterSec** | $36B+ TVL secured, 120+ protocols, Soroban track record | ✅ Primary — Soroban smart contract audit |
| **Zellic** | Blockchain + cryptography security, world-class white-hat team | ✅ Strong option for Soroban contracts |
| **Certora** | Formal verification via mathematical reasoning of code | Good for PrivateLend financial math formal proofs |
| **Runtime Verification** | Formal methods and runtime verification, deep design review | Good for SPV verification correctness proofs |
| **Spearbit + Cantina** | Network of top researchers, competitive audit platform | Good for broad coverage |
| **Oak Security** | 600+ audits with zero exploits, blinded parallel review | Good for unbiased second opinion |
| **Halborn** | Web3 + enterprise security assessments | Option if others unavailable |
| **ChainSecurity** | Complex smart contract infrastructure, founded 2017 | Option for deep protocol review |
| **Code4rena** | Competitive platform, 100+ researchers per audit | Good for community-wide coverage |

**Writz's target firms:**
- **Veridise** — Circom ZK circuit audit (3 circuits: deposit, borrow/repay, liquidation)
- **OtterSec or Zellic** — Soroban smart contracts (SPV client + PrivateLend + USDC pool)

---

## Common Soroban Vulnerabilities

Based on CertiK's research and the audit bank's findings across 40+ audited projects:

### 1. Unbounded Storage Growth (HIGH SEVERITY)

**What it is:** Storing ever-growing collections (arrays, maps) in `instance` storage causes the storage entry to grow unboundedly. Reading or writing large instance entries can spike costs dramatically and eventually DoS the contract.

**Example in a lending context:**
```rust
// DANGEROUS: All position commitments in one instance entry
#[contracttype]
pub struct PoolState {
    pub commitments: Vec<BytesN<32>>,  // grows forever!
    pub nullifiers: Vec<BytesN<32>>,   // grows forever!
}
```

**Writz mitigation:**
- Each commitment stored as a separate `persistent` ledger entry keyed by commitment hash
- Each nullifier stored as a separate `persistent` ledger entry keyed by nullifier hash
- Pool-level state (TVL, utilization) stored in `instance` storage (fixed size)
- Never use `Vec` in instance storage for data that grows with users

### 2. Type Safety in Host Value Conversion (MEDIUM SEVERITY)

**What it is:** Soroban converts container inputs into raw host values without guaranteed round-trip type safety. Storing a value as one type and retrieving as another can halt execution or corrupt logic.

**Writz mitigation:**
- Define all storage types explicitly with `#[contracttype]` derive macro
- Use newtype wrappers for semantic distinction (e.g., `CommitmentHash(BytesN<32>)` vs `NullifierHash(BytesN<32>)`)
- Write round-trip tests for every storage type: store → retrieve → assert equality

### 3. Integer Overflow in Financial Math (HIGH SEVERITY)

**What it is:** Before Protocol 26, overflow in 256-bit arithmetic would silently wrap around, causing wildly incorrect financial calculations. Protocol 26 introduces checked arithmetic that traps on overflow.

**Writz mitigation:**
- Target Protocol 26+ from day one — use checked arithmetic everywhere
- Use `checked_add`, `checked_mul`, `checked_div` for all financial calculations
- Fuzz test interest accrual calculations with extreme inputs (very high interest rates, very long time periods, max uint values)
- Write explicit overflow tests at boundary conditions

### 4. Reentrancy via Cross-Contract Calls (HIGH SEVERITY)

**What it is:** When Writz's PrivateLend contract calls an external contract (USDC token transfer, oracle, etc.), that external contract could call back into Writz before the first call completes — potentially double-spending or corrupting state.

**Writz mitigation:**
- Follow checks-effects-interactions pattern: update all state BEFORE making external calls
- Use reentrancy guards on critical functions (`liquidate`, `repay`, `borrow`)
- Minimize external calls within sensitive functions

### 5. Oracle Manipulation (HIGH SEVERITY)

**What it is:** If the BTC price oracle can be manipulated (even temporarily), an attacker can trigger artificial liquidations or borrow more USDC than their BTC is worth.

**Writz mitigation:**
- Multi-oracle median (RedStone + Pyth)
- Staleness check: reject prices >60 minutes old
- Price deviation check: reject if sources disagree by >5%
- Liquidation smoothing: use min(current, 5-min-ago price) for liquidations

### 6. ZK Proof Soundness (CRITICAL)

**What it is:** A bug in the Circom circuit could allow an attacker to construct a valid-looking proof that proves a false statement — e.g., proving they have more collateral than they do.

**Writz mitigation:**
- Engage ZK-specialized auditors (Veridise, Trail of Bits' ZK team) separately from Soroban contract auditors
- Conduct formal verification of critical circuit constraints
- Run the trusted setup ceremony transparently with multiple parties
- Test circuits against known attack patterns (under-constrained circuits, malicious witness generation)

### 7. Timing Attacks on Liquidations (MEDIUM SEVERITY)

**What it is:** If liquidations can only happen at specific times or by specific parties, an attacker can front-run or delay liquidations to profit.

**Writz mitigation:**
- Liquidation is open to anyone once the ZK proof is valid
- No minimum delay between liquidation proof submission and execution
- Keeper bond ensures keepers don't collude to delay

---

## Security Testing Strategy

### Pre-audit (internal)

**Unit tests:** Every contract function tested in isolation with both valid and invalid inputs. Minimum 90% function coverage.

**Integration tests:** Cross-contract call flows tested end-to-end (SPV → PrivateLend → USDC pool).

**Fuzz testing:** Use `cargo-fuzz` on:
- Interest rate calculations (extreme utilization, very large/small amounts)
- Collateral ratio calculations (zero debt, max BTC, extreme prices)
- SPV verification (malformed headers, invalid Merkle proofs, reorg scenarios)
- ZK proof submission (invalid proofs, replayed proofs, malformed inputs)

**Invariant testing:** Define protocol invariants and test that no sequence of operations can violate them:
- `total_usdc_borrowed ≤ total_usdc_supplied × Umax`
- `sum(commitment_collateral) = total_btc_locked`
- `insurance_fund ≥ 0` (never negative)

### Audit sequence

```
Phase 1 (before testnet with real funds):
  ├── Internal security review
  ├── Fuzz testing campaign (2 weeks)
  └── Bug bounty (Immunefi, $5K max per bug)

Phase 2 (before mainnet):
  ├── OtterSec audit of Soroban contracts (4–6 weeks)
  ├── Veridise ZK circuit audit (3–4 weeks, parallel)
  └── Remediation and re-audit of critical/high findings

Phase 3 ($10M TVL milestone):
  └── Second full audit (different firm per Audit Bank program)

Ongoing:
  └── Bug bounty program (permanent, Immunefi)
```

### Bug bounty tiers

| Severity | Reward |
|---|---|
| Critical (funds at risk) | Up to $50,000 |
| High (significant impact) | $10,000–$25,000 |
| Medium (limited impact) | $1,000–$5,000 |
| Low/Informational | $100–$500 |

---

## Security Checklist Before Mainnet

- [ ] All unit tests passing (≥90% coverage)
- [ ] Fuzz tests run for minimum 48 hours with no crashes
- [ ] External audit completed (OtterSec or equivalent)
- [ ] All critical and high findings remediated
- [ ] ZK circuit audit completed (Veridise or equivalent)
- [ ] Trusted setup ceremony completed and transcript published
- [ ] Bug bounty program live on Immunefi
- [ ] TVL cap set at $50K for first 30 days
- [ ] Insurance fund seeded with $5K minimum
- [ ] Emergency pause mechanism tested
- [ ] Incident response runbook written and team trained

---

*Last updated: 2026-06-22*
*Sources: [Soroban Audit Bank — stellar.org](https://stellar.org/grants-and-funding/soroban-audit-bank) · [CertiK: Soroban Contract State Management](https://www.certik.com/blog/soroban-contract-state-management) · [OtterSec](https://osec.io/) · [Veridise Soroban Audits](https://veridise.com/audits/soroban/)*
