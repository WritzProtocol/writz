# SCF Build Award — Open Track Application *(DRAFT)*

> **Note:** This is a draft and will be changed if needed. Content is directionally correct but specific numbers, team details, and deliverable dates will be refined before actual submission.

**Program:** Stellar Community Fund — Build Award, Open Track
**Amount requested:** $92,000 worth of XLM
**Disbursement:** Four tranches — 10% / 20% / 30% / 40%
**Submission type:** This document is the full application text, structured to match the SCF Open Track submission form.

---

## 1. Project name and one-line description

**Name:** Writz Protocol

**One line:** The first trustless Bitcoin DeFi layer on Stellar — BTC collateral verified via SPV, lending positions hidden by ZK proofs.

---

## 2. Problem statement

Bitcoin is the world's largest crypto asset ($1T+ in long-term holders) and almost none of it participates in DeFi. Existing solutions fail in one of two ways:

**They require trust.** WBTC (BitGo custody), tBTC (threshold signatures), Stacks sBTC (federated peg), RSK (federated peg) — every major BTCfi implementation relies on a third party to hold or vouch for the Bitcoin. This is counterproductive for an asset whose entire value proposition is trustlessness.

**They expose positions publicly.** Aave, Compound, Blend — every lending protocol makes collateral amounts, loan sizes, and liquidation thresholds visible to anyone on the blockchain. Front-running bots exploit liquidation thresholds. Institutional participants won't accept this visibility. Sophisticated retail users don't want their net worth public.

Meanwhile, Stellar launched Protocol X-Ray (January 2026) — ZK proof verification inside Soroban smart contracts — and processes $500M/month in USDC. The infrastructure to solve both problems simultaneously now exists on Stellar. Nobody has built on it.

---

## 3. Solution

Writz Protocol connects Bitcoin natively to Stellar's DeFi and privacy infrastructure:

**Trustless BTC collateral via stateless SPV.** Users send BTC to a P2WSH script with two spending paths: (A) protocol co-signature when the loan is repaid, and (B) a CLTV timelock escape hatch in case the protocol is unavailable. A Soroban smart contract verifies the Bitcoin transaction cryptographically — SHA256d header chain validation + Merkle inclusion proof — with no bridge, no custodian, and no wrapped token. If Writz disappears, users recover their BTC via the timelock with no protocol involvement.

**ZK-private lending positions.** Collateral amounts, loan sizes, and health ratios are hidden using zero-knowledge proofs built on Stellar's Protocol X-Ray (Groth16 on BN254). Nobody — not front-running bots, not competitors, not surveillance firms — can see your position. Liquidations are proved ZK: the keeper proves a position is undercollateralized without revealing the actual amounts.

**Real business model.** Revenue from lending spread (protocol captures 15% of interest), SPV API fees, swap fees (Dark Swap product), and Proof of Reserve SaaS for enterprises. The SCF grant accelerates development; Writz sustains itself on protocol revenue.

---

## 4. Technical architecture

### Layer 1 — Bitcoin (P2WSH locking script)

Each deposit creates a unique Bitcoin address from three inputs: `(protocol_key, user_key, cltv_timelock)`. The redeem script encodes two spending conditions using Bitcoin Script:

```
OP_IF
  <protocol_pubkey> OP_CHECKSIGVERIFY   ← path A: co-signed release
  <user_pubkey>     OP_CHECKSIG
OP_ELSE
  <timelock_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
  <user_pubkey>     OP_CHECKSIG         ← path B: emergency recovery
OP_ENDIF
```

Phase 1 uses HSM for the protocol key. Phase 2 migrates to MPC (multi-party computation) for distributed key custody.

### Layer 2 — Bitcoin SPV contract (Soroban)

A stateless Soroban contract that verifies Bitcoin transaction inclusion. "Stateless" means the caller provides all data at verification time — headers, Merkle proof, raw transaction — and the contract verifies without storing state. This eliminates the relayer dependency that caused BTC Relay (Ethereum, 2016) to fail.

**Deployed on Soroban testnet:** `CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC`

Core operations:
- SHA256d (Bitcoin's double-SHA256) using Soroban host `env.crypto().sha256()`
- Header chain continuity: `prev_block_hash(headers[i]) == SHA256d(headers[i-1])`
- Merkle inclusion: walks from txid to Merkle root using sibling hashes
- On-chain Bitcoin tx parsing: finds the P2WSH output to verify the deposited satoshi amount

### Layer 3 — PrivateLend contract (Soroban)

Lending logic above the SPV layer. Key design decisions:

- **Per-entry persistent storage** (no growing instance collections — following CertiK's Soroban vulnerability research)
- **Cross-contract SPV call** at deposit time before creating a position
- **Kinked interest rate model**: base=0%, Uoptimal=75%, slope1=8%, slope2=200%, protocol fee=15%
- **Phase 1 liquidation**: trusted keeper detects undercollateralized positions and submits; Phase 2 uses ZK proof of undercollateralization

Current state: 50 tests passing, 23.7 KB WASM, 14 exported functions.

### Layer 4 — ZK privacy layer (Phase 2)

Three Circom circuits on Groth16 / BN254:
- **Deposit circuit** (~280 constraints): creates a Poseidon commitment to the position
- **Borrow/repay circuit** (~10,500 constraints): proves state transition preserves collateral ratio without revealing amounts
- **Liquidation circuit** (~9,000 constraints): proves undercollateralization without revealing the specific amounts

Protocol X-Ray (Protocol 25, January 2026) added BN254 elliptic curve operations and Poseidon hash to Soroban host functions — the exact primitives Groth16 verification requires.

### Supporting infrastructure

- **SPV Relayer** (Node.js): REST API that fetches Bitcoin block headers + Merkle proofs from Blockstream Esplora. Writz-operated for Phase 1, decentralized in Phase 2. Stateless SPV means the relayer is a convenience service, not a protocol dependency.
- **P2WSH library** (TypeScript): generates deposit addresses, builds PSBTs for both spending paths, signs with the protocol key. Used by the frontend and backend.
- **Oracle** (SEP-40): RedStone primary, Pyth secondary, median of both for manipulation resistance. Phase 1 uses a stub; Phase 2 wires real feeds.

---

## 5. Team

**Sebastian Salazar** — Founder and sole developer at this stage.

Deep understanding of the full technical stack: Bitcoin scripting (P2WSH, PSBT, CLTV), Soroban/Rust smart contracts, TypeScript systems engineering, ZK circuit design (Circom/Groth16), and Stellar's ZK infrastructure (Protocol X-Ray).

The protocol concept, architecture, research, and all current code were produced by Sebastian. The research phase (15 documents, covering SPV implementations, oracle design, interest rate modeling, ZK circuit architecture, regulatory landscape, and more) preceded any code, establishing deep domain knowledge before building.

**Current state:** All Phase 0 research complete. Phase 1 foundation complete: SPV contract deployed on testnet, SPV relayer operational, P2WSH library with 48 tests, PrivateLend skeleton with 50 tests.

**Planned team growth with grant:** The $92K grant funds one additional Rust/Soroban developer for the ZK circuit implementation sprint (Phase 2) and frontend development (Phase 2–3).

**AI-assisted artifacts disclosure** (required by SCF Open Track): Research documents and code were produced with AI assistance (Claude Code). All architecture decisions, technical direction, and implementation choices are Sebastian's own. All code has been reviewed, tested, and understood by Sebastian before committing. The AI tooling accelerated the research and implementation phases — it did not replace the technical judgment.

---

## 6. Why Writz is novel (not a replication)

The SCF handbook explicitly filters projects replicating existing solutions on Stellar. Writz qualifies as novel on three dimensions:

1. **No existing Bitcoin SPV client on Soroban.** Searching the Stellar ecosystem, there is no deployed smart contract that verifies Bitcoin transactions cryptographically. This is a new primitive for the ecosystem.

2. **No ZK-private lending on Stellar.** Blend (the leading Stellar lending protocol) is fully public. Writz adds a privacy layer using Protocol X-Ray that Blend's architecture cannot retrofit.

3. **No trustless BTC collateral anywhere on Stellar.** There are no BTC-collateralized loans on Stellar today. All existing Stellar lending uses native Stellar assets or USDC. Writz brings a new collateral class and a new user segment.

---

## 7. Ecosystem impact

**What Writz does for Stellar:**

- Brings Bitcoin TVL to Stellar for the first time as a genuine, trustless collateral asset
- Opens BTCfi to the 77% of Bitcoin holders who have never tried DeFi (primary growth market)
- Creates an open Bitcoin SPV SDK that any Stellar protocol can integrate — infrastructure that multiplies ecosystem value beyond Writz itself
- Increases USDC utilization on Stellar (USDC supply side benefits from BTC-collateralized borrowing demand)
- Demonstrates Protocol X-Ray's practical privacy capabilities to the wider DeFi community

**Measurable on-chain metrics:**

| Metric | Phase 1 target | Phase 2 target |
|---|---|---|
| SPV verifications (testnet) | 100+ | — |
| PrivateLend TVL (mainnet) | — | $50K (launch cap) |
| Monthly USDC volume | — | $250K |
| Protocols using SPV SDK | — | 1 (Writz itself) |
| DeFiLlama listed | — | ✅ |
| Audit completed (0 critical findings) | — | ✅ |

---

## 8. Business model and sustainability

Writz generates revenue from day one of mainnet:

| Revenue stream | Mechanism | Year 1 estimate |
|---|---|---|
| Lending spread | 15% of borrow interest income | ~$13,500/year at $1M TVL, 75% utilization |
| SPV API access | $0.10–$0.50/verification or $500–$5K/month subscription | $12,000–$60,000/year |
| Dark Swap fees | 0.3% on BTC/USDC swaps (Phase 3) | $30,000–$90,000/year |
| Proof of Reserve SaaS | $2,000–$10,000/month enterprise (Phase 3) | $24,000–$120,000/year |

**The grant does not fund operations.** The $92,000 covers the development sprint to reach mainnet. Once live, protocol revenue sustains the team. This is not a public good that requires perpetual SDF support.

Post-launch programs Writz intends to apply for: Growth Hack Program (after 60 days live) and Liquidity Award (after $250K TVL for 7 consecutive days).

---

## 9. Grant budget breakdown

**Total requested: $92,000 worth of XLM (one-time application)**

| Item | Amount | Rationale |
|---|---|---|
| ZK circuit implementation (Circom — 3 circuits) | $28,000 | 3–4 months of specialist ZK engineering (Circom, snarkjs, trusted setup ceremony coordination) |
| Soroban ZK verifier integration | $18,000 | Integrating Groth16 verification into PrivateLend using Protocol X-Ray BN254 ops |
| Frontend development (app.writz.io) | $22,000 | Next.js app, Xverse wallet integration, Freighter integration, Stellar Wallets Kit |
| Infrastructure (relayer hosting, RPC, CI/CD) | $8,000 | 12-month runway for decentralized relayer, Bitcoin RPC node, testnet/mainnet infrastructure |
| Legal entity setup (Swiss GmbH) | $8,000 | Switzerland recommended by regulatory research for DeFi protocols |
| Security tooling and bug bounty seed | $8,000 | Mythril/Slither scans, Certora specs, initial bug bounty program |

**Not included in this budget:** Security audit costs. These are handled separately through the Soroban Audit Bank program (SDF covers up to 100% of audit cost for SCF-funded projects). Writz will apply to the Audit Bank immediately after receiving the SCF grant.

---

## 10. Milestones

See [`scf/milestone-plan.md`](milestone-plan.md) for the detailed four-tranche breakdown.

**Summary:**
- **Tranche #0 (10%, ~$9,200):** SPV contract verifies a real Bitcoin mainnet tx on Soroban testnet. GitHub public. Docs on Mintlify. Demo video.
- **Tranche #1 (20%, ~$18,400):** PrivateLend v1 on testnet. ZK-private deposit + borrow flow end-to-end on testnet.
- **Tranche #2 (30%, ~$27,600):** All three Circom circuits complete. Trusted setup ceremony. Frontend v1 on testnet. STRIDE threat model.
- **Tranche #3 (40%, ~$36,800):** Mainnet deployment. First real BTC deposit. DeFiLlama listed. $50K TVL cap public launch.

---

## 11. Links

- **Documentation:** [docs.writz.io](https://docs.writz.io) (Mintlify — live before Tranche #0 submission)
- **GitHub:** [github.com/writz-protocol/writz](https://github.com/writz-protocol/writz) (going public before submission)
- **Testnet SPV contract:** `CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC`
- **Demo video:** [Recorded before Tranche #0 submission]
- **Team video:** [Recorded before submission]

---

## 12. Declaration

Writz Protocol is applying to the Stellar Community Fund **once**, for **$92,000**. This is the complete and final ask. The protocol has a real business model and does not depend on future SDF funding for operational sustainability. We view this grant as a strategic alliance with Stellar — Writz benefits from the development runway, and Stellar gains its first trustless Bitcoin DeFi infrastructure.

We commit to the Soroban Audit Bank process as a condition of mainnet launch, and to open-sourcing the Bitcoin SPV SDK as reusable infrastructure for the Stellar ecosystem.
