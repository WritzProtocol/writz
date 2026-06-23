# SCF Application Strategy

**Author:** Research
**Date:** 2026-06-22
**Last updated:** 2026-06-22 (corrected from SCF handbook)
**Status:** Complete — Strategy defined

---

## Our Position

Writz Protocol is built to be financially self-sufficient. The protocol generates its own revenue through lending spreads, swap fees, SPV API access, and Proof of Reserve subscriptions. External funding is not part of the core business model — it is a one-time accelerant to reach self-sufficiency faster.

We are applying to the Stellar Community Fund **once**, for **$92,000 worth of XLM**, for a specific and bounded purpose: completing the final development sprint to mainnet. The security audit is handled separately through the Stellar Audit Bank program — a distinct SDF service that SCF-funded projects automatically qualify for.

This is not a dependency relationship. It is a catalytic grant that aligns the interests of both parties — Writz reaches mainnet faster, and Stellar gains its first trustless Bitcoin DeFi protocol with ZK privacy.

---

## Important Distinction: SCF Grant vs. Audit Bank

These are **two completely separate programs**:

| Program | Purpose | Funding |
|---|---|---|
| **SCF Build Award** | Fund development work | Up to $150K in XLM, paid in tranches |
| **Soroban Audit Bank** | Cover security audit costs | Separate SDF program, covers up to 100% of audit cost |

The $92,000 SCF Build Award covers **development only**. The security audit is applied for separately through the Audit Bank once Writz reaches testnet stage, and is handled entirely outside the SCF grant budget.

---

## SCF Build Award — What It Is

**Program:** Stellar Community Fund Build Award
**Amount requested:** $92,000 worth of XLM
**Track:** Open Track
**Max available:** Up to $150,000 worth of XLM (we are requesting $92K)
**Payment structure:** Four tranches — 10% / 20% / 30% / 40% of total award

The Open Track is designed for experienced builders exploring novel use cases on Stellar or Soroban. It requires demonstrated technical depth, a novel protocol primitive, and strong ecosystem impact. Writz qualifies on all three counts.

---

## Why One Application and Nothing More

Multiple SCF applications would imply that Writz's survival depends on SDF funding cycles. That is not the kind of protocol we are building. Writz has a real business model: users pay to borrow USDC against their BTC, to swap privately, and to prove reserves. That revenue sustains the protocol indefinitely. The SCF grant accelerates the timeline to get there — it does not replace the revenue model.

We are not building a public good that needs perpetual ecosystem support. We are building a protocol that will eventually generate more value for the Stellar ecosystem than we received from the grant.

After completing all four tranches, the SCF handbook notes that projects may apply for additional Build Awards up to a cumulative cap of $150K. We do not intend to use this option. The $92K is the complete and final ask from SCF.

---

## The Open Track: What SCF Looks For

Based on the official SCF handbook, a strong Open Track submission must include:

**Team credibility**
- Evidence that the team has previously built and scaled similar products
- Deep, proven Stellar or domain knowledge (Bitcoin protocol, ZK proofs, Soroban)

**Technical depth**
- Clearly scoped, technically ambitious protocol
- Clear on-chain integration plan specific to Stellar's tech stack
- Milestones and deliverables mapped to mainnet deployment
- Full disclosure on any AI-assisted artifacts (docs, code)

**Documentation (unified source — Mintlify)**
- Planning and overall roadmap
- Architecture diagrams
- Dev artifacts and test plan
- UI/UX prototypes

**Business case**
- Market analysis focusing on business and technical differentiation
- Clear articulation of how the project drives on-chain growth and how that growth is measured
- Thoughtful budget reflecting team size, timeline, and effort

**Video presentation**
- A well-produced video showcasing the team — mandatory for Open Track

**Community presence**
- Referral from an SCF community member strongly recommended (not mandatory, but weighted in review)

### What makes Writz's application strong

1. **Novel protocol, not a replication** — The SCF handbook explicitly filters out teams replicating existing solutions. Writz builds something that does not exist anywhere: Bitcoin SPV verification on Soroban combined with ZK-private lending. This is unambiguously novel.

2. **Self-sustaining business model** — Rare for SCF applicants. Protocol generates revenue from day one. Reviewers see this is not a charity case.

3. **Measurable on-chain impact** — TVL, borrow utilization, SPV verifications per day, USDC volume through the protocol. All on-chain, all independently verifiable.

4. **Open-source infrastructure** — The Bitcoin SPV SDK is reusable by any Stellar protocol. This is ecosystem infrastructure, not just a product.

5. **Timing** — Protocol X-Ray (Jan 2026) and Protocol 26 (May 2026) just made this technically possible. Writz is at the right moment.

6. **Documentation exists** — This Mintlify site (`docs/`) provides the unified documentation source the SCF requires: research, architecture, roadmap, all in one place.

---

## Audit Bank — Separate Program

Once Writz is SCF-funded and reaches testnet stage, we apply separately to the **Soroban Security Audit Bank**.

**Key facts from the handbook:**

- Managed by SDF, completely separate from SCF Build Award budgets
- Covers **up to 100% of audit cost**
- Initial Audit co-payment: **5% of audit cost** (refunded if critical/high/medium findings fixed within 20 business days)
- Growth Audit (>$10M TVL): **0% co-payment**
- Scale Audit (>$100M TVL): **0% co-payment**

**Writz qualifies as a priority category:**
- Financial Protocol managing on-chain value ✅
- Infrastructure Contract (SPV SDK used by multiple services) ✅

**Approved audit firms (from handbook):**
Certora, Code4rena, ChainSecurity, Halborn, Oak Security, OtterSec, Runtime Verification, Spearbit + Cantina, Veridise, Zellic

For Writz, the most relevant firms are:
- **Veridise** — ZK circuit audits specifically, critical for Circom circuits
- **OtterSec** — Smart contract security, extensive Soroban track record
- **Runtime Verification** — Formal methods, ideal for the SPV verification math

**Audit Bank requirements before applying:**
- Deployed on testnet
- Extensive tests completed
- STRIDE threat model provided
- Self-service security tooling scan completed with remediation plan
- Integration tests executed

---

## Tranche Structure ($92,000 total)

Per SCF v7.0's four-tranche disbursement: 10% / 20% / 30% / 40%

| Tranche | % | Amount (XLM equiv.) | Deliverable |
|---|---|---|---|
| **#0** | 10% | ~$9,200 | Bitcoin SPV client verifies a Bitcoin mainnet transaction on Soroban testnet. GitHub repo public with technical documentation. |
| **#1** | 20% | ~$18,400 | PrivateLend v1 on Soroban testnet: deposit BTC via SPV → borrow USDC with ZK-private position. End-to-end testnet demo published. |
| **#2** | 30% | ~$27,600 | Circom circuits (deposit, borrow/repay, liquidation) complete. Trusted setup ceremony executed. Frontend v1 (app.writz.io) on testnet. |
| **#3** | 40% | ~$36,800 | Mainnet deployment. First real BTC deposit processed. Public launch with $50K TVL cap. |

---

## The Long-Term Vision: Strategic Alliance with Stellar

Writz does not see the SCF grant as a transaction — it is the first step in a longer relationship.

### Short term (2026–2027)
- Writz ships the first Bitcoin SPV client on Soroban — reusable infrastructure for any Stellar protocol
- Writz becomes the primary BTCfi protocol in the Stellar DeFi ecosystem
- BTC enters Stellar's ecosystem for the first time as a genuine collateral asset

### Medium term (2027–2028)
- Writz's open SPV SDK used by other Stellar protocols (Blend, DEXes, payment apps)
- Writz brings institutional Bitcoin holders into the Stellar ecosystem
- Mutual co-marketing: Stellar promotes Writz's Bitcoin capability; Writz promotes Stellar's privacy infrastructure

### Long term (2028+)
- Writz contributes to Stellar's infrastructure: open standards for Bitcoin asset verification on Stellar
- Collaboration on new capabilities — BitVM integration when technology matures
- Writz participates in Stellar's progressive decentralization of SCF governance

The SCF is not Writz's patron — it is Writz's first and most important strategic ally.

---

## Additional Post-Launch Programs

Once Writz is live on mainnet, two further SDF programs become available:

**Growth Hack Program**
- Eligibility: mainnet protocol + completed security audit + KYC + no other active SDF grants
- Purpose: marketing and growth support from SDF
- Target: apply once Writz has been live for 60+ days with clean operations

**Liquidity Award**
- Eligibility: >$250K TVL sustained for 7 consecutive days + completed audit + KYC
- Purpose: SDF provides additional liquidity support to qualifying protocols
- Target: apply at $250K TVL milestone (expected Q1 2027)

These programs are not part of the initial SCF application — they are post-launch milestones that reward demonstrated traction.

---

## Application Checklist

- [ ] Stellar Discord community engagement (start before applying)
- [ ] GitHub repository public with initial SPV prototype
- [ ] Mintlify docs live (docs.writz.io, `docs/` connected to GitHub)
- [ ] Testnet demo video (SPV verification of a real Bitcoin tx on Soroban)
- [ ] Team video presentation recorded
- [ ] STRIDE threat model drafted
- [ ] Referral from SCF community member obtained
- [ ] Submit SCF Interest form (indicate Open Track)
- [ ] Wait for invitation to full Build round submission
- [ ] Present at Meridian 2026 conference if accepted

---

*Last updated: 2026-06-22*
*Sources: [SCF Handbook](https://stellar.gitbook.io/scf-handbook) · [Build Award](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award) · [Open Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track) · [Audit Bank Official Rules](https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules) · [Growth Hack](https://stellar.gitbook.io/scf-handbook/supporting-programs/growth-hack/official-rules) · [Liquidity Award](https://stellar.gitbook.io/scf-handbook/supporting-programs/stellar-liquidity-award/official-rules)*
