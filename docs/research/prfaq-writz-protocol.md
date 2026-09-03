---
title: "PRFAQ: Writz Protocol"
status: "in-progress"
created: "2026-07-19"
updated: "2026-08-04"
stage: "1-ignition"
inputs: ["docs/roadmap/vision.md", "docs/research/market-landscape.md", "docs/research/growth-strategy.md", "docs/brainstorming/brainstorming-session-2026-06-22-1000.md"]
---

{/* coaching-notes-stage-1 */}
{/*
Concept type: commercial product (DeFi protocol, eventual token).

Explicit constraint from Sebastián: run this exercise ignoring the already-written
code/contracts/circuits entirely. The press release must be justified from customer
need forward, not from "we already built the SPV client so let's find a customer for it."

Key subagent-equivalent findings (manual research this session, not from local DB):
- Babylon Labs' Trustless Bitcoin Vaults (TBV): non-custodial BTC vaults, borrow
  stablecoins without giving up custody, no wrapping. Partnered with Aave Labs for
  native BTC-backed lending on Aave V4 (announced Dec 2025). Testnet interface live
  at btc-vaults.testnet.babylonlabs.io. Ledger integration (Mar 2026), GoMining
  partnership targeting 1,000 BTC activated (May 2026). NO privacy/ZK feature found.
  NO Stellar presence found. Well-funded, large existing BTC-staker distribution.
- Xoxno (github.com/XOXNO/rs-lending-xlm): generic Soroban money market, SAC-based,
  v1.0.0 tagged 2026-07-18. No Bitcoin support. Not a BTC competitor - a new entrant
  into Writz's USDC-lender liquidity competition (same pool as Blend/Slender/Hatom/
  Laina/Alula/Peridot/HiYield).
- GAP FLAGGED (RESOLVED 2026-08-04): docs/research/market-landscape.md (2026-06-22)
  claimed "None are on Stellar" and had no Babylon TBV entry. Corrected in that doc
  now - see its 2026-08-04 addendum. The Babylon TBV entry itself is still not
  added there and should be folded in alongside Solv/Templar on a future pass.

- NEW FINDINGS (2026-08-04, prompted by evaluating a potential Solv Finance
  integration): two Stellar-relevant BTCfi players exist that the original survey
  missed entirely.
  - Solv Protocol (solv.finance / SolvBTC): already live on Stellar Soroban
    mainnet (github.com/solv-finance/SolvBTC-Stellar-Contract - audited, vault +
    NAV oracle + fungible-token + bridge modules), with real trading volume
    ($179K/day Q4 2025 -> $372K/day Q1 2026 per Messari). Fully custodial (3rd-party
    custodians + FROST threshold-signature reserve network) and privacy-free
    (blacklist/pausable token, built for compliance). Serves the *opposite* customer
    flow from Writz - USDC holders wanting BTC-denominated yield, not BTC holders
    wanting private loans against their own coins. Verdict: not a trust-model
    competitor, but retires "we're the only BTCfi thing on Stellar" as a talking
    point. Integrating SolvBTC as a Writz collateral type was evaluated and
    rejected - would reintroduce exactly the custodian/wrapper dependency Writz's
    core narrative rejects, for no differentiation gain.
  - Templar Protocol (templarfi.org): the sharper risk. Mainnet on NEAR already
    does native-BTC lending with NO wrapping, via a Bitcoin light client + MPC
    chain-signature custody (NEAR chain abstraction) instead of SPV+covenant -
    $4M pre-seed (Robot Ventures, Digital Asset Capital Management), audited.
    Separately, Templar already runs a live, Halborn-audited Soroban vault ON
    STELLAR (via a Blend lending-market adapter, part of Upshift's multi-chain
    vault rollout) - currently XLM-collateral only, no BTC routed to it yet. Their
    own cross-chain bridge (omni-sdk) already lists Stellar among 10+ supported
    chains, and their core contracts repo shows same-day commit activity. They
    have not connected native BTC collateral to the Stellar vault, but every piece
    to do so already exists in their GitHub org, already shipped and audited.
    This is a materially shorter fast-follower window than the 12-18 months
    assumed for a from-scratch entrant - see market-landscape.md's revised timing
    section. Still true, and worth keeping as the sharpest available claim: nobody
    surveyed - Solv, Templar, or Babylon - combines trustless native-BTC
    verification (no wrapping, no MPC-custody trust) WITH ZK-private position
    sizes, on any chain. That combination is still Writz's alone. What changed is
    confidence in how long it stays that way, specifically against Templar.

Why this direction over alternatives: existing vision.md/growth-strategy.md already
define a specific primary customer (Segment 1 - Sophisticated Bitcoin Holder, 0.5-10
BTC, held 2+ years, DeFi-skeptical) with tested message-market-fit language. Fast-
tracked past extended discovery on customer identity because this groundwork already
exists and is specific. Did NOT fast-track past "why Stellar / why Writz, given
Babylon proves the thesis elsewhere" - that required real pressure-testing.

RESOLVED (this session): rejected "we were first on Stellar" as the core answer.
Landed on: privacy/compliance-grade selective disclosure is structural, not a
feature Babylon can bolt onto Aave V4's shared-pool model quickly - because shared
liquidity pools need public solvency data for other participants to trust the pool.
Reframed Babylon's existence as partial market education (Writz doesn't have to pay
to teach "BTC-backed loans without custodians" to the market) with a real risk
attached: whoever ships working mainnet product first captures the trust of the
skeptical Segment 1 buyer, so testnet-to-mainnet speed is now a competitive variable,
not just a technical one.

NEW AXIS SURFACED (2026-07-28, Sebastián's own observation, not something I
prompted): Babylon's advantage isn't only technical/architectural - it's BD.
They have Aave Labs, GoMining, Ledger as named partners and presumably real backers.
Writz has none of that yet. This is a distinct competitive dimension (distribution
and credibility-by-association) separate from the privacy/architecture argument,
and it needs its own line of attack in the PRFAQ - likely surfaces hardest in
Stage 4 (Internal FAQ) under "how do we compete against a better-resourced rival,"
and possibly softens the Stage 2 press release's "Getting Started" section if
early partnerships (wallet integrations, an SDF/Circle relationship, an audit firm)
become part of the credible go-to-market path rather than assumed community pull
alone. Open tension to hold: vision.md's WRTZ section explicitly rejects VC-style
"cliff dumps at steep discounts" as part of its community-first narrative - pursuing
backers/LOIs for credibility must be reconciled with that stance, not silently
contradict it (infra/strategic partners and token-investor VCs are not the same
thing, but the doc doesn't yet draw that line).
*/}
