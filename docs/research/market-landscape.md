# Research: Market Landscape - BTCfi + Privacy on Stellar

**Author:** Justin (Business Analyst)
**Date:** 2026-06-22
**Status:** Complete - initial survey (updated 2026-08-04: Solv Protocol + Templar Protocol findings - see dated addendum in Competitive Analysis)

---

## BTCfi Market

### Growth trajectory

Bitcoin DeFi has been one of the breakout trends of the 2024–2025 cycle:

| Date | BTCfi TVL |
|---|---|
| January 2024 | $304M |
| December 2024 | $7B+ |
| Mid 2025 | $8.6B+ |

That is a **28x growth in 18 months**. The market is expanding fast and still early.

### What is driving growth

- Bitcoin holders want to generate yield without selling BTC or giving up custody
- Institutional interest in BTC-collateralized lending (cleaner regulatory profile than altcoins)
- Maturing cross-chain infrastructure making BTC accessible on other chains
- Bitcoin's "digital gold" narrative evolving toward "productive asset"

### Current BTCfi players

| Protocol | Chain | Mechanism | Privacy |
|---|---|---|---|
| WBTC (BitGo) | Ethereum | Custodial bridge | None |
| tBTC | Ethereum | Threshold signatures | None |
| Aave (WBTC collateral) | Ethereum | Lending | None |
| Compound (WBTC collateral) | Ethereum | Lending | None |
| Stacks (sBTC) | Stacks L2 | Threshold bridge | None |
| RSK (RBTC) | RSK sidechain | Federated peg | None |
| Starknet (strkBTC) | Starknet | ZK-powered | Partial |
| Interlay (iBTC) | Polkadot | Collateralized vaults | None |
| Solv Protocol (SolvBTC) | Ethereum, BNB, Arbitrum, **Stellar (Soroban, live)**, +7 others | Custodial: 3rd-party custodians + FROST threshold-signature reserve network, NAV oracle | None (blacklist/pausable token, built for compliance not privacy) |
| Templar Protocol | NEAR (native BTC lending, mainnet) - Soroban vault also live on Stellar today, but XLM-collateralized only | NEAR side: MPC/chain-signature Bitcoin light client, no wrapping. Stellar side: curator vault + Blend adapter (Upshift infra) | None |

**Key observation (updated 2026-08-04):** Ethereum and Bitcoin L2/sidechains still dominate BTCfi by volume, but **the "None are on Stellar" claim from the original June survey is no longer accurate** and should not be reused as-is. Two Stellar-relevant players now exist:
- **Solv Protocol** already runs an audited SolvBTC deployment on Soroban mainnet with real trading volume ($179K/day Q4 2025 → $372K/day Q1 2026 per Messari). It is fully custodial/wrapped, not privacy-preserving - it doesn't compete with Writz's trust model, but it kills the "we're the only BTCfi thing on Stellar" talking point.
- **Templar Protocol** is the sharper risk: it already proved native-BTC lending *without wrapping* on NEAR (via Bitcoin light client + MPC chain signatures, $4M pre-seed, audited, mainnet), and separately already has a live, Halborn-audited Soroban vault on Stellar (via Blend, currently XLM-collateral only) plus a cross-chain bridge (`omni-sdk`) that explicitly lists Stellar among its supported chains. They have not yet connected native BTC collateral to the Stellar vault - but all the components exist in their own GitHub org today, and their core `contracts` repo is under active daily development.

Neither currently offers **ZK-private** BTC-collateralized borrowing on Stellar - that claim still holds. But the clean "no BTCfi exists on Stellar" framing needs to retire; the differentiator has to be privacy + trustless SPV specifically, not first-to-Stellar.

---

## Privacy Market

### Why privacy matters in DeFi

Public blockchain DeFi has a fundamental problem: every position, every trade, every liquidation threshold is visible to anyone. This creates:

- **Front-running:** Bots watch liquidation thresholds and exploit them
- **Competitive intelligence leakage:** Institutional players don't want competitors seeing their positions
- **Personal financial exposure:** Individuals don't want their net worth and borrowing behavior public
- **Regulatory uncertainty:** Some jurisdictions treat DeFi activity differently based on public visibility

### Privacy in crypto - 2026 state

Zero-knowledge proofs have moved from experimental to practical infrastructure:
- Proof generation is orders of magnitude faster than 2022 - GPU/FPGA-accelerated provers produce basic proofs in milliseconds
- ZK has gone from research tool to production infrastructure (Starknet, zkSync, Aztec, etc.)
- The regulatory conversation has shifted toward "selective transparency" - private by default, auditable on request

### Stellar's privacy position

Stellar launched **Protocol X-Ray** in January 2026, making it uniquely positioned:

| Feature | Detail |
|---|---|
| **ZK proof verification** | Noir circuit proofs verifiable inside Soroban smart contracts |
| **Stellar Private Payments** | Open-source framework: private deposits, transfers, and withdrawals using Groth16 ZK proofs |
| **Compliance hooks** | Association Set Providers (ASPs) enable selective disclosure to regulators - "open by default, private when needed" |
| **Protocol 24 roadmap** | Confidential assets are the next milestone - Stellar views privacy as a multi-year buildout |

Stellar is the only major blockchain with ZK privacy infrastructure that is simultaneously **compliance-friendly**. This is critical for institutional adoption.

---

## Stellar Ecosystem

### Key metrics (2025–2026)

- **USDC volume:** $500M/month on Stellar - the dominant stablecoin, real usage not speculation
- **Network operations:** Surpassed 1 billion network operations in Q3 2025
- **Soroban maturity:** Smart contracts moved from early experimentation to production-grade deployments
- **RWA tokenization:** Hit $3B target set by SDF
- **Protocol 23 (Whisk, Sep 2025):** Parallel smart contract execution - significantly faster network

### DeFi protocols on Stellar

| Protocol | Type | BTC support | Privacy |
|---|---|---|---|
| Blend | Lending (Aave-style) | No | No |
| Stellar DEX | Native AMM | No native BTC | No |
| Various AMMs | Soroban-based | No | No |
| Solv Protocol (SolvBTC) | Custodial BTC yield token | Yes - wrapped/custodial only | No |
| Templar Protocol (Soroban Vault) | Curated lending vault on Blend (via Upshift) | No - XLM/RWA collateral, not BTC (yet) | No |

**Gap (revised 2026-08-04):** No protocol on Stellar handles **real, non-custodial BTC** (native UTXO, SPV-verified, no wrapping) as collateral. Solv fills the "some form of BTC exists on Stellar" gap with a fully custodial wrapped token. Templar has live Soroban infrastructure plus proven native-BTC-without-wrapping tech (on NEAR) but has not yet combined the two. The specific gap Writz occupies - trustless SPV-verified native BTC + ZK-private positions, on Stellar - is still open.

### USDC + Stellar = unique combination

USDC is the world's most regulated and trusted stablecoin. On Stellar, USDC is natively issued by Circle - not bridged. This means:
- No bridge risk on the USDC side
- Stellar USDC is the same USDC that businesses already use for payments, remittances, and treasury
- Users borrowing USDC on Writz are getting a real, liquid, institutionally recognized asset

This combination - real BTC collateral + real USDC output - makes Writz Protocol's value proposition immediately understandable to mainstream financial players.

---

## Competitive Analysis

### Direct competitors to Writz Protocol

Nobody is building exactly what Writz is building. The closest analogues are:

**On privacy + DeFi:** Aztec Network (Ethereum), Penumbra (Cosmos) - but none handle BTC natively and none are on Stellar.

**On BTCfi:** Stacks, RSK, Interlay - but none have ZK privacy and none are on Stellar.

**On Stellar DeFi:** Blend - but no BTC support and no privacy.

### Indirect competitors

| Competitor | Why they're indirect | Writz advantage |
|---|---|---|
| WBTC on Aave | Custodial bridge, no privacy, Ethereum fees | Trustless, private, Stellar low fees |
| tBTC | Complex threshold bridge, no privacy | Simpler UX, ZK privacy |
| Blend | On Stellar, but no BTC | Same ecosystem + BTC + privacy |
| Stacks sBTC | Bitcoin-native, but no privacy, no Stellar | ZK privacy, USDC output |
| Solv Protocol (SolvBTC) | Live on Stellar, real volume, but fully custodial + no privacy - targets USDC holders wanting BTC yield, not BTC holders wanting private loans | Trustless custody (user's own P2WSH), ZK-private positions, opposite flow direction |
| Templar Protocol | Native-BTC-no-wrap tech proven on NEAR + live Soroban vault infra on Stellar already - closest thing to a credible fast-follower if they connect the two | No privacy in either deployment; Writz's SPV+ZK combination still unreplicated anywhere, but the execution gap to close it is smaller for Templar than for a from-scratch entrant |

### The competitive moat

Writz's moat is **technical first-mover advantage in a specific niche**:
1. First Bitcoin SPV client on Soroban - takes 12–18 months to build and audit
2. First integration of Stellar's ZK privacy (Protocol X-Ray) with BTC collateral
3. Open SDK creates ecosystem lock-in - once Stellar wallets/protocols build on Writz SPV, switching is costly

### Update - 2026-08-04: Solv Protocol + Templar Protocol findings

Deeper research (prompted by evaluating a potential Solv integration) surfaced two corrections to the picture above:

**Solv Protocol** is live on Stellar Soroban mainnet (`solv-finance/SolvBTC-Stellar-Contract`, audited, real trading volume). It does not threaten Writz's moat directly - SolvBTC is custodial (third-party custodians + FROST threshold-signature reserve, NAV oracle, blacklist/pausable token) and serves the opposite customer flow (USDC holders wanting BTC-denominated yield, not BTC holders wanting private loans). Its relevance is narrative, not architectural: it retires the "nothing BTC-related exists on Stellar" talking point and means Writz has to lead with "trustless + private," not "first."

**Templar Protocol** is a more serious signal. On NEAR, it already runs a mainnet, audited, $4M-pre-seed-funded lending product that takes **native BTC as collateral with no wrapping**, using a Bitcoin light client plus MPC/chain-signature threshold custody (NEAR's chain-abstraction stack) instead of Writz's SPV-proof + P2WSH-covenant approach - architecturally different (MPC threshold trust vs. pure cryptographic verification) but marketed with similar "no custodian, no wrapping" language. Separately, Templar already has a **live, Halborn-audited Soroban vault on Stellar** (via a Blend lending-market adapter, part of Upshift's multi-chain vault rollout), currently limited to XLM collateral. Its own `omni-sdk` bridge already lists Stellar among its 10+ supported chains, and its core contracts repo shows same-day commit activity as of this writing. Templar has not yet routed native BTC collateral into its Stellar vault - but every component needed to do so (BTC light client, MPC custody, cross-chain bridge with Stellar support, audited Soroban vault) already exists in their GitHub org. This is the most credible fast-follower risk identified so far - closer and faster-moving than Babylon Labs (no Stellar presence at all) precisely because Templar's Stellar infrastructure is already shipped, audited, and live; only the BTC-collateral wiring is missing.

**Still true:** no one - Solv, Templar, Babylon, or anyone else surveyed - combines (a) trustless native-BTC verification with no wrapping/custodian/MPC-trust and (b) ZK-private position sizes, on any chain, let alone Stellar. That combination remains Writz's unreplicated core claim. What changed is the confidence interval on "how long until someone else assembles the pieces" - Templar shortens it.

---

## Market Sizing

### Total Addressable Market (TAM)

**BTCfi TAM:** $8.6B TVL and growing. If Writz captures 5% of BTCfi TVL by 2028, that is $430M+ in TVL. Protocol revenues at 1–2% annualized on TVL = $4.3M–$8.6M/year from lending alone.

**Privacy DeFi TAM:** The privacy DeFi category is emerging. Aztec raised $100M. Penumbra raised $23M. The market for private financial infrastructure is early but large.

**LATAM remittances (future product):** $150B/year market where Stellar already has distribution. BTC→USDC private remittances would be a natural extension after the core protocol is established.

### Serviceable Addressable Market (SAM)

Near-term realistic targets:
- Bitcoin holders on Stellar-adjacent ecosystems (existing Stellar users with BTC)
- Privacy-conscious individuals in LATAM with BTC savings
- Crypto-native companies needing ZK Proof of Reserve (post-FTX demand is structural)
- Stellar DeFi protocols wanting BTC exposure

---

## Timing Assessment

**Why now:**

1. Protocol X-Ray launched January 2026 - the ZK infrastructure is production-ready TODAY
2. BTCfi is in a growth phase - early but proven market
3. Stellar has real USDC liquidity - not a chicken-and-egg problem on the output side
4. Soroban has matured - Protocol 23 brought parallel execution; smart contracts are production-grade
5. The summa-tx Rust SPV library exists - no need to build cryptographic primitives from scratch

**Window:** 12–18 months before a well-funded competitor could plausibly replicate the SPV + ZK combination on Stellar - holds for a from-scratch entrant. **Revised for Templar Protocol specifically (2026-08-04):** their Stellar Soroban vault infrastructure and cross-chain bridge are already live and audited, and their native-BTC-no-wrap lending tech is already proven on NEAR mainnet. They are missing (1) the BTC-to-Stellar routing and (2) ZK privacy - neither trivial, but both are integration/feature work on top of shipped infrastructure rather than from-scratch builds. Treat their effective window as materially shorter than 12–18 months; testnet-to-mainnet speed on Writz's side is a competitive variable against Templar specifically, not just a generic risk.

---

*Last updated: 2026-08-04 (Solv Protocol + Templar Protocol competitive findings added - original survey dated 2026-06-22)*
