---
title: "The Problem"
---

## Borrowing Against Bitcoin Means Trusting Someone With It

Bitcoin is the largest crypto asset by market capitalization. Yet borrowing against it in DeFi almost always means handing it to someone else first.

### Give your BTC to a custodian or a signer set

**WBTC** is backed by BTC held by custodians: BitGo, with BiT Global holding one of three keys since 2024. They can be hacked, regulated or fail.

**tBTC** uses a threshold signature network. Enough signers acting together could move the BTC. The trust is spread out, but it is still trust.

**Stacks sBTC** uses a set of signers to peg BTC in and out. The peg depends on those signers coordinating off chain.

In every case, people other than you control your Bitcoin.

### Or leave Bitcoin altogether

The alternative is to sell BTC or bridge it onto another chain, which turns it into a different asset with different risks: bridge contracts, peg mechanisms and the custody behind them. Every bridge adds a place where the BTC can be lost.

---

## Most Bitcoin Holders Stay Out of DeFi

Most Bitcoin is never used as collateral on chain. Holders who would borrow against it hold back because:

1. They do not want to give up custody.
2. They do not want to trust a bridge or a wrapped token.
3. Moving wrapped BTC across chains is complex.

The Bitcoin that does reach DeFi goes through those barriers, almost always as a wrapped token. Holders who refuse them have had no alternative.

---

## What Does Not Exist Yet

No protocol is at once:

- **Without custody**: BTC secured by a Bitcoin Script that needs the owner's key to move, not held by a custodian or a committee
- **Native**: real BTC that never leaves Bitcoin, verified on chain by an SPV light client, with no bridge and no wrapped token
- **On Stellar**: where native USDC lives

Writz is built to be all three. Writz Lend positions are public on chain, as in any other lending market.

---

**Next:** [How Writz Works →](/introduction/how-writz-works)
