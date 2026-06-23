# The Problem

## Your Financial Life Is Public

Right now, if you deposit Bitcoin on any lending protocol — Aave, Compound, Blend — anyone in the world can look up your wallet address and see:

- Exactly how much BTC you deposited as collateral
- Exactly how much USDC you borrowed
- Exactly where the price needs to drop before your position gets liquidated
- Every time you borrowed, repaid, or adjusted your position

This isn't a privacy concern. It is a **financial security vulnerability**.

Trading bots monitor liquidation thresholds in real time. Sophisticated players see your position and trade against it. Your liquidation point becomes a target. MEV bots sandwich your transactions. The protocol is working as designed — but the design is working against you.

A bank does not post your loan balance outside the building. Every other DeFi lending protocol does exactly that.

---

## Bitcoin in DeFi Requires Either a Custodian or Exposure

Bitcoin is the world's largest crypto asset by market cap. Yet participating in DeFi with it forces a choice between two bad options:

### Option A: Give your BTC to a custodian

**WBTC** is held by BitGo. One company controls the keys. BitGo can be hacked, regulated, or go bankrupt. In 2023, concerns about custodianship triggered $1B+ in WBTC redemptions in a single week.

**tBTC** uses a threshold signature network. A sufficient coalition of signers could theoretically collude. The trust assumption is distributed, but it is still a trust assumption.

**Stacks sBTC** uses a committee of signers to peg and unpeg BTC. The peg mechanism relies on off-chain coordination that must be trusted.

In every case, you are trusting humans with your Bitcoin.

### Option B: Accept total public visibility

If you use an on-chain Bitcoin derivative — sBTC on Stacks, RBTC on RSK — your position is public. Your collateral. Your debt. Your liquidation threshold. All visible to anyone watching the blockchain.

Institutional players don't accept this. They won't put $1M of BTC collateral into a protocol where every competing fund can see their position. Privacy isn't a feature request — it's a table stake for serious capital.

---

## The Market Left 900 Million People Behind

An estimated 77% of Bitcoin holders have never participated in DeFi. Not because they don't want yield on their BTC. Because:

1. They don't want to give up custody.
2. They don't want their financial activity broadcast publicly.
3. The UX of wrapped BTC across multiple chains is too complex.

The BTCfi market grew 28x in 18 months — from $304M to $8.6B TVL between January 2024 and mid-2025. That growth happened despite these barriers. The market is still in early innings because the fundamental problems have never been solved.

---

## What Doesn't Exist Yet

There is currently no protocol that is simultaneously:

- **Trustless** — BTC secured by Bitcoin Script itself, not by any human or committee
- **Private** — position amounts hidden behind zero-knowledge proofs
- **On Stellar** — where native USDC lives and compliance-grade privacy infrastructure exists

Writz is built to be all three.

---

**Next:** [How Writz Works →](how-writz-works.md)
