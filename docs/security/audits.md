---
title: "Audits"
---

**Current status: Pre-audit. Mainnet will not launch before audit completion.**

Writz will not launch on mainnet with real funds until an independent security audit of the Soroban smart contracts (`bitcoin-spv`, `writz-lend`) is complete.

---

## Scope

The audit covers what holds user funds:

- `bitcoin-spv`, the Bitcoin light client, and `writz-lend`, the lending contract, with the shared `spv-types` crate
- As related infrastructure: the script construction in `bitcoin-script` and the protocol signer policy (what the protocol signers will and will not co-sign)

The scope is frozen once every piece in it is built and running on testnet. After the freeze, these contracts change only to fix findings.

The review covers, at least:

- Storage growth and TTL handling
- Cross-contract calls between `writz-lend` and `bitcoin-spv`
- Integer overflow and rounding in interest and index calculations
- Access control: admin-only functions and keeper permissions
- Oracle manipulation and stale prices
- Light-client rules: header chain, proof of work, reorgs and Merkle proofs

---

## Readiness

| Item | Status |
|---|---|
| Contracts deployed on testnet with passing tests | Done: 839 tests |
| Integration tests covering all flows | Done: `scripts/deploy/e2e_local.mjs`, run in CI on a local network |
| STRIDE threat model | Draft published: [STRIDE threat model](/security/stride-threat-model). Full revision before the audit |
| Dataflow diagram | Published in the [STRIDE threat model](/security/stride-threat-model#data-flow-diagram) |
| Self-service security scan | Pending |

---

## Auditor

An independent firm with Soroban experience, engaged once the scope above is complete. The firm will be named here when it is engaged. Findings are classified as Critical, High, Medium, Low or Informational; Critical, High and Medium findings are fixed before mainnet, and the final report is published.

---

## Current Security Posture

Before the audit, Writz applies the following:

**Automated tooling:**
- `cargo clippy` with warnings treated as errors, apart from a short documented allow-list of pre-existing lints
- `cargo audit` - dependency vulnerability scanning of every Cargo workspace against the RustSec database, on manifest or lockfile changes and weekly (`.github/workflows/dependency-audit.yml`); any ignored advisory is listed in the workflow with its reason

**Test coverage:**
- 839 tests covering happy paths and error cases
- End-to-end integration tests covering the full deposit→borrow→repay→liquidate cycle
- Bitcoin transaction tests verifying witness construction against real Bitcoin script interpretation

**Known limitations before audit:**
- No penetration testing of the relayer API
- One price source today (Reflector); the second source, RedStone, is planned

---

## Audit History

| Date | Scope | Firm | Findings | Report |
|---|---|---|---|---|
| - | - | - | No audits yet | - |

This table will be updated as audits are completed. All published audit reports will be linked here.

---

**Next:** [Bug Bounty →](/security/bug-bounty)
