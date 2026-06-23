# Audits

**Current status: Pre-audit. Mainnet will not launch before audit completion.**

Writz will not launch on mainnet with real funds until at least two independent security audits are complete: one for the Soroban smart contracts and one for the ZK circuits.

---

## Audit Strategy

Writz uses the **Stellar Foundation's Audit Bank** program, which subsidizes the cost of smart contract audits for qualifying Soroban projects. This is a separate program from the SCF Build Award — the Audit Bank covers up to 100% of audit costs for projects that meet the readiness criteria.

### Audit Readiness Criteria (Writz's current status)

| Criterion | Status |
|---|---|
| SCF Build Award received | Pending — application in progress |
| Contracts deployed on testnet with passing tests | ✅ Done — 146/146 tests |
| STRIDE threat model completed | ✅ Done — `docs/scf/stride-threat-model.md` |
| Self-service security scan completed | Pending — Phase 2 task |
| Integration tests covering all flows | ✅ Done — e2e_zkflow.js |
| Dataflow diagram produced | Pending — Phase 2 task |

---

## Target Audit Firms

### ZK Circuits — Veridise

Veridise specializes in ZK circuit security. They have audited Tornado Cash, Aztec, and multiple Groth16-based systems. ZK circuit bugs (underconstrained circuits, soundness issues) are a category that requires specialized expertise — general smart contract auditors do not have this depth.

**Scope:** All three Circom circuits (`deposit.circom`, `borrow_repay.circom`, `liquidation.circom`), the shared Merkle components (`merkle.circom`), and the trusted setup ceremony procedure.

**Target timeline:** Q3 2026 — after the trusted setup ceremony is planned and before mainnet launch.

### Soroban Contracts — OtterSec or Zellic

For the Soroban contracts, Writz will engage either OtterSec or Zellic — both are Audit Bank approved firms with Soroban-specific experience.

**Scope:** All four Soroban contracts, focusing on:
- Storage growth vulnerabilities (the #1 Soroban vulnerability class)
- Cross-contract call security
- Integer overflow/underflow in interest calculations
- Access control: admin-only functions, keeper permissions
- Oracle manipulation vectors
- Re-entrancy (less common in Soroban but must be checked)

**Target timeline:** Q3–Q4 2026 — concurrent with ZK circuit audit.

---

## Audit Bank Process

1. Submit Audit Bank intake form (provided by SCF upon Build Award approval)
2. Readiness review by SDF security expert (< 4 weeks)
3. Audit scheduled with approved firm
4. Audit completed; findings categorized as Critical, High, Medium, Low, Informational
5. All Critical/High/Medium findings remediated within 20 business days (required for Audit Bank subsidy)
6. Audit report published publicly
7. Co-payment: 5% of audit cost (refunded if remediation deadline met)

---

## Post-Audit Audits (Growth and Scale)

Stellar's Audit Bank provides additional free audits at TVL milestones:

| Program | Trigger | Cost to Writz |
|---|---|---|
| Growth Audit | > $10M TVL | Free (no co-payment) |
| Scale Audit | > $100M TVL | Free (no co-payment) |

These audits are re-assessments as the codebase and TVL grow. Writz intends to apply for both as the protocol scales.

---

## Current Security Posture

Before the formal Audit Bank engagement, Writz applies the following:

**Automated tooling:**
- `cargo clippy` with all warnings treated as errors
- `cargo audit` — dependency vulnerability scanning
- Custom constraint analysis for ZK circuits (circom-specific tooling)

**Test coverage:**
- 268 tests covering happy paths and error cases
- End-to-end integration tests covering the full deposit→borrow→repay→liquidate cycle
- ZK circuit tests verifying proof acceptance for valid inputs and rejection for invalid inputs
- Bitcoin transaction tests verifying witness construction against real Bitcoin script interpretation

**Known limitations before audit:**
- No formal verification of ZK circuits (Veridise will perform this)
- No penetration testing of the relayer API
- Oracle integration is stubbed in the current testnet deployment (real oracle integration in Phase 2)

---

## Audit History

| Date | Scope | Firm | Findings | Report |
|---|---|---|---|---|
| — | — | — | No audits yet | — |

This table will be updated as audits are completed. All published audit reports will be linked here.

---

**Next:** [Bug Bounty →](bug-bounty.md)
