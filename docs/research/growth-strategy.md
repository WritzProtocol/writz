# Research: Growth Strategy & Business Development

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## The Core Challenge: 77% of Bitcoin Holders Have Never Tried BTCfi

The single most important market insight for Writz's growth strategy comes from a 2026 survey of 700+ Bitcoin holders in North America and Europe:

- **77%** have never used a BTCfi platform
- Only **10%** have tried one once or twice
- Only **8%** use BTCfi regularly
- **65%** couldn't name a single BTCfi project

This is simultaneously the biggest obstacle and the biggest opportunity. The BTCfi market is massively underpenetrated relative to the value locked in Bitcoin ($1T+ in HODLers). The question is not whether the market exists — it's how to reach people who have never participated in DeFi before.

The second insight: **Bitcoin holders are not Ethereum users.** They are more conservative, more skeptical of complexity, and more likely to trust a product that feels simple and safe than one that feels like DeFi. Writz's UX and messaging must reflect this.

---

## Target User Segments

### Segment 1: The Sophisticated Bitcoin Holder (Primary)

**Who they are:** Individuals holding 0.5–10 BTC who have held for 2+ years, understand Bitcoin deeply, but haven't ventured into DeFi. They've seen the hacks, the rug pulls, and the liquidation cascades. They want yield on their BTC but don't trust most DeFi protocols.

**What they need:** A product that feels more like a financial service than a DeFi protocol. Trustless (no custodian), audited, simple UI, and privacy.

**Where to find them:** Bitcoin Twitter (Crypto Twitter / CT), Bitcoin meetups, podcasts like "What Bitcoin Did", "The Bitcoin Standard Podcast", and Bitcoin Reddit communities.

**Message that works:** *"Borrow USDC against your BTC without giving it to anyone. No custodian. No KYC. No public position."*

### Segment 2: Stellar DeFi Native Users (Fastest to Convert)

**Who they are:** Existing Stellar/Soroban DeFi users who already use Blend, the Stellar DEX, or hold USDC on Stellar. They understand the ecosystem and trust Stellar's infrastructure.

**What they need:** BTC exposure in the ecosystem they already use. They may not even own BTC — they want to lend USDC and earn yield from BTC borrowers.

**Where to find them:** Stellar Discord, Stellar subreddit, Lobstr/Freighter wallet users, Blend users.

**Message that works:** *"Earn yield on your USDC from Bitcoin borrowers. Higher rates, ZK-private, on the network you already use."*

### Segment 3: Privacy-Focused DeFi Users (High Conviction)

**Who they are:** Users who specifically seek privacy in their financial transactions. They know about Aztec, Penumbra, Tornado Cash's legacy. They follow ZK proof developments closely.

**What they need:** A protocol that takes privacy seriously from a technical standpoint, not as a marketing angle. They will scrutinize the ZK circuit design and audit reports.

**Where to find them:** ZK Twitter (ZKProof.org community, Aztec Discord), privacy-focused Telegram groups, Mirror.xyz essays on ZK privacy.

**Message that works:** *"Circom + Groth16 on Stellar's Protocol X-Ray. Positions hidden by ZK proofs. Circom circuit audit published. Here's the code."*

### Segment 4: Institutional Bitcoin Holders (Long-Term, High Value)

**Who they are:** Family offices, crypto funds, and corporate treasuries holding BTC. They need compliant, audited, privacy-preserving yield on idle BTC. $73.8B in publicly held corporate BTC, $29.3B in private company BTC.

**What they need:** Compliance (ASP system), audit trail for their own reporting, institutional-grade custody of collateral (MPC-based protocol key), legal clarity on jurisdiction.

**Where to find them:** Crypto-specific institutional conferences (Consensus, TOKEN2049, Messari Mainnet), direct BD outreach to crypto fund operators, partnership with institutional custody providers (Fireblocks, Copper, Anchorage).

**Message that works:** *"Private BTC collateral with compliance-grade audit trail. Groth16 ZK proofs with ASP allow-list. Audited by OtterSec."*

---

## Growth Flywheel

Writz's growth is self-reinforcing once the flywheel starts:

```
More BTC deposited
       │
       ▼
More USDC liquidity needed
       │
       ▼
Higher USDC supply yields attract lenders
       │
       ▼
Larger USDC pool → better rates for borrowers
       │
       ▼
More BTC deposited  ← (cycle repeats)
```

**The second flywheel: infrastructure adoption**

```
More protocols use Writz SPV SDK
       │
       ▼
More Bitcoin activity verified on Stellar
       │
       ▼
BTC becomes a first-class asset in Stellar ecosystem
       │
       ▼
Writz becomes canonical Bitcoin infrastructure on Stellar
       │
       ▼
More protocols built on Writz → more SPV API revenue
```

---

## Phase-by-Phase Growth Strategy

### Phase 1: Builders and Early Adopters (Testnet — Q3/Q4 2026)

**Goal:** Build technical credibility and a community of 500–1,000 highly engaged early users before mainnet.

**Tactics:**

1. **Public build in the open**
Write technical threads on X about what we're building as we build it: how Bitcoin SPV works in Rust, how Circom circuits for lending work, what ZK-private liquidations look like. This is not marketing — it is education that positions Writz as the most technically credible BTCfi protocol on Stellar. Technical credibility is the only credibility that matters in this audience.

2. **Testnet early access program**
Invite 100–200 technical users to test the SPV client and PrivateLend on testnet before mainnet. Assign unique testnet NFTs or "early contributor" tags. These users become the first word-of-mouth advocates and beta testers who catch bugs before real money is at risk.

3. **Open-source GitHub presence**
A well-documented, actively maintained public GitHub is a growth channel. Stellar developers browsing for Bitcoin infrastructure will find Writz's SPV SDK. Star count and contributor count are credibility signals to both users and investors.

4. **Stellar ecosystem presence**
- Active in Stellar Discord (#developers, #defi channels)
- Post regular updates in the Stellar developer forum
- Apply to present at Meridian 2026 conference (Q3 2026)
- Contribute to Stellar GitHub discussions (CAP proposals, SEP discussions)

5. **ZK and BTCfi Twitter**
Engage with ZK proof researchers and BTCfi builders. Not promotional — educational. Share insights from the Circom circuit design, the trusted setup ceremony, the Protocol 26 cost benchmarks. Earn follows through depth, not volume.

---

### Phase 2: First 1,000 Users (Mainnet Launch — Q4 2026 to Q2 2027)

**Goal:** $1M TVL, 1,000 active wallets, first institutional customer for Proof of Reserve.

**Tactics:**

1. **Points program (pre-token)**
Before the WRTZ token launches, run a points program. Users earn points for:
- Depositing BTC as collateral (points per BTC-day locked)
- Supplying USDC to the lending pool (points per USDC-day supplied)
- Using Dark Swap (points per dollar swapped)
- Referring verified new users (flat bonus)

Points convert to WRTZ token allocation at launch. Anti-Sybil: minimum deposit sizes, on-chain activity requirements, wallet age requirements.

**Why points, not an immediate airdrop:** Points programs create sustained engagement over months. They reward the users who actually use the protocol (not farmers who deposit and immediately withdraw), and they create excitement around a future token event without committing to a specific date or distribution.

2. **Strategic deposit incentives**
For the first 90 days, reduce the protocol fee to 0%. 100% of interest goes to USDC suppliers. This creates above-market APY for early lenders (10–15%+ vs. 5% elsewhere on Stellar), bootstrapping the liquidity pool.

3. **Protocol-owned liquidity seed**
Use $50,000–$100,000 from the SCF grant proceeds (after audit) to seed the USDC pool with protocol-owned capital. This ensures borrowers can actually borrow from day one without waiting for organic lenders.

4. **Integration with Stellar wallet ecosystem**
Work with Freighter and Lobstr to list PrivateLend as a featured dApp. Both wallets have millions of users who are one click from becoming Writz lenders. This is the fastest path to Segment 2 (Stellar native users).

5. **Proof of Reserve first enterprise customer**
Direct outreach to 10 crypto companies on Stellar (exchanges, OTC desks, fintechs using Stellar USDC) offering the Proof of Reserve product. Goal: 1 paying customer before the end of Q4 2026. A real enterprise customer is the most credible signal to subsequent customers.

6. **Content marketing: Bitcoin + Privacy**
Publish 2 high-quality long-form pieces per month:
- Technical: "How Writz verifies Bitcoin transactions in a Soroban smart contract" (targets technical audience)
- Product: "Why your DeFi positions should be private" (targets general crypto audience)

Distribute on Mirror.xyz, Medium, and the Writz blog. Quality over quantity — one genuinely insightful piece generates more inbound than 10 promotional ones.

---

### Phase 3: Scale to $10M TVL (2027)

**Goal:** $10M TVL, 5,000+ active wallets, WRTZ token launch, first institutional partnership.

**Tactics:**

1. **WRTZ token launch**
Only after: $5M TVL sustained for 60+ days, 500+ active users, one completed external audit. Launch via a fair IDO or liquidity bootstrapping pool (LBP) — no VCs getting early access at 80% discount. Community-first distribution signals alignment with users.

2. **Institutional BD program**
Dedicated institutional sales motion targeting:
- Crypto hedge funds with BTC positions seeking yield
- Family offices with Bitcoin treasuries
- Mining companies with BTC on balance sheet

Direct outreach, private demos, compliance documentation package. Target: 3–5 institutional deposits of $100,000+ each.

3. **Ambassador program**
Recruit 10–20 ambassadors from the Bitcoin and Stellar communities. Structure:
- Monthly WRTZ token allocation (vests over 6 months)
- Performance bonuses: new users referred, community content created, bugs reported
- Clear expectations: 2 community posts/week, answer questions in Discord, represent Writz at local Bitcoin meetups

4. **DeFi aggregator listings**
Get Writz listed on DeFiLlama (TVL tracking), Nansen (wallet intelligence), and relevant DeFi dashboards. These are not marketing — they are credibility infrastructure. Being on DeFiLlama's protocol list means investors and serious DeFi users can find and track Writz without any active promotion.

5. **Cross-protocol integrations (ecosystem flywheel)**
Work with other Stellar DeFi protocols (Blend, any Stellar AMM) to integrate Writz's SPV SDK. Each integration creates a technical partnership, distributes the SPV client further, and generates API revenue. Target: 3 integrations by end of 2027.

---

## Verifiable Traction: What Actually Matters to Investors

### The metrics that prove product-market fit

DeFi investors in 2026 have seen too many protocols with high TVL and no real usage. The metrics that matter are:

| Metric | What it measures | How Writz tracks it |
|---|---|---|
| **TVL** | Capital confidence | DefiLlama listing, on-chain |
| **TVL stickiness** | How long capital stays | Average deposit duration (days) |
| **Revenue (protocol fees)** | Real usage, not farming | On-chain fee contract |
| **Fee/TVL ratio** | Capital efficiency | Protocol revenue ÷ TVL |
| **Unique wallets (30-day active)** | Real user base | On-chain wallet analysis |
| **Borrow utilization** | Pool health | Borrowed USDC ÷ Supplied USDC |
| **Liquidation health** | Risk management quality | % of positions near liquidation threshold |
| **Audit status** | Security credibility | Published audit report link |
| **GitHub activity** | Development health | Commits, PRs, issues closed |
| **Protocol uptime** | Reliability | No unplanned downtime |

### The metrics that make a great fundraising story

When Writz raises its institutional round (2027, post-$1M TVL), the narrative is built on:

1. **First-mover in a specific niche** — "First trustless Bitcoin DeFi with ZK privacy on Stellar. Nobody can replicate this in less than 18 months."

2. **Real revenue from day one** — "We generate protocol fees from every loan. At $5M TVL with 75% utilization, that's $45K/year in spread revenue — growing with TVL."

3. **Ecosystem moat** — "Our open Bitcoin SPV SDK is already used by 3 other Stellar protocols. Switching cost is high — they'd have to rebuild BTC verification from scratch."

4. **Capital efficiency** — "Our TVL is productive. 75%+ utilization means almost every dollar of supplied USDC is earning yield. We don't have idle capital."

5. **Conservative risk management** — "150% collateral ratio, 120% liquidation threshold, 6-confirmation Bitcoin deposits. We have never had a bad debt event."

### How to make traction visible and verifiable

**DeFiLlama listing (day 1 post-mainnet):** Submit to DeFiLlama immediately after mainnet. Every serious DeFi investor checks DeFiLlama. A protocol not listed doesn't exist to this audience.

**On-chain transparency dashboard:** Build a public `/stats` page showing real-time: TVL, USDC utilization, total fees earned, number of active positions (without revealing amounts), total BTC locked. These numbers are all computable from public on-chain data — no trust required. Investors can verify independently.

**Monthly protocol reports:** Publish a one-page monthly report: TVL, revenue, unique wallets, notable events, upcoming milestones. Archive all reports publicly. This creates a verifiable track record that compounds over time.

**Third-party analytics:** When Nansen, Dune Analytics, or DeFiLlama publish dashboards tracking Writz, that's more credible than Writz's own numbers. Encourage community members to build public Dune dashboards tracking protocol metrics.

---

## Community Building

### Discord structure

```
Writz Protocol Discord
├── #announcements           → Protocol updates, audit results, milestones
├── #general                 → Open discussion
├── #technical               → SPV, ZK circuits, Soroban dev discussion
├── #support                 → User help (deposits, withdrawals, UI issues)
├── #governance              → Future: WRTZ proposal discussion
├── #ambassador-lounge       → Private channel for ambassadors
└── #alerts                  → Automated on-chain event notifications
```

**Community management principle:** Quality over quantity. 500 engaged technical users in Discord are worth more than 50,000 passive followers on Twitter. Every question answered thoroughly is content that lives forever in Discord search.

### X (Twitter) strategy

- **Post cadence:** 3–5 posts per week, not 3–5 per day
- **Content mix:** 40% technical education, 30% protocol updates, 20% ecosystem commentary, 10% culture/humor
- **Thread format:** Long technical threads perform better than short promotional posts in the DeFi audience
- **Engage with:** Stellar ecosystem accounts, ZK proof researchers, BTCfi builders, Bitcoin-friendly DeFi accounts

### Content calendar anchors

| Month | Content focus |
|---|---|
| Month 1 post-mainnet | "We're live. Here's how it works." Deep technical explainer. |
| Month 2 | First stats report. Show the numbers transparently. |
| Month 3 | "30 days of ZK-private lending on Stellar." Retrospective. |
| Month 6 | "Path to $5M TVL." Public milestone commitment. |
| Post-$5M TVL | WRTZ token announcement. |

---

## Key Business Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Primary acquisition channel | Technical content + open-source | Bitcoin holders trust proof, not advertising |
| Incentive structure | Points program (pre-token) | Rewards real usage, not farming |
| Liquidity bootstrap | Protocol-owned seed + 0% fee period | Chicken/egg solved with own capital |
| Token launch timing | Post $5M TVL | Product-market fit first |
| Institutional GTM | Direct BD, not ads | High-value segment requires relationship sales |
| Traction proof | On-chain dashboard + DeFiLlama | Third-party verification is more credible than self-reported |
| Community platform | Discord (primary) + X (secondary) | Discord for depth, X for reach |

---

*Last updated: 2026-06-22*
*Sources: [BTCFi User Acquisition Challenge](https://bitmarkets.com/en/insights/article/77-of-bitcoin-holders-have-never-tried-btcfi) · [DeFi Marketing 2026 Guide](https://surgence.io/blog/defi-marketing) · [DeFi Traction Metrics](https://defillama.com/metrics) · [Points Programs in Web3](https://defiprime.com/points-based-token-distribution-programs-web3) · [Airdrops Evolution 2026](https://www.dlnews.com/articles/defi/how-crypto-airdrops-will-change-in-2026/)*
