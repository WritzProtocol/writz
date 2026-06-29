# Phases

Four phases, one goal: the first trustless, private Bitcoin lending protocol on Stellar.

```
Phase 0          Phase 1          Phase 2          Phase 3
Research    ──►  Foundation  ──►  Launch      ──►  Scale
✅ COMPLETE      🔄 CURRENT        Q4 2026          2027
```

---

## Phase 0 — Research & Validation ✅ COMPLETE

**Goal:** Understand the technical landscape deeply enough to make confident architecture decisions.  
**Timeline:** June 2026  
**Status:** All 15 research documents produced. All architecture decisions validated.

### Key Findings

- Stateless SPV on Soroban is feasible: ~37–55M instructions per full verification — within the 100M instruction budget
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
| [Market Landscape](../research/market-landscape.md) | 28x growth in BTCfi; Stellar has zero BTCfi competition |
| [Interest Rate Model](../research/interest-rate-model.md) | Kinked curve: Uoptimal=75%, slope2=200% |
| [Liquidation Mechanism](../research/liquidation-mechanism.md) | ZK undercollateral proof; 150% min, 120% threshold, 10% bonus |
| [Circom Circuit Design](../research/circom-circuit-design.md) | Three circuits; Groth16 trusted setup required pre-mainnet |
| [Tokenomics & Fee Model](../research/tokenomics-fee-model.md) | Real-yield model; WRTZ token after $5M TVL |
| [Security Audit Strategy](../research/security-audit-strategy.md) | Audit Bank covers costs; Veridise for ZK circuits |

---

## Phase 1 — Foundation 🔄 CURRENT

**Goal:** Working Bitcoin SPV client on Soroban testnet. SCF application submitted. Community presence established.  
**Timeline:** July–September 2026  
**Milestone:** SPV contract verified on testnet + SCF Tranche #0 received

### What's Complete ✅

| Item | Details |
|---|---|
| **bitcoin-spv contract** | 28/28 tests. SHA256d, Merkle proofs, PoW validation. Deployed: `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| **zk-verifier contract** | 18/18 tests. Groth16 BN254 via Protocol 26 host functions. All 3 VKs set. Deployed: `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| **commitment-tree contract** | 50/50 tests. Full ZK cycle verified on-chain. Deployed: `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7` |
| **private-lend contract** | 50/50 tests. Non-ZK skeleton with kinked interest model. Deployed: `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |
| **ZK circuits** | 45/45 tests. All 3 circuits compiled (Circom 2.2.3). Dev keys generated. |
| **Relayer service** | 35/35 tests. REST API: `GET /spv-proof/:txid`. Esplora-backed. |
| **Bitcoin script toolkit** | 48/48 tests. P2WSH generation, PSBT signing, witness assembly. |
| **Bitcoin Signet E2E** | Path A co-signed release broadcast and accepted. `11932100` |
| **ZK testnet E2E** | Full deposit→borrow→repay cycle on Soroban testnet. 6 transactions. `8daddf52` |
| **SCF application** | Content complete: full application, 4-tranche milestone plan, STRIDE threat model |
| **Documentation** | Complete rewrite: 22 documents across introduction, products, how-it-works, developers, security, roadmap |

### What Remains

| Item | Status |
|---|---|
| Protocol 27 monitoring (July 8, 2026) | Monitor testnet; update co-signing key architecture after P27 ships |
| Push repo public | Ready — waiting for community engagement first |
| Mintlify docs at docs.writz.io | Connect GitHub → publish (mint.json ready) |
| Demo video (testnet) | Record after docs are live |
| Community engagement | Discord, GitHub discussions, Stellar forum — 2–3 weeks |
| SCF referral | Approach Stellar ecosystem members after community presence established |
| SCF application submission | After above checklist is complete |
| Trusted setup ceremony — planning | Identify 5+ independent participants |

### Phase 1 Exit Criteria

- [x] SPV contract verifies a real Bitcoin transaction on Soroban testnet ✅
- [x] P2WSH locking and release tested E2E on Bitcoin Signet ✅
- [x] ZK commitment-tree full cycle verified on Soroban testnet ✅
- [ ] SCF application submitted
- [ ] Trusted setup ceremony planned and participants identified
- [ ] SCF Tranche #0 received (~$9,200)

---

## Phase 2 — Launch *(Q4 2026)*

**Goal:** Mainnet launch of PrivateLend v1 with real BTC collateral and ZK-private USDC loans.  
**Milestone:** First real mainnet deposit + first ZK-private USDC loan issued against real BTC

### Remaining Work

**Protocol 27 integration (July 2026):**
- Update co-signing key architecture using `delegate_account_auth`
- Update SDK imports (breaking change in `@stellar/stellar-sdk`)

**ZK circuits — production prep:**
- Trusted setup ceremony: Powers of Tau Phase 2 for all 3 circuits
- Publish ceremony transcript publicly
- Recompile liquidation circuit artifacts after `usdc_debt` signal addition

**Audit Bank:**
- Submit intake form (after SCF Build Award received)
- Readiness review (~4 weeks)
- Veridise audit: ZK circuits
- OtterSec/Zellic audit: Soroban contracts
- Remediate all Critical/High/Medium findings

**Frontend (app.writz.io):**
- Deposit flow UI: connect Xverse → P2WSH → SPV proof → ZK commitment
- Borrow/repay UI with local position decryption
- Position dashboard (health factor, interest accrued)
- `/stats` public dashboard: TVL, utilization, protocol revenue
- Stellar Wallets Kit integration (Freighter, Lobstr, others)
- WASM ZK prover in browser (no server-side proving)

**Mainnet launch (gated):**
- TVL cap: $50,000 (raised to $250K after 30 days clean operation)
- Whitelist-only for first 30 days
- Protocol fee: 0% for 90-day bootstrap period
- Protocol-owned USDC seed: $50,000
- DeFiLlama submission (day 1)
- Points program launch (pre-WRTZ)

### SCF Tranche Delivery

| Tranche | Amount | Deliverable |
|---|---|---|
| #0 (10%) | ~$9,200 | Phase 1 milestone: SPV on testnet |
| #1 (20%) | ~$18,400 | commitment-tree on testnet with ZK E2E |
| #2 (30%) | ~$27,600 | Circuits + trusted setup + frontend on testnet |
| #3 (40%) | ~$36,800 | Mainnet live, first real deposit |

### Phase 2 Exit Criteria

- [ ] Mainnet deployment with passing Audit Bank audit (0 critical findings)
- [ ] 10+ real deposits processed with no security incidents
- [ ] $50K TVL cap reached
- [ ] TVL cap raised to $250K after 30 days clean operation
- [ ] Open-source SPV SDK published (GitHub + npm)
- [ ] DeFiLlama listing live
- [ ] All SCF tranches delivered

---

## Phase 3 — Scale *(2027)*

**Goal:** $10M TVL, WRTZ token launch, full product suite, Stellar ecosystem alliance.  
**Timeline:** Q1–Q4 2027

### Product Expansion

**Dark Swap (Q2 2027):**
Private BTC-to-USDC conversions using the existing SPV infrastructure. AMM-style USDC liquidity. No exchange account, no visible order book.

**BTC Savings (Q3 2027):**
BTC collateral + automated USDC yield routing to Blend, Phoenix DEX, and other vetted Stellar protocols.

**ZK Proof of Reserve — B2B (Q3 2027):**
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
**Structure:** Fair IDO / Liquidity Bootstrapping Pool — no VC cliff dumps.  
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
| Phase 1 | SCF application submitted | ✓ |
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

**See the full vision:** [Vision →](vision.md)
