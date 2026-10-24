---
title: "The Problem"
---

## Bitcoin in DeFi Requires Trusting Someone With Your BTC

Bitcoin is the world's largest crypto asset by market cap. Yet borrowing against it in DeFi almost always means handing it to someone else first:

### Give your BTC to a custodian or a signer set

**WBTC** is held by BitGo. One company controls the keys. BitGo can be hacked, regulated, or go bankrupt. In 2023, concerns about custodianship triggered $1B+ in WBTC redemptions in a single week.

**tBTC** uses a threshold signature network. A sufficient coalition of signers could theoretically collude. The trust assumption is distributed, but it is still a trust assumption.

**Stacks sBTC** uses a committee of signers to peg and unpeg BTC. The peg mechanism relies on off-chain coordination that must be trusted.

In every case, you are trusting humans with your Bitcoin.

### Or leave Bitcoin altogether

The alternative is to sell or bridge BTC onto another chain, which turns it into a different asset with a different set of risks: bridge contracts, peg mechanisms and the custody behind them. Every bridge adds a place where the BTC can be lost.

---

## The Market Left 900 Million People Behind

An estimated 77% of Bitcoin holders have never participated in DeFi. Not because they don't want yield on their BTC. Because:

1. They don't want to give up custody.
2. They don't want to trust a bridge or a wrapped token.
3. The UX of wrapped BTC across multiple chains is too complex.

The BTCfi market grew 28x in 18 months - from $304M to $8.6B TVL between January 2024 and mid-2025. That growth happened despite these barriers. The market is still in early innings because the fundamental problems have never been solved.

---

## What Doesn't Exist Yet

There is currently no protocol that is simultaneously:

- **Trustless** - BTC secured by Bitcoin Script itself, not by any human or committee
- **Native** - real BTC that never leaves Bitcoin, verified on-chain by an SPV light client, with no bridge and no wrapped token
- **On Stellar** - where native USDC lives

Writz is built to be all three. Writz Lend positions are public on chain, like in any other lending market; privacy is being designed as a separate, opt-in edition, in progress (see [Privacy edition (in progress)](/how-it-works/privacy-edition)).

---

**Next:** [How Writz Works →](/introduction/how-writz-works)
