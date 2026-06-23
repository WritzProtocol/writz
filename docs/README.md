# Writz Protocol — Documentation

> The first trustless Bitcoin DeFi layer on Stellar, with ZK-private positions.

---

## Documents

### Start here

- [`project-overview.md`](./project-overview.md) — What Writz Protocol is, products, business model, and why Stellar

### Research

- [`research/spv-implementations.md`](./research/spv-implementations.md) — Prior art: Bitcoin SPV on other chains (BTC Relay, summa-tx, Interlay, SP1+BitVM). Critical lessons for building on Soroban.
- [`research/market-landscape.md`](./research/market-landscape.md) — BTCfi market size and growth, competitive landscape, Stellar ecosystem, why now
- [`research/protocol-x-ray-capabilities.md`](./research/protocol-x-ray-capabilities.md) — Deep dive: Protocol 25 (X-Ray), 26 (Yardstick), 27 (Zipper). ZK capabilities, costs, and what each means for Writz
- [`research/soroban-compute-benchmarks.md`](./research/soroban-compute-benchmarks.md) — Resource limits, instruction costs, ZK + SPV feasibility analysis, storage pitfalls
- [`research/bitcoin-locking-script.md`](./research/bitcoin-locking-script.md) — P2WSH vs Taproot, exact script design, timelock logic, co-signing key architecture
- [`research/oracle-design.md`](./research/oracle-design.md) — RedStone + Pyth on Stellar, SEP-40 standard, multi-oracle median strategy, manipulation mitigations
- [`research/interest-rate-model.md`](./research/interest-rate-model.md) — Kinked utilization curve, Aave/Compound/Blend comparison, Writz-specific parameters
- [`research/liquidation-mechanism.md`](./research/liquidation-mechanism.md) — Private ZK liquidations, keeper design, circuit constraints, health factor system
- [`research/circom-circuit-design.md`](./research/circom-circuit-design.md) — Three circuits (deposit, borrow/repay, liquidation), constraint counts, trusted setup requirements
- [`research/relayer-incentive-design.md`](./research/relayer-incentive-design.md) — Stateless SPV relay service, incentive model, zkRelay alternative, fallback sources
- [`research/blend-usdc-integration.md`](./research/blend-usdc-integration.md) — USDC liquidity landscape, Blend ecosystem, bootstrap strategy, oracle alignment
- [`research/tokenomics-fee-model.md`](./research/tokenomics-fee-model.md) — Revenue streams, WRTZ token design, real-yield model, financial projections
- [`research/security-audit-strategy.md`](./research/security-audit-strategy.md) — Audit Bank, common Soroban vulnerabilities, audit sequence, bug bounty tiers
- [`research/regulatory-landscape.md`](./research/regulatory-landscape.md) — FATF/AML, Tornado Cash precedent, ASP compliance model, jurisdictional strategy
- [`research/sdf-grants.md`](./research/sdf-grants.md) — One-time $92K SCF application strategy, Audit Bank access, long-term Stellar alliance vision
- [`research/growth-strategy.md`](./research/growth-strategy.md) — User segments, growth flywheel, points program, verifiable traction metrics, community building

### Architecture

- [`architecture/technical-overview.md`](./architecture/technical-overview.md) — System design: P2WSH locking script, SPV contract, ZK privacy layer, PrivateLend contract, full user journeys

### Roadmap

- [`roadmap/roadmap.md`](./roadmap/roadmap.md) — Four-phase execution plan: Phase 0 (Research), Phase 1 (Foundation), Phase 2 (Launch), Phase 3 (Scale)

### Brainstorming

- [`brainstorming/brainstorming-session-2026-06-22-1000.md`](./brainstorming/brainstorming-session-2026-06-22-1000.md) — Original ideation session: 14 ideas generated, analysis, and final concept selection

---

## Current Status

**Phase:** 1 — Foundation (in progress)

**Completed:**
- Phase 0: All 15 research documents ✅
- Phase 1.2: Bitcoin SPV Soroban contract — 28/28 tests, deployed to testnet ✅
- Phase 1.3: Relayer service (`relayer/`) — 35/35 tests ✅
- Phase 1.4: P2WSH locking script (`bitcoin-script/`) — 48/48 tests ✅
- Phase 1.5: PrivateLend skeleton contract (`contracts/contracts/private-lend/`) — 50/50 tests, 23.7 KB WASM ✅
- Phase 1.6: Community presence content — Mintlify config, Discord post, GitHub Discussion, outreach playbook ✅
- Phase 1.7: SCF application content — full application, 4-tranche milestone plan, STRIDE threat model ✅

**Remaining before SCF submission:** push repo public → publish Mintlify docs → record demo video → record team video → engage community for 2–3 weeks → submit SCF Interest Form.

---

## Quick Reference

### What Writz does

```
User sends BTC (Bitcoin) → P2WSH locking script
                                    │
                        SPV proof submitted to Soroban
                                    │
                        PrivateLend issues USDC loan
                        (position hidden via ZK proof)
                                    │
                        User uses USDC in Stellar DeFi
```

### Products

| Product | Description | Status |
|---|---|---|
| **PrivateLend** | BTC collateral → private USDC loan | In design |
| **Dark Swap** | Private BTC ↔ USDC swap | Planned (Phase 3) |
| **BTC Savings** | BTC collateral + auto USDC yield | Planned (Phase 3) |
| **ZK Proof of Reserve** | B2B: prove BTC holdings privately | Planned (Phase 3) |

### Key technical dependencies

- Stellar Protocol X-Ray (live on mainnet, Jan 2026)
- Soroban smart contracts (production-grade since Protocol 23, Sep 2025)
- summa-tx/bitcoin-spv Rust library (reference implementation)
- Bitcoin P2WSH scripting
