# Research: Market Landscape — BTCfi + Privacy on Stellar

**Author:** Justin (Business Analyst)
**Date:** 2026-06-22
**Status:** Complete — initial survey

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

**Key observation:** Every significant BTCfi player is either on Ethereum or a Bitcoin L2/sidechain. **None are on Stellar.** And none offer full ZK-privacy for positions.

---

## Privacy Market

### Why privacy matters in DeFi

Public blockchain DeFi has a fundamental problem: every position, every trade, every liquidation threshold is visible to anyone. This creates:

- **Front-running:** Bots watch liquidation thresholds and exploit them
- **Competitive intelligence leakage:** Institutional players don't want competitors seeing their positions
- **Personal financial exposure:** Individuals don't want their net worth and borrowing behavior public
- **Regulatory uncertainty:** Some jurisdictions treat DeFi activity differently based on public visibility

### Privacy in crypto — 2026 state

Zero-knowledge proofs have moved from experimental to practical infrastructure:
- Proof generation is orders of magnitude faster than 2022 — GPU/FPGA-accelerated provers produce basic proofs in milliseconds
- ZK has gone from research tool to production infrastructure (Starknet, zkSync, Aztec, etc.)
- The regulatory conversation has shifted toward "selective transparency" — private by default, auditable on request

### Stellar's privacy position

Stellar launched **Protocol X-Ray** in January 2026, making it uniquely positioned:

| Feature | Detail |
|---|---|
| **ZK proof verification** | Noir circuit proofs verifiable inside Soroban smart contracts |
| **Stellar Private Payments** | Open-source framework: private deposits, transfers, and withdrawals using Groth16 ZK proofs |
| **Compliance hooks** | Association Set Providers (ASPs) enable selective disclosure to regulators — "open by default, private when needed" |
| **Protocol 24 roadmap** | Confidential assets are the next milestone — Stellar views privacy as a multi-year buildout |

Stellar is the only major blockchain with ZK privacy infrastructure that is simultaneously **compliance-friendly**. This is critical for institutional adoption.

---

## Stellar Ecosystem

### Key metrics (2025–2026)

- **USDC volume:** $500M/month on Stellar — the dominant stablecoin, real usage not speculation
- **Network operations:** Surpassed 1 billion network operations in Q3 2025
- **Soroban maturity:** Smart contracts moved from early experimentation to production-grade deployments
- **RWA tokenization:** Hit $3B target set by SDF
- **Protocol 23 (Whisk, Sep 2025):** Parallel smart contract execution — significantly faster network

### DeFi protocols on Stellar

| Protocol | Type | BTC support | Privacy |
|---|---|---|---|
| Blend | Lending (Aave-style) | No | No |
| Stellar DEX | Native AMM | No native BTC | No |
| Various AMMs | Soroban-based | No | No |

**Gap:** There is no protocol on Stellar that handles real BTC as collateral or for trading. The entire BTCfi category is empty on Stellar.

### USDC + Stellar = unique combination

USDC is the world's most regulated and trusted stablecoin. On Stellar, USDC is natively issued by Circle — not bridged. This means:
- No bridge risk on the USDC side
- Stellar USDC is the same USDC that businesses already use for payments, remittances, and treasury
- Users borrowing USDC on Writz are getting a real, liquid, institutionally recognized asset

This combination — real BTC collateral + real USDC output — makes Writz Protocol's value proposition immediately understandable to mainstream financial players.

---

## Competitive Analysis

### Direct competitors to Writz Protocol

Nobody is building exactly what Writz is building. The closest analogues are:

**On privacy + DeFi:** Aztec Network (Ethereum), Penumbra (Cosmos) — but none handle BTC natively and none are on Stellar.

**On BTCfi:** Stacks, RSK, Interlay — but none have ZK privacy and none are on Stellar.

**On Stellar DeFi:** Blend — but no BTC support and no privacy.

### Indirect competitors

| Competitor | Why they're indirect | Writz advantage |
|---|---|---|
| WBTC on Aave | Custodial bridge, no privacy, Ethereum fees | Trustless, private, Stellar low fees |
| tBTC | Complex threshold bridge, no privacy | Simpler UX, ZK privacy |
| Blend | On Stellar, but no BTC | Same ecosystem + BTC + privacy |
| Stacks sBTC | Bitcoin-native, but no privacy, no Stellar | ZK privacy, USDC output |

### The competitive moat

Writz's moat is **technical first-mover advantage in a specific niche**:
1. First Bitcoin SPV client on Soroban — takes 12–18 months to build and audit
2. First integration of Stellar's ZK privacy (Protocol X-Ray) with BTC collateral
3. Open SDK creates ecosystem lock-in — once Stellar wallets/protocols build on Writz SPV, switching is costly

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

1. Protocol X-Ray launched January 2026 — the ZK infrastructure is production-ready TODAY
2. BTCfi is in a growth phase — early but proven market
3. Stellar has real USDC liquidity — not a chicken-and-egg problem on the output side
4. Soroban has matured — Protocol 23 brought parallel execution; smart contracts are production-grade
5. The summa-tx Rust SPV library exists — no need to build cryptographic primitives from scratch

**Window:** 12–18 months before a well-funded competitor could plausibly replicate the SPV + ZK combination on Stellar. The first-mover in a niche this specific tends to hold the position.

---

*Last updated: 2026-06-22*
