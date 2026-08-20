# PrivateLend

**Deposit Bitcoin. Borrow USDC. Your position is yours alone.**

PrivateLend is the flagship product of Writz Protocol. It is a collateralized lending system where Bitcoin is the collateral, USDC is the borrowed asset, and zero-knowledge proofs ensure that nobody - not bots, not competitors, not anyone watching the chain - can see your position.

---

## What PrivateLend Does

You deposit BTC. You borrow up to 66% of its USD value in USDC. The BTC stays locked on Bitcoin, secured by a script that only releases when you repay. Your collateral amount, loan size, and health factor are hidden behind a ZK commitment. When you repay, you get your BTC back - plus the ZK commitment is nullified, so it cannot be reused.

Interest accrues continuously at a variable rate determined by how much of the pool is currently borrowed (utilization). Repay at any time, in full or in part.

---

## Key Parameters

| Parameter | Value |
|---|---|
| Minimum collateral ratio | 150% (BTC value must be 1.5× the USDC borrowed) |
| Maximum LTV | 66.7% (you can borrow up to 2/3 of your BTC's value) |
| Liquidation threshold | 120% (position is eligible for liquidation below this ratio) |
| Liquidation penalty | 10% (liquidator receives a 10% discount on BTC vs. market price) |
| Minimum confirmations | 6 Bitcoin blocks (~60 minutes) |
| Protocol fee | 15% of interest spread |

---

## Interest Rate Model

The borrow rate adjusts dynamically based on how much of the USDC pool is being borrowed.

```
Optimal utilization:  75%
Base borrow rate:      0%
Slope 1 (below 75%):  8% APR at full utilization
Slope 2 (above 75%): 200% APR at 100% utilization

Protocol fee:         15% of borrow rate → supply rate
```

**What this means in practice:**

- At 50% utilization: ~5.3% APR borrow rate, ~4.5% APR supply rate
- At 75% utilization: ~8% APR borrow rate, ~6.8% APR supply rate
- Above 75%: rates rise steeply to incentivize repayment and new USDC supply

The model is designed to keep utilization near 75% - the point where lenders earn competitive yield and borrowers pay reasonable rates.

---

## Step-by-Step: Borrowing Against Your BTC

### Prerequisites

- A Bitcoin wallet (Xverse recommended)
- A Stellar wallet (Freighter, Lobstr, or any wallet compatible with Stellar Wallets Kit)
- BTC to deposit (minimum 0.001 BTC)
- A small amount of XLM for Stellar transaction fees (~1 XLM)

You don't need to understand SPV, Merkle proofs, or zero-knowledge proofs to use PrivateLend - the steps below tell you what to click and what to expect. Each step also has an optional "How this works" note for anyone who wants the technical detail; skip those freely on a first read.

### Step 1 - Connect Your Wallets

Open the Writz app at `writz.xyz`. Connect your Bitcoin wallet (Xverse) and your Stellar wallet (Freighter or Lobstr). Both connections happen in your browser - no private keys leave your device.

### Step 2 - Choose Your Deposit Amount

Select how much BTC you want to deposit as collateral. Writz will show you the maximum USDC you can borrow at the current BTC price (up to 66.7% of the BTC value in USD), and generate a unique Bitcoin deposit address for you to send to.

<details>
<summary>How this works technically</summary>

The generated address is a P2WSH (Pay-to-Witness-Script-Hash) address. It encodes your public key, Writz's co-signing key, and a time-lock specific to your loan term - see [Bitcoin Side](../how-it-works/bitcoin-side.md) for the full script design.

</details>

### Step 3 - Send BTC to the Deposit Address

Send exactly the specified amount of BTC to the generated address from your Bitcoin wallet. Double-check the address before sending - this is a standard Bitcoin transaction.

Wait for 6 confirmations (~60 minutes). The Writz app shows a progress bar with a live confirmation count and a rough time-remaining estimate while you wait - no need to track this yourself on a block explorer.

### Step 4 - Writz Verifies Your Deposit

Once your transaction has 6 confirmations, the Writz app automatically proves your Bitcoin deposit is real to the Stellar side of the protocol. This happens without you doing anything - no separate document to sign, no separate approval.

<details>
<summary>How this works technically</summary>

The app assembles an SPV proof (Bitcoin block headers + Merkle proof + raw transaction) and submits it to the Soroban `bitcoin-spv` contract. The contract verifies your BTC transaction cryptographically - checking proof-of-work and Merkle inclusion, not trusting any third party's word for it - and signals the commitment-tree contract. See [SPV Verification](../how-it-works/spv-verification.md) for the full mechanics.

</details>

### Step 5 - Your Private Position Is Created

Your position now exists on Stellar, visible only to you - not to other users, not to bots watching the chain. You will see a position ID in the Writz app.

**There is nothing to write down or back up.** If you clear your browser or switch devices, reconnect the same wallet and click "Recover positions" - the app rebuilds your position automatically.

<details>
<summary>How this works technically</summary>

Your browser generates a zero-knowledge proof of your deposit and submits it to the commitment-tree contract, which records a cryptographic commitment. Your position's spending keys are derived deterministically from a signature of your connected Stellar wallet (not randomly generated, so nothing to lose), and an encrypted recovery note is published on-chain alongside the commitment. "Recover positions" re-derives your keys, scans the on-chain notes, and rebuilds your position from them.

One caveat: the Bitcoin-side details needed to release your BTC on repayment (your Bitcoin pubkey, the timelock height, and the deposit's output index) are cached locally and are not part of the recovery note. In the rare case those are lost on a device you never repaid from, contact support before repaying so they can be reconstructed from your original deposit transaction, or use the [manual emergency recovery path](../how-it-works/manual-emergency-recovery.md) once the CLTV timelock expires.

</details>

### Step 6 - Borrow USDC

Choose how much USDC to borrow (up to 66.7% of your BTC's current value). Your browser generates a ZK proof that confirms your position is adequately collateralized. This proof is verified on-chain.

USDC arrives in your Stellar wallet within seconds of the Soroban transaction confirming.

### Step 7 - Monitor Your Health Factor

Your position has a **health factor** - a ratio of your collateral value to your debt. A health factor above 1.5 means you are safe. Below 1.2, your position is eligible for liquidation.

The Writz app decrypts your position locally, using keys derived from your wallet, so you can see your health factor in real time. This is a local calculation - the decryption never leaves your browser.

Watch the BTC/USD price. If BTC drops significantly, you can:
- Repay part of your loan to restore your health factor
- Add more BTC collateral (initiate a new deposit linked to your position)

### Step 8 - Repay and Recover Your BTC

Repay your USDC loan plus accrued interest at any time. Partial repayment is supported.

When you repay in full, the commitment-tree contract marks your position as closed and generates the co-signature for the Bitcoin P2WSH spending path. The Writz app assembles the Bitcoin release transaction. You broadcast it from your Bitcoin wallet. Your BTC arrives in your wallet within minutes.

---

## Liquidation

If your health factor drops below 1.2 (collateral ratio below 120%), your position becomes eligible for liquidation.

**How private liquidation works:** A keeper monitors positions using a private operator key - this means the keeper can see position details that no outside observer can, which is what lets it detect risk without a public health-factor feed. When a position is undercollateralized, the keeper generates a ZK proof that says "this position's health ratio is below 120%." Your collateral amount and identity stay hidden from everyone else; the USDC debt amount is published (the liquidator needs it to pay it, and it's cryptographically bound to your commitment so it can't be faked). Anyone can verify this proof and complete the liquidation.

The liquidator pays the outstanding USDC debt. The protocol co-signs the BTC release to the liquidator. The liquidator receives BTC at a 10% discount to market value - the liquidation bonus that makes this economically rational.

**Protecting yourself from liquidation:**
- Keep your health factor above 1.5 (a 50% buffer above the minimum) - the app color-codes it (green above 150%, amber 120–150%, red below 120%) on your position dashboard
- Set price alerts for BTC/USD
- Maintain USDC reserves to repay quickly if needed
- Borrow conservatively - taking 50% LTV instead of 66% gives you significant buffer

**If you are liquidated:** your position's status updates to "liquidated" and the app explains what happened - your outstanding debt is cleared, but the BTC collateral is gone (see the [liquidation notification design](../design/liquidation-notification-spec.md) for how this is detected). There is no silent loss; you will not have to guess why your collateral disappeared.

---

## For USDC Lenders

PrivateLend is also a yield opportunity for USDC holders. You supply USDC to the pool and earn the supply rate - currently tracking 5–7% APR depending on utilization.

Your USDC earns yield continuously. Withdraw at any time (subject to pool liquidity). There is no lockup.

The USDC pool is separate from borrower positions. As a lender, you are not exposed to the ZK complexity - you simply supply USDC and earn interest.

---

## Phase 2 Launch Parameters (planned, not yet scheduled)

PrivateLend is planned to launch on mainnet in Q4 2026 with conservative initial parameters, once a set of gates are cleared - see `docs/roadmap/phases.md` for the live status of each:

- **TVL cap:** $50,000 BTC collateral (raised progressively)
- **Whitelist-only** for the first 30 days
- **Protocol fee:** 0% for 90-day bootstrap period
- **USDC seed liquidity:** $50,000 protocol-owned (funding source not yet resolved - see `docs/research/growth-strategy.md`)

These caps will be raised after a 30-day clean operation period and the completion of the Audit Bank engagement. The Q4 2026 date and every parameter above are contingent on gates that are not yet closed: a formed legal entity (not yet started), a real price oracle (currently a hardcoded stub in the contract), the ZK trusted setup ceremony (participants not yet identified), and the Audit Bank engagement itself (its stated qualification path runs through the SCF grant, which is not being pursued in the short term). None of this blocks using PrivateLend on testnet today - it means the mainnet date above is a target, not a commitment.

---

**Deeper reading:** [How the ZK Privacy Layer Works →](../how-it-works/zk-privacy-layer.md)
