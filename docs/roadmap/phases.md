# Phases

> **SCF status note:** Everything in this document related to the Stellar Community Fund (application, tranches, grant funding) is a draft. The application has not been submitted and there is no short-term plan to submit it. Do not read any SCF-tied line item, date, or amount below as scheduled or committed.

Four phases, one goal: a trustless, private Bitcoin lending protocol on Stellar. (Not a "first on Stellar" claim - see the 2026-08-04 addendum in [Market Landscape](../research/market-landscape.md): Solv Protocol and Templar Protocol already have live Stellar BTC infrastructure. The differentiator is trustless native BTC plus ZK-private positions, not being first.)

```
Phase 0          Phase 1          Phase 2          Phase 3
Research    ──►  Foundation  ──►  Launch      ──►  Scale
✓ COMPLETE      ● CURRENT        Q4 2026          2027
```

---

## Phase 0: Research & Validation (COMPLETE)

**Goal:** Understand the technical landscape deeply enough to make confident architecture decisions.  
**Timeline:** June 2026  
**Status:** All 15 research documents produced. All architecture decisions validated.

### Key Findings

- Stateless SPV on Soroban is feasible: ~37-55M instructions per full verification, within the 100M instruction budget
- Protocol X-Ray (Protocol 26) BN254 host functions reduce ZK verification cost significantly
- P2WSH locking script design complete and tested on Bitcoin Signet
- SCF Build Award strategy defined ($92K, Open Track, one-time application)

### Research Produced

| Document | Key Finding |
|---|---|
| [Bitcoin SPV on Other Chains](../research/spv-implementations.md) | summa-tx is the reference; stateless SPV avoids relayer dependency |
| [Protocol X-Ray Deep Dive](../research/protocol-x-ray-capabilities.md) | Circom + Groth16 on BN254 is production-ready today |
| [Soroban Compute Benchmarks](../research/soroban-compute-benchmarks.md) | Full deposit fits in one transaction |
| [Bitcoin Locking Script](../research/bitcoin-locking-script.md) | P2WSH + CLTV design complete; Taproot in Phase 2 |
| [Market Landscape](../research/market-landscape.md) | 28x growth in BTCfi. Updated 2026-08-04: Solv Protocol and Templar Protocol both have live Stellar infrastructure now, so "zero BTCfi competition on Stellar" no longer holds. The differentiator is trustless native BTC plus ZK-private positions specifically, not being first on Stellar. See the doc's 2026-08-04 addendum |
| [Interest Rate Model](../research/interest-rate-model.md) | Kinked curve: Uoptimal=75%, slope2=200% |
| [Liquidation Mechanism](../research/liquidation-mechanism.md) | ZK undercollateral proof; 150% min, 120% threshold, 10% bonus |
| [Circom Circuit Design](../research/circom-circuit-design.md) | Three circuits; Groth16 trusted setup required pre-mainnet |
| [Tokenomics & Fee Model](../research/tokenomics-fee-model.md) | Real-yield model; WRTZ token after $5M TVL |
| [Security Audit Strategy](../research/security-audit-strategy.md) | Audit Bank covers costs; Veridise for ZK circuits |

---

## Phase 1: Foundation (CURRENT)

**Goal:** Working Bitcoin SPV client on Soroban testnet. SCF application drafted and ready to submit whenever the team decides to. Community presence established.  
**Timeline:** July–September 2026  
**Milestone:** SPV contract verified on testnet + SCF Tranche #0 received

### What's Complete ✓

| Item | Details |
|---|---|
| **bitcoin-spv contract** | 49/49 tests. SHA256d, Merkle proofs, PoW validation. Deployed: `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| **zk-verifier contract** | 25/25 tests. Groth16 BN254 via Protocol 26 host functions. All 3 VKs set. Deployed: `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| **commitment-tree contract** | 32/32 tests. Full ZK cycle verified on-chain. Deployed: `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP` |
| **private-lend contract** | 85/85 tests. Non-ZK skeleton with kinked interest model. Deployed: `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR` |
| **ZK circuits** | 29/29 tests. All 3 circuits compiled (Circom 2.2.3). Dev keys generated. |
| **Relayer service** | 104/104 tests. REST API: `GET /spv-proof/:txid`. Esplora-backed. |
| **Bitcoin script toolkit** | 60/60 tests. P2WSH generation, PSBT signing, witness assembly. |
| **Bitcoin Signet E2E** | Path A co-signed release broadcast and accepted. `11932100` |
| **ZK testnet E2E** | Full deposit→borrow→repay cycle on Soroban testnet. 6 transactions. `8daddf52` |
| **SCF application** | **DRAFT - not submitted.** Content complete: full application, 4-tranche milestone plan, STRIDE threat model. No submission planned in the short term (deliberate hold, not a blocker); treat every SCF-tranche reference in this document as contingent on a decision that has not been made |
| **Documentation** | Complete rewrite: 22 documents across introduction, products, how-it-works, developers, security, roadmap |

### What Remains

| Item | Status |
|---|---|
| Protocol 27 monitoring (July 8, 2026) | Monitor testnet; update co-signing key architecture after P27 ships |
| Push repo public | Done. Repo is public at github.com/WritzProtocol/writz with Apache-2.0 license |
| Mintlify docs at docs.writz.xyz | Done. Live at docs.writz.xyz |
| Marketing landing page | Done. Redesigned landing page live at writz.xyz; app dashboard moved to /app |
| SECURITY.md / disclosure process | Done. Published with a working disclosure contact |
| Demo video (testnet) | Not started |
| Community engagement | Discord, GitHub discussions, Stellar forum. Groundwork (public repo, live docs, live landing page) is in place; sustained engagement itself has not started |
| SCF referral | Not secured yet. Deferred by choice, not blocked. Do not mark this done until an actual referral is in hand |
| SCF application submission | **Not applied for. No plan to submit in the short term.** The application content exists as a draft only; do not treat any tranche funding, deadline, or exit criterion tied to it as scheduled until this changes |
| Trusted setup ceremony, planning | Multi-party ceremony tooling and shared verification-key encoding built. Identifying 5+ independent participants and running the ceremony itself is still pending |

### Phase 1 Exit Criteria

- [x] SPV contract verifies a real Bitcoin transaction on Soroban testnet ✓
- [x] P2WSH locking and release tested E2E on Bitcoin Signet ✓
- [x] ZK commitment-tree full cycle verified on Soroban testnet ✓
- [ ] SCF application submitted (draft only - no submission planned short-term)
- [ ] Trusted setup ceremony planned and participants identified
- [ ] SCF Tranche #0 received (~$9,200) (contingent on submission above; not scheduled)

---

## Phase 2: Launch *(Q4 2026)*

**Goal:** Mainnet launch of PrivateLend v1 with real BTC collateral and ZK-private USDC loans.  
**Milestone:** First real mainnet deposit + first ZK-private USDC loan issued against real BTC

**Timing note (added after the 2026-08-04 competitive review):** `market-landscape.md`'s addendum on Templar Protocol found that their Stellar Soroban vault and cross-chain bridge are already live and audited, and their native-BTC-no-wrap lending tech is already proven on NEAR mainnet. Templar is missing only the routing between the two and a privacy layer. That materially compresses the effective competitive window from the original 12-18 month assumption. Given that repo work is already ahead of what this roadmap previously reflected (frontend dashboard reading live testnet contract state, wallet connections wired, relayer deployed, ceremony tooling built), Q4 2026 still looks achievable, but it should be treated as a floor to defend, not a comfortable target, specifically because of Templar. Revisit this note at the next roadmap review.

### Remaining Work

**Protocol 27 integration (July 2026):**
- Update co-signing key architecture using `delegate_account_auth`
- Update SDK imports (breaking change in `@stellar/stellar-sdk`)

**Oracle integration (mainnet-blocking, not yet started):**
- `get_btc_price_stroops` in `contracts/contracts/private-lend/src/oracle.rs` still returns a hardcoded `STUB_PRICE_STROOPS_PER_BTC` (`TODO Phase 2` in the code) - this is a hard dependency for real liquidations and has no owner or target date yet
- Wire real SEP-40 cross-contract call to RedStone (primary) + Pyth (secondary), median aggregation per `docs/research/oracle-design.md`
- **This also unblocks `commitment-tree` liquidation.** With the current fixed-price stub and no ZK-compatible accrual mechanism, no position can legitimately move from the ≥150% ratio `borrow` requires down to the <120% `liquidate` requires - see `docs/security/security-model.md`, "Keeper model and liquidation permissionlessness"
- Implement the 60-minute staleness check and "price paused" fallback state described in `docs/research/oracle-design.md` and `docs/security/security-model.md` - neither exists in code today
- **Do not schedule a mainnet date until this has an owner and a start date.**

**ZK circuits, production prep:**
- Trusted setup ceremony: Powers of Tau Phase 2 for all 3 circuits (plus `zero_debt`, per `docs/scf/milestone-plan.md`)
- **Blocking sub-task with no owner or date yet: identify 5+ independent ceremony participants.** Ceremony tooling exists (`circuits/scripts/ceremony/`), but the participants themselves are not identified - this is the actual bottleneck, not the tooling
- Publish ceremony transcript publicly
- Recompile liquidation circuit artifacts after `usdc_debt` signal addition **before** running the ceremony - running the ceremony against circuits that still need this change risks having to redo it

**Audit Bank:**
- Submit intake form - **currently blocked:** the readiness criteria in `docs/security/audits.md` gate this on "SCF Build Award received," and the SCF application has no short-term submission plan (see Phase 1). Either confirm an SCF-independent Audit Bank qualification path, or define an alternative audit-funding plan; do not assume this unblocks itself
- Readiness review (~4 weeks)
- Veridise audit: ZK circuits
- OtterSec/Zellic audit: Soroban contracts
- Remediate all Critical/High/Medium findings

**Team / key-person risk (not conditioned on SCF funding):**
- Current state: single founder-developer, sole custodian of protocol design knowledge and (pending KMS enforcement) the co-signing key process - see `docs/security/security-model.md`
- The only mitigation on record (hiring a second developer) is funded by the SCF grant, which is not being pursued short-term - this leaves bus-factor risk unmitigated with no funding-independent fallback
- Needs an explicit plan that does not depend on SCF: candidates include a paid technical advisor for spot-reviews, a documented incident-response runbook co-owned by someone outside the founder, or scoping a minimal paid contractor engagement funded from another source

**Frontend (app.writz.xyz):**
- Stellar Wallets Kit integration | Done. Wired into the /app dashboard, reading live testnet contract state (pool state, Merkle root)
- Bitcoin wallet connection | Done. Bitcoin wallet button live in the /app dashboard
- KMS-backed cosigning and deposit address UX | Done. Backend cosign API route and auto-cosign repay watcher shipped
- Deposit flow UI: connect Bitcoin wallet → P2WSH → SPV proof → ZK commitment | In progress
- Borrow/repay UI with local position decryption | In progress
- Position dashboard (health factor, interest accrued) | In progress
- `/stats` public dashboard: TVL, utilization, protocol revenue | Not started
- WASM ZK prover in browser (no server-side proving) | Not started
- Accessibility (WCAG 2.1 AA) audit of the deposit/borrow/repay/release flow | Not started - see `docs/design/accessibility-strategy.md`. Deliberately sequenced after the flows above leave "in progress," not before, so the audit isn't wasted on UI that's still actively changing
- Guided in-app recovery flows (manual proof submission fallback, emergency Path B recovery) | Not started - see `docs/design/guided-recovery-spec.md`. Both flows currently require running Node.js scripts by hand; not a blocker for mainnet gating by TVL cap, but should ship before the whitelist restriction lifts and volume grows
- Liquidation status detection and notification | Not started - see `docs/design/liquidation-notification-spec.md`. The `PositionStatus` type and frontend display for a liquidated position now exist; the relayer-side event watcher that sets that status does not
- Contract migration runbook | Written, not yet rehearsed end-to-end on a live deployment - see `docs/architecture/contract-migration-runbook.md`. Recommends a Blend-style wind-down model (old contract stays live for existing positions, no forced state transplant) rather than a forced migration, which is also the only thing architecturally possible for `commitment-tree`'s ZK positions. Both prerequisite gaps it surfaced are now closed: `Config.paused` + `set_paused` exist on both lending contracts (blocks new deposits/borrows/supply, leaves repay/withdraw/liquidate open), and both emit `supply`/`withdraw` events so lenders can be enumerated. Remaining open item: an `import_position` admin function for `private-lend`'s Track 2 forced-migration path, not yet built (deliberately - see the runbook's rehearsal checklist)
- SPV checkpoint staleness monitoring | Script written (`contracts/scripts/check-checkpoint-age.sh`), not yet wired into a scheduled job. Closes the gap where `set_checkpoint` requires a weekly manual refresh with no on-chain alert if it lapses - see `docs/security/security-model.md`
- Relayer backfill runbook rehearsal | Written, not yet rehearsed - see `docs/developers/relayer-backfill-runbook.md`. Rate limiting was added to `/api/cosign` (Node-process in-memory limiter, resets on redeploy - no shared store across instances since nothing in this stack runs multi-instance today), but the relayer itself is still a single unreplicated process; this runbook is the mitigation for that until real redundancy exists

**Mainnet launch (gated):**
- **All four contract admin accounts configured as 2-of-3 (or stricter) multisigs - not yet done for `private-lend`/`commitment-tree`.** Only `bitcoin-spv`/`zk-verifier` were previously called out for this in `docs/security/security-model.md`; that document now extends the same requirement to all four, since `private-lend`/`commitment-tree`'s admins gate equally sensitive functions (`insert_commitment`, `set_oracle`, `set_keeper`, `set_relayer`). External Stellar-account configuration, not a contract code change.
- **Legal entity formed and operating - hard gate, not yet started.** Deploying contracts that custody real user BTC/USDC without a legal entity behind them is a founder personal-liability exposure, not just a compliance nicety. Budgeted at $8K for a Swiss GmbH in `docs/scf/application.md`, but that budget line is part of the SCF grant, which is not being pursued short-term - this needs its own funding source and owner (the founder) before it can be treated as scheduled. **Do not launch mainnet with real funds before this is resolved.**
- TVL cap: $50,000 (raised to $250K after 30 days clean operation)
- Whitelist-only for first 30 days. **Selection criteria and application process not yet defined** (owner: growth/community, before launch): default proposal - self-serve application form gated on (1) a connected wallet with prior testnet activity on Writz, or (2) referral from an existing testnet tester/community member, reviewed manually given expected low volume at this stage
- Protocol fee: 0% for 90-day bootstrap period (requires a launch-time change to `PROTOCOL_FEE_BP` in `contracts/contracts/private-lend/src/rates.rs`, currently hardcoded to 15% - not yet implemented, treat as a pre-mainnet task)
- Protocol-owned USDC seed: $50,000 (funding source unresolved - see `docs/research/growth-strategy.md`)
- DeFiLlama submission (day 1)
- Points program launch (pre-WRTZ)

### SCF Tranche Delivery

**Status: DRAFT / hypothetical.** The SCF application has not been submitted and there is no short-term plan to submit it. This table describes what tranche delivery would look like *if* the team decides to apply - funding and dates below are not committed, scheduled, or relied upon for the roadmap.

| Tranche | Amount | Deliverable |
|---|---|---|
| #0 (10%) | ~$9,200 | Phase 1 milestone: SPV on testnet |
| #1 (20%) | ~$18,400 | commitment-tree on testnet with ZK E2E |
| #2 (30%) | ~$27,600 | Circuits + trusted setup + frontend on testnet |
| #3 (40%) | ~$36,800 | Mainnet live, first real deposit |

### Phase 2 Exit Criteria

- [ ] Legal entity formed and operating (hard gate before real-fund mainnet launch - see "Mainnet launch (gated)" above; not yet started, funding source unresolved)
- [ ] Real oracle integration live (RedStone + Pyth median, staleness check) - replaces the current hardcoded stub; no owner or date assigned yet
- [ ] Trusted setup ceremony: 5+ independent participants identified and ceremony run - participants not yet identified
- [ ] Key-person / bus-factor mitigation plan in place, independent of SCF funding
- [ ] Mainnet deployment with passing Audit Bank audit (0 critical findings) - contingent on resolving the Audit Bank/SCF gating dependency above
- [ ] 10+ real deposits processed with no security incidents
- [ ] $50K TVL cap reached
- [ ] TVL cap raised to $250K after 30 days clean operation
- [ ] Open-source SPV SDK published (GitHub + npm)
- [ ] DeFiLlama listing live
- [ ] All SCF tranches delivered (only applicable if the SCF application is submitted - not currently planned)

---

## Phase 3: Scale *(2027)*

**Goal:** $10M TVL, WRTZ token launch, full product suite, Stellar ecosystem alliance.  
**Timeline:** Q1–Q4 2027

### Product Expansion

**Dark Swap (Q2 2027):**
Private BTC-to-USDC conversions using the existing SPV infrastructure. AMM-style USDC liquidity. No exchange account, no visible order book.

**BTC Savings (Q3 2027):**
BTC collateral + automated USDC yield routing to Blend, Phoenix DEX, and other vetted Stellar protocols.

**ZK Proof of Reserve, B2B (Q3 2027):**
Enterprise attestation product. Direct sales. Target: 5 paying customers by end of 2027. See [ZK Proof of Reserve](../products/zk-proof-of-reserve.md).

### TVL Progression

| Quarter | TVL Cap |
|---|---|
| Q1 2027 | $1M |
| Q2 2027 | $5M |
| Q3 2027 | $20M |
| Q4 2027 | Remove cap |

### WRTZ Token (Q2–Q3 2027)

**Launch criteria:** $5M TVL sustained 60+ days, 500+ active wallets, one completed Audit Bank audit.  
**Structure:** Fair IDO / Liquidity Bootstrapping Pool, no VC cliff dumps.  
**Real-yield mechanics:** Protocol revenue used to buy and burn WRTZ.  
**Governance:** TVL cap increases, fee adjustments, insurance fund payouts, new product whitelisting.

### Stellar Ecosystem Alliance

- Contribute Writz SPV SDK as Stellar ecosystem infrastructure
- Propose a SEP standard for Bitcoin SPV on Stellar
- Co-market with SDF as the flagship BTCfi protocol on Stellar
- Apply for SCF Growth Hack Program (after 60+ days mainnet, completed audit, no active SDF grants)
- Apply for SCF Liquidity Award (after $250K TVL sustained 7 days)

### Wallet Integrations

Target integrations with demonstrated traction and open SDK:
- Xverse: BTC DeFi section with PrivateLend
- Freighter: BTC collateral option in the lending section
- Lobstr: BTC yield product in the savings section

### Institutional BD

- Direct outreach to crypto hedge funds, family offices, BTC mining companies
- Compliance documentation package (ASP attestations, audit reports, regulatory positioning)
- Target: 3–5 institutional deposits of $100K+ each

---

## Success Metrics

| Phase | Metric | Target |
|---|---|---|
| Phase 1 | SPV verifications on testnet | 100+ |
| Phase 1 | SCF application submitted | ✓ (draft only - not currently pursued; see Phase 1 "What Remains") |
| Phase 2 | Mainnet TVL (day 30) | $50K |
| Phase 2 | Mainnet TVL (day 90) | $250K |
| Phase 2 | Audit completed (0 critical findings) | ✓ |
| Phase 2 | DeFiLlama listed | ✓ |
| Phase 3 | TVL | $5M+ |
| Phase 3 | Monthly protocol revenue | $15K+ |
| Phase 3 | Protocols using SPV SDK | 3+ |
| Phase 3 | Proof of Reserve customers | 5+ |
| Phase 3 | WRTZ token launched | ✓ |

---

*Last reconciled against actual repo state: 2026-08-17.*

**See the full vision:** [Vision →](vision.md)
