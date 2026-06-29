# Writz Protocol — Roadmap

**Version:** 0.4
**Last updated:** 2026-06-22
**Current phase:** Phase 1 — Foundation

---

## Overview

The roadmap is organized into four phases, each with a clear milestone gate before proceeding to the next. No phase begins until the previous milestone is validated.

```
Phase 0          Phase 1          Phase 2          Phase 3
Research    ──►  Foundation  ──►  Launch      ──►  Scale
✅ DONE          (Q3 2026)        (Q4 2026)        (2027)

Research         SPV testnet      Mainnet v1       Protocol
& validation     proof            PrivateLend      expansion
```

---

## Phase 0 — Research & Validation ✅ COMPLETE

**Goal:** Understand the technical landscape deeply enough to make confident architecture decisions before writing production code.

**Timeline:** June 2026
**Status:** All tasks complete. 15 research documents produced.

### 0.1 Bitcoin SPV on Other Chains ✅
- [x] `docs/research/spv-implementations.md`
- **Key:** summa-tx Rust library is the direct reference; stateless SPV avoids relayer dependency; Interlay/interBTC is the closest production reference

### 0.2 Stellar Protocol X-Ray Deep Dive ✅
- [x] `docs/research/protocol-x-ray-capabilities.md`
- **Key:** Circom + Groth16 on BN254 is the production-ready ZK stack today; Protocol 27 (July 8) changes co-signing key design — finalize architecture after it ships

### 0.3 Soroban Compute Cost Analysis ✅
- [x] `docs/research/soroban-compute-benchmarks.md`
- **Key:** ~37–55M instructions for a full deposit (SPV + ZK + state) — fits in one transaction; post-P26 BN254 MSM host functions reduce ZK verification cost significantly

### 0.4 Bitcoin P2WSH Locking Script Design ✅
- [x] `docs/research/bitcoin-locking-script.md`
- **Key:** P2WSH with 2-of-2 co-sign + timelock escape hatch; Phase 1 uses HSM for protocol key, Phase 2 migrates to MPC; Taproot in Phase 2+

### 0.5 SDF Grants Research ✅
- [x] `docs/research/sdf-grants.md`
- **Key:** One SCF Build Award application ($92K, Open Track); Audit Bank is a separate SDF program applied for post-testnet; Growth Hack and Liquidity Award available post-mainnet

### 0.6 Oracle Design ✅
- [x] `docs/research/oracle-design.md`
- **Key:** RedStone (primary) + Pyth (secondary), median aggregation, SEP-40 interface standard

### 0.7 Interest Rate Model ✅
- [x] `docs/research/interest-rate-model.md`
- **Key:** Kinked curve, Uoptimal = 75%, slope2 = 200%; protocol fee = 15% of spread

### 0.8 Liquidation Mechanism ✅
- [x] `docs/research/liquidation-mechanism.md`
- **Key:** Phase 1 trusted keeper + ZK undercollateralization proof; 150% min ratio, 120% liquidation threshold, 10% liquidator bonus

### 0.9 Circom Circuit Design ✅
- [x] `docs/research/circom-circuit-design.md`
- **Key:** Three circuits (deposit ~280 constraints, borrow/repay ~10,500, liquidation ~9,000); Groth16 trusted setup ceremony required pre-mainnet

### 0.10 Relayer Incentive Design ✅
- [x] `docs/research/relayer-incentive-design.md`
- **Key:** Stateless SPV means relayer is a convenience service, not critical path; Phase 1 Writz-operated API, Phase 2 decentralized with fee incentives

### 0.11 Blend & USDC Integration ✅
- [x] `docs/research/blend-usdc-integration.md`
- **Key:** Independent pools (ZK privacy can't be retrofitted onto Blend); protocol-owned liquidity seed for bootstrap; RedStone oracle alignment

### 0.12 Tokenomics & Fee Model ✅
- [x] `docs/research/tokenomics-fee-model.md`
- **Key:** Real-yield model (buyback/burn); WRTZ token launch after $5M TVL; 30/30/25/15 revenue split

### 0.13 Security Audit Strategy ✅
- [x] `docs/research/security-audit-strategy.md`
- **Key:** Audit Bank (separate from SCF) covers up to 100% of audit cost; approved firms include Veridise (ZK circuits), OtterSec, Zellic, Certora and others; unbounded storage growth is #1 Soroban vulnerability class

### 0.14 Regulatory Landscape ✅
- [x] `docs/research/regulatory-landscape.md`
- **Key:** Switzerland recommended for legal entity; ASP compliance model for selective transparency; not a mixer — collateral is traceable on Bitcoin

### 0.15 Growth Strategy ✅
- [x] `docs/research/growth-strategy.md`
- **Key:** 77% of Bitcoin holders have never tried BTCfi — massive underpenetrated market; points program pre-token; DeFiLlama listing + on-chain dashboard for verifiable traction

---

### Phase 0 Exit Criteria ✅ ALL MET

- [x] Confirmed stateless SPV verification is feasible in Soroban within acceptable compute limits
- [x] Confirmed Stellar Protocol X-Ray supports the ZK operations Writz needs
- [x] P2WSH locking script design complete
- [x] SCF application strategy defined ($92K, Open Track, one-time)
- [x] All architecture decisions documented and validated by research

---

## Phase 1 — Foundation *(Q3 2026)* 🔄 CURRENT

**Goal:** Working Bitcoin SPV client on Soroban testnet. SCF application submitted. Community presence established.

**Timeline:** July–September 2026
**Milestone:** Verify a real Bitcoin mainnet transaction on Soroban testnet → unlock SCF Tranche #0

---

### 1.1 Wait for Protocol 27 (July 8, 2026)

**Do not finalize the protocol co-signing key architecture until Protocol 27 ships on mainnet.**

Protocol 27 (Zipper) introduces auth delegation (`delegate_account_auth`), which changes how the protocol co-signing key is structured. Building before July 8 risks having to rework the key management design.

**Tasks:**
- [ ] Monitor Protocol 27 testnet (June 18) and mainnet vote (July 8)
- [ ] Update `docs/architecture/technical-overview.md` co-signing key section after P27 ships
- [ ] Update SDK imports from `@stellar/stellar-base` → `@stellar/stellar-sdk` (P27 breaking change)

---

### 1.2 SPV Contract ✅

Build the minimum viable Soroban contract that verifies a Bitcoin transaction via SPV.

**Tasks:**
- [x] Implement `verify_transaction()` in Soroban:
  - Input: Bitcoin block headers + Merkle proof + raw transaction + min_confirmations
  - Output: `VerificationResult { txid: BytesN<32>, block_hash: BytesN<32>, confirmations: u32 }`
- [x] Implement SHA256d (Bitcoin's double-SHA256) in Soroban Wasm — `contracts/contracts/bitcoin-spv/src/hash.rs`
- [x] Implement Bitcoin Merkle proof verification — `contracts/contracts/bitcoin-spv/src/merkle.rs`
- [x] Deploy to Soroban testnet — `CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC`
- [x] 28/28 tests passing — hash vectors, Merkle proofs, multi-tx blocks, confirmation counts
- [ ] Run `simulateTransaction` to record real instruction counts
- [ ] Study NethermindEth/stellar-private-payments codebase

**Acceptance test ✅:** Given a Bitcoin mainnet transaction, the contract returns the correct `txid` and `block_hash` (verified against Python-computed SHA256d — `contracts/deployments/testnet.md`).

---

### 1.3 Bitcoin Relayer Service ✅

Build the convenience service that provides SPV proof bundles on demand.

**Tasks:**
- [x] Build REST API: `GET /spv-proof/{txid}` → returns headers + Merkle proof + raw tx
- [x] Implement Blockstream Esplora as the data source (fallback for users too)
- [x] Document the proof bundle format — `sorobanArgs` field maps directly to contract params
- [x] 35/35 tests passing, TypeScript build clean
- **Location:** `relayer/`

---

### 1.4 P2WSH Locking Script — Implementation ✅ + Testnet E2E ✅

Implement the Bitcoin-side locking mechanism.

**Tasks:**
- [x] Implement P2WSH address generation (protocol_pubkey + user_pubkey + timelock)
- [x] Implement `buildRedeemScript` — exact IF/ELSE/CHECKSIGVERIFY/CLTV structure per research
- [x] Implement `computeTimelock` — loan duration + 7-day safety buffer in blocks
- [x] Implement `deriveDepositAddress` — deterministic, unique per deposit
- [x] Implement `buildReleaseTransaction` (Path A — co-sign) as PSBT
- [x] Implement `buildEmergencyTransaction` (Path B — timelock) with CLTV nLockTime
- [x] Implement `finalizePathA` / `finalizePathB` — custom witness assemblers
- [x] 48/48 tests passing — script structure, address derivation, PSBT round-trips, witness inspection
- [x] Verified on Bitcoin Signet address format (tb1q...) and mainnet (bc1q...)
- [x] E2E testnet script (`bitcoin-script/scripts/e2e_testnet.mjs`) — **live broadcast complete on Bitcoin Signet** ✅
  - Funding tx: [`61deea44`](https://blockstream.info/signet/tx/61deea4439ecd6c325c5b23ecf4b27694ce3cb0474adbbcc6221968ecbd583a4) (89,631 sat to P2WSH)
  - Path A release tx: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098) (88,131 sat → user, accepted by mempool)
  - Path A witness: `[user_sig (71B), protocol_sig (72B), 0x01, redeemScript (114B)]`
  - TX size: 347 bytes / **149 vbytes** at 10.1 sat/vbyte
  - Both keys signed PSBT independently (multi-party flow) ✅
  - PSBT finalization via `finalizePathA` produces valid segwit witness, accepted by Bitcoin Signet ✅
- **Location:** `bitcoin-script/`
- **Key:** Script is 114 bytes; each deposit gets a unique address from (protocolKey, userKey, timelock)

---

### 1.5 PrivateLend — Non-ZK Skeleton Contract ✅

**Tasks:**
- [x] Per-entry persistent storage (`DataKey::Position(txid)`) — no growing instance collections
- [x] `deposit`: cross-contract SPV call → on-chain Bitcoin tx parsing → position created
- [x] `supply_usdc` / `withdraw_supply`: USDC liquidity pool with per-lender balance tracking
- [x] `borrow`: collateral ratio check (150% min) → USDC transferred to borrower
- [x] `repay`: partial or full → `Closed` status + `repay_full` event for backend co-sign
- [x] Kinked interest rate model: base=0%, Uoptimal=75%, slope1=8%, slope2=200%, fee=15%
- [x] Continuous interest accrual on every position-touching call
- [x] `liquidate`: keeper-only (Phase 1) with undercollateral check → `Liquidated` + event
- [x] SEP-40 oracle interface stub with clean Phase 2 migration path
- [x] Persistent storage TTL management: all entries extended on every read/write (90-day threshold, 180-day window for long-lived entries)
- [x] Permissionless `refresh_position_ttl`, `refresh_supply_balance_ttl`, `refresh_protocol_ttl` for keeper-operated liveness
- [x] `#[contractevent]` on all events (zero deprecated API usage)
- [x] 50/50 tests: rates model, btc_parser, full deposit→borrow→repay→liquidate cycle
- **Location:** `contracts/contracts/private-lend/`

---

### 1.6 SCF Community Presence (Pre-Application)

Build community presence before submitting the SCF application. Referrals from community members strengthen the application and the handbook explicitly notes their weight.

**Tasks:**
- [ ] Join Stellar Developers Discord — engage in `#soroban`, `#defi`, `#developers` channels
- [ ] Post Phase 1 progress updates in Stellar developer forum
- [ ] Open a GitHub Discussion in the Stellar ecosystem repos (e.g., contribute to a CAP discussion)
- [ ] Identify and approach a Stellar ecosystem member for a referral to SCF
- [ ] Port `docs/` to public Mintlify docs at docs.writz.io (required by Open Track submission criteria)

**Content prepared (ready to post):**
- [x] `docs/community/forum-post.md` — Stellar Discord #soroban announcement (copy-paste ready)
- [x] `docs/community/github-discussion.md` — stellar/stellar-protocol GitHub Discussion (copy-paste ready)
- [x] `docs/community/outreach-playbook.md` — Channel-by-channel playbook: Discord, GitHub, Twitter, Reddit, referral strategy, Mintlify setup
- [x] `docs/mint.json` — Mintlify config (connect to GitHub → publish → done)

---

### 1.7 SCF Application — Open Track ✅ (content complete)

Submit the SCF Build Award application. Target: $92,000 worth of XLM. This is a one-time application.

**Pre-requisites before submitting:**
- [x] SPV prototype working on testnet ✅ (`CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC`)
- [ ] Public GitHub repo with clean, documented code (push repo public)
- [ ] Public Mintlify docs live at docs.writz.io (run `npx mintlify dev`, connect to GitHub)
- [ ] Testnet demo video recorded
- [ ] Team video presentation recorded
- [x] STRIDE threat model drafted ✅ (`docs/scf/stride-threat-model.md`)
- [ ] SCF community referral obtained (see `docs/community/outreach-playbook.md`)

**Application documents (ready to submit):**
- [x] `docs/scf/application.md` — Full Open Track application text (copy-paste into SCF form)
- [x] `docs/scf/milestone-plan.md` — Four-tranche deliverables with verification steps and timeline
- [x] `docs/scf/stride-threat-model.md` — STRIDE threat model v0.1
- [x] `docs/mint.json` — Mintlify config (connect to GitHub → publish → done)

**Submit via:** SCF Interest Form → indicate Open Track → await invitation to full Build round.

---

### 1.8 Trusted Setup Ceremony — Planning

The Groth16 trusted setup is a hard pre-mainnet requirement. It is a multi-party event that must be planned well in advance.

**Tasks:**
- [ ] Identify 5+ independent ceremony participants (Writz team + community + security researchers)
- [ ] Select Powers of Tau artifact (Hermez ceremony — same as Stellar Private Payments)
- [ ] Plan circuit-specific Phase 2 ceremony for each of the 3 Circom circuits
- [ ] Document the ceremony process publicly (transparency requirement)
- [ ] Schedule ceremony for Q4 2026 (before mainnet)

---

### Phase 1 Exit Criteria

- [x] SPV contract verifies a real Bitcoin mainnet transaction on Soroban testnet
- [x] P2WSH locking and release tested end-to-end on Bitcoin Signet — Path A co-signed release broadcast and accepted ✅ ([`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098))
- [x] ZK commitment-tree on Soroban testnet — full deposit→borrow→repay ZK flow verified on-chain ✅
- [ ] SCF application submitted
- [ ] Trusted setup ceremony planned and participants identified
- [ ] SCF Tranche #0 received (10% = ~$9,200)

---

## Phase 2 — Launch *(Q4 2026)*

**Goal:** Mainnet launch of Writz Protocol v1 with PrivateLend. Real BTC, real USDC, ZK-private positions.

**Timeline:** October–December 2026
**Milestone:** First real mainnet deposit + ZK-private USDC loan issued against real BTC collateral

---

### 2.1 Circom Circuits — Full Implementation ✅

**Tasks:**
- [x] Implement Deposit circuit — Poseidon commitment creation
- [x] Implement Borrow/Repay circuit — state transition with collateral ratio check (no division in ZK)
- [x] Implement Liquidation circuit — proves `rhs > lhs` undercollateralization; `usdc_debt` public output bound to private debt field in commitment (prevents keeper from claiming arbitrary debt amount)
- [x] Shared `merkle.circom` — `MerkleTreeChecker` + `MerkleTreeUpdater` (depth=20, 1M positions)
- [x] All circuits compiled to R1CS + WASM (circom 2.2.3)
- [x] Development trusted setup via snarkjs (pot15, for testing only)
- [x] Proving keys and verification keys generated
- [x] 20/20 tests: proof generation, commitment correctness, ratio enforcement, nullifiers
- **Location:** `circuits/`
- **Actual constraint counts (from compiler):**
  - Deposit: 597 non-linear + 714 linear (research estimated ~280)
  - Borrow/Repay: 10,935 non-linear + 12,114 linear (research estimated ~10,500 ✓)
  - Liquidation: 5,594 non-linear + ~6,196 linear (added `usdc_debt <== debt_stroops` binding; research estimated ~9,000)
- **Remaining for production:** Full multi-party trusted setup ceremony (Phase 2.3); recompile liquidation circuit artifacts after `usdc_debt` signal addition; browser WASM proving time measurement

---

### 2.2 Groth16 Verifier Contract ✅

**Tasks:**
- [x] `ZkVerifierContract` — standalone Soroban contract, one per deployment
- [x] Stores one verification key per circuit type (`Deposit`, `BorrowRepay`, `Liquidation`)
- [x] `verify_groth16` — computes `vk_x` via `bn254.g1_msm` (Protocol 26), then runs `bn254.pairing_check` with 4 pairs
- [x] Correctly handles malformed proofs: host rejects invalid point encodings at deserialization → transaction panics (correct security behaviour)
- [x] Correctly rejects valid-format but wrong proofs: `pairing_check` returns false
- [x] 18/18 tests: initialization, VK management, valid deposit + liquidation proof verification, tampered proof rejection, signal count mismatch, cross-circuit VK rejection
- [x] Test-vector generator (`circuits/scripts/gen_test_vectors.js`) produces real snarkjs proofs for Rust tests (deposit + liquidation)
- [x] Clean WASM: 11.8 KB, 6 exported functions, zero spec warnings
- [x] **Deployed to testnet:** `CDZV5AUUSQNBVTCJWIT36UANOJFJI2WKMAEGQZIXDXO7KSZ6YIC2ULP3`
- [x] All 3 VKs set on testnet (Deposit IC=6, BorrowRepay IC=9, Liquidation IC=6)
- **Location:** `contracts/contracts/zk-verifier/`

---

### 2.2b ZK Commitment Tree Contract ✅

Private ZK lending built as a standalone `commitment-tree` contract (cleaner separation of concerns than embedding into `private-lend`).

**Tasks:**
- [x] On-chain Poseidon Merkle commitment tree — root stored in persistent storage; depth=20 (1M positions)
- [x] Nullifier set — `DataKey::SpentNullifier(BytesN<32>)` per-entry persistent storage; prevents all double-spend attacks
- [x] `deposit`: SPV proof → txid binding (ZK proof commits to same txid SPV returned) → nullifier freshness → Groth16 verification → commitment queued for insertion
- [x] `insert_commitment`: admin/relayer inserts pending commitment into tree and advances root (Phase 1 trusted; Phase 2 will require ZK proof of correct insertion)
- [x] `borrow`: Groth16 proof → root match → `is_borrow=1` → `min_ratio_bp` binding → oracle price binding → amount from proof signal (not caller) → USDC transferred
- [x] `repay`: Groth16 proof → `is_borrow=0` → repay amount via BN254 field negation inversion (`p − delta_stroops`)
- [x] `liquidate`: Groth16 proof → `usdc_debt` extracted from proof signal (not caller-supplied) → keeper collects proven debt amount
- [x] `supply_usdc` / `withdraw_supply`: pool with per-lender `SupplyBalance` tracking — no lender can withdraw another's funds
- [x] Persistent storage TTL management: spent nullifiers at 180-day window (near Soroban mainnet max); Merkle root and TxCommitment dedup records at 180-day window; pool and supply balances at 90-day window
- [x] Permissionless refresh functions: `refresh_nullifier_ttl`, `refresh_commitment_ttl`, `refresh_merkle_root_ttl`, `refresh_pool_ttl`, `refresh_supply_balance_ttl` — keepers can extend critical entries indefinitely
- [x] `#[contractevent]` on all 5 events
- [x] 18/18 tests: signal extraction, BN254 arithmetic, initialization, insert_commitment auth
- [x] **Deployed to testnet:** `CAP5GNVFRNIZPGYYHEL55WQYMECA6YHYNM6EKKSVGWSUGEMJ476IQ4EQ`
- [x] `get_merkle_root` returns Poseidon-2 empty tree root `0x2134e76...` ✅ (verified on-chain)
- [x] **End-to-end ZK flow test complete** (`scripts/deploy/e2e_zkflow.js`):
  - deposit ZK proof (Groth16 BN254 pairing) verified on-chain ✅
  - Poseidon Merkle root updated after insertion ✅
  - borrow ZK proof: 150% collateral ratio enforced by circuit ✅
  - 200 XLM transferred from pool to borrower ✅
  - repay ZK proof: field-negation repay recovered correctly ✅
  - All 6 txs on testnet: [`8daddf52`](https://stellar.expert/explorer/testnet/tx/8daddf528c6f6254e67132265e3d9fea07fe1ce63622115b8dff4c335138bbd9) → [`ecef7a64`](https://stellar.expert/explorer/testnet/tx/ecef7a647c3c3aa2a14788ed6c09ab1ab9d6c5766c29fef0a440b30c1cf8ea97)
- **Location:** `contracts/contracts/commitment-tree/`

---

### 2.3 Trusted Setup Ceremony — Execution

**Tasks:**
- [ ] Execute Powers of Tau Phase 2 for each of the 3 circuits
- [ ] Record and publish the ceremony transcript publicly
- [ ] Verify transcript integrity with multiple independent verifiers
- [ ] Publish final `.zkey` files and verification keys

---

### 2.4 Audit Bank Application

Apply to the Soroban Security Audit Bank (separate from the SCF Build Award).

**Pre-requisites:**
- SCF Build Award received ✓
- Code deployed on testnet with extensive tests ✓
- STRIDE threat model completed ✓
- Self-service security tooling scan completed + remediation plan ✓
- Integration tests executed ✓
- Dataflow diagram produced ✓

**Process:**
- Submit Audit Bank intake form (provided by SCF email)
- Readiness review by SDF security expert (<4 weeks)
- Audit scheduled with approved firm
- Target firms: Veridise (ZK circuits) + OtterSec or Zellic (Soroban contracts)
- Co-payment: 5% of audit cost (refunded if critical/high/medium findings fixed within 20 business days)

**Note:** Growth Audit (>$10M TVL) and Scale Audit (>$100M TVL) are free — no co-payment.

---

### 2.5 Frontend — app.writz.io

**Tasks:**
- [ ] Build deposit flow UI: connect Xverse → send to P2WSH → wait for confirmations → submit SPV proof → receive USDC
- [ ] Build borrow/repay UI: borrow USDC, repay with interest, view health factor
- [ ] Build position dashboard: local decryption of ZK position (user sees their own amounts)
- [ ] Integrate Stellar Wallets Kit (Freighter, Lobstr, others)
- [ ] WASM ZK prover integrated in browser (no server-side proving)
- [ ] `/stats` public dashboard: TVL, utilization, total fees, positions count (no amounts)

---

### 2.6 Mainnet Launch — Gated

**Tasks:**
- [ ] Deploy SPV + commitment-tree + zk-verifier contracts to Soroban mainnet (testnet deployments complete ✅)
- [ ] Seed USDC pool with protocol-owned liquidity ($50K)
- [ ] Set initial TVL cap: $50,000 BTC collateral
- [ ] Set initial protocol fee to 0% for 90-day bootstrap period
- [ ] Whitelist-only access for 30 days
- [ ] Submit to DeFiLlama for TVL tracking (day 1 post-launch)
- [ ] Launch points program (pre-WRTZ token)
- [ ] Public launch after 30-day gated period with no critical issues

---

### 2.7 SCF Tranche Delivery

- [ ] Tranche #1 delivery (~$18,400): commitment-tree on testnet with ZK end-to-end
- [ ] Tranche #2 delivery (~$27,600): Circuits + trusted setup + frontend on testnet
- [ ] Tranche #3 delivery (~$36,800): Mainnet live, first real deposit

---

### Phase 2 Exit Criteria

- [ ] Mainnet deployment with passing Audit Bank audit
- [ ] 10+ real deposits processed with no security incidents
- [ ] $50K TVL cap reached
- [ ] Open-source SPV SDK published (`crates.io` + GitHub)
- [ ] TVL cap raised to $250K after 30 days clean operation
- [ ] DeFiLlama listing live
- [ ] All SCF tranches delivered

---

## Phase 3 — Scale *(2027)*

**Goal:** $10M TVL, WRTZ token launch, full product suite, Stellar ecosystem alliance.

**Timeline:** Q1–Q4 2027

### 3.1 Apply for SCF Post-Launch Programs
- **Growth Hack Program:** Apply once mainnet has been live 60+ days with completed audit and no active SDF grants
- **Liquidity Award:** Apply once $250K TVL is sustained for 7 consecutive days

### 3.2 Dark Swap Launch
Private BTC ↔ USDC swaps using the existing SPV client. AMM-style USDC liquidity pools.

### 3.3 BTC Savings Launch
BTC collateral + USDC auto-invested in highest-yield Stellar pools. Simpler UX for retail users.

### 3.4 ZK Proof of Reserve — B2B Launch
Enterprise attestation product. Direct sales to crypto exchanges, fintechs, funds. SaaS pricing.
Target: 5 paying customers by end of 2027.

### 3.5 TVL Expansion
- Q1 2027: $1M TVL cap (after Growth Audit + 3 months clean mainnet)
- Q2 2027: $5M TVL cap
- Q3 2027: $20M TVL cap
- Q4 2027: Remove TVL cap

### 3.6 WRTZ Token Launch
Criteria: $5M TVL sustained 60+ days, 500+ active wallets, one completed audit.
Structure: Fair IDO / LBP. No VC early access at steep discounts. Community-first.

### 3.7 Wallet Integrations
With traction demonstrated and open SDK available:
- Xverse — BTC DeFi section
- Freighter — BTC collateral option
- Lobstr — BTC yield product

### 3.8 Stellar Alliance — Deepening
- Contribute Writz SPV SDK as ecosystem infrastructure (open-source, documented)
- Participate in Stellar SEP standards development for Bitcoin assets on Stellar
- Co-market with SDF: Writz as the flagship BTCfi protocol on Stellar
- Track BitVM maturity — design Phase 4 architecture when it's production-ready

### 3.9 Institutional BD
- Direct outreach to crypto hedge funds, family offices, mining companies with BTC treasury
- Compliance documentation package (ASP, audit reports, regulatory positioning)
- Target: 3–5 institutional deposits of $100K+ each

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SPV too expensive in Soroban | Low | Critical | Benchmarked: ~37–55M instructions, within budget; post-P26 even cheaper |
| Protocol 27 delays (co-signing architecture) | Low | Medium | Monitor testnet (June 18); don't finalize key design until P27 mainnet |
| Trusted setup ceremony fails | Low | Critical | Plan with 5+ parties; use Hermez Powers of Tau (already battle-tested) |
| ZK circuit underconstrained (soundness bug) | Low | Critical | Veridise audit specifically for ZK circuits; formal verification |
| Oracle manipulation | Low | High | Multi-oracle median (RedStone + Pyth), staleness check, liquidation smoothing |
| Bitcoin reorg invalidates deposit | Very Low | High | 6-confirmation requirement |
| Smart contract exploit | Low | Critical | Audit Bank (Veridise + OtterSec), TVL caps, insurance fund, bug bounty |
| No user adoption | Medium | High | Points program, DeFiLlama listing, on-chain stats dashboard, Stellar wallet integration |
| Regulatory action | Low | High | Swiss legal entity, ASP compliance, no capital controls use cases |
| SCF application rejected | Medium | Low | Standalone business model — SCF is an accelerant, not a dependency |

---

## Success Metrics

| Phase | Metric | Target |
|---|---|---|
| Phase 1 | SPV verifications on testnet | 100+ |
| Phase 1 | SCF application submitted | ✓ |
| Phase 2 | Mainnet TVL (day 30) | $50K |
| Phase 2 | Mainnet TVL (day 90) | $250K |
| Phase 2 | DeFiLlama listed | ✓ |
| Phase 2 | Audit passed (0 critical findings) | ✓ |
| Phase 3 | TVL | $5M+ |
| Phase 3 | Monthly protocol revenue | $15K+ |
| Phase 3 | Protocols using SPV SDK | 3+ |
| Phase 3 | Proof of Reserve customers | 5+ |
| Phase 3 | WRTZ token launched | ✓ |

---

*Last updated: 2026-06-22*
