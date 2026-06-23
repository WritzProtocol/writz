# PrivateLend

**Deposit Bitcoin. Borrow USDC. Your position is yours alone.**

PrivateLend is the flagship product of Writz Protocol. It is a collateralized lending system where Bitcoin is the collateral, USDC is the borrowed asset, and zero-knowledge proofs ensure that nobody — not bots, not competitors, not anyone watching the chain — can see your position.

---

## What PrivateLend Does

You deposit BTC. You borrow up to 66% of its USD value in USDC. The BTC stays locked on Bitcoin, secured by a script that only releases when you repay. Your collateral amount, loan size, and health factor are hidden behind a ZK commitment. When you repay, you get your BTC back — plus the ZK commitment is nullified, so it cannot be reused.

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

The model is designed to keep utilization near 75% — the point where lenders earn competitive yield and borrowers pay reasonable rates.

---

## Step-by-Step: Borrowing Against Your BTC

### Prerequisites

- A Bitcoin wallet (Xverse recommended)
- A Stellar wallet (Freighter, Lobstr, or any wallet compatible with Stellar Wallets Kit)
- BTC to deposit (minimum 0.001 BTC)
- A small amount of XLM for Stellar transaction fees (~1 XLM)

### Step 1 — Connect Your Wallets

Open the Writz app at `app.writz.io`. Connect your Bitcoin wallet (Xverse) and your Stellar wallet (Freighter or Lobstr). Both connections happen in your browser — no private keys leave your device.

### Step 2 — Choose Your Deposit Amount

Select how much BTC you want to deposit as collateral. Writz will show you the maximum USDC you can borrow at the current BTC price (up to 66.7% of the BTC value in USD).

Writz generates a unique P2WSH Bitcoin address for this deposit. This address encodes your public key, Writz's co-signing key, and a time-lock specific to your loan term.

### Step 3 — Send BTC to the Deposit Address

Send exactly the specified amount of BTC to the generated address from your Bitcoin wallet. Double-check the address before sending — this is a standard Bitcoin transaction.

Wait for 6 confirmations (~60 minutes). The Writz app will show you confirmation progress in real time.

### Step 4 — Submit the SPV Proof

Once your transaction has 6 confirmations, the Writz app assembles an SPV proof (Bitcoin block headers + Merkle proof + raw transaction) and submits it to the Soroban bitcoin-spv contract on your behalf.

The contract verifies your BTC transaction cryptographically and signals the commitment-tree contract.

### Step 5 — Your ZK Position Is Created

Your browser generates a zero-knowledge proof of your deposit and submits it to the commitment-tree contract. The contract records a cryptographic commitment — your position now exists on Stellar, and only you know the details.

You will see a position ID in the Writz app. Save the position data locally — it is the key to your ZK commitment, and it is not stored anywhere on-chain.

### Step 6 — Borrow USDC

Choose how much USDC to borrow (up to 66.7% of your BTC's current value). Your browser generates a ZK proof that confirms your position is adequately collateralized. This proof is verified on-chain.

USDC arrives in your Stellar wallet within seconds of the Soroban transaction confirming.

### Step 7 — Monitor Your Health Factor

Your position has a **health factor** — a ratio of your collateral value to your debt. A health factor above 1.5 means you are safe. Below 1.2, your position is eligible for liquidation.

The Writz app decrypts your position locally (using your saved position data) so you can see your health factor in real time. This is a local calculation — the decryption never leaves your browser.

Watch the BTC/USD price. If BTC drops significantly, you can:
- Repay part of your loan to restore your health factor
- Add more BTC collateral (initiate a new deposit linked to your position)

### Step 8 — Repay and Recover Your BTC

Repay your USDC loan plus accrued interest at any time. Partial repayment is supported.

When you repay in full, the commitment-tree contract marks your position as closed and generates the co-signature for the Bitcoin P2WSH spending path. The Writz app assembles the Bitcoin release transaction. You broadcast it from your Bitcoin wallet. Your BTC arrives in your wallet within minutes.

---

## Liquidation

If your health factor drops below 1.2 (collateral ratio below 120%), your position becomes eligible for liquidation.

**How private liquidation works:** A keeper monitors positions using a private operator key. When a position is undercollateralized, the keeper generates a ZK proof that says "this position's health ratio is below 120%" — without revealing the specific amounts. Anyone can verify this proof and initiate the liquidation.

The liquidator pays the outstanding USDC debt. The protocol co-signs the BTC release to the liquidator. The liquidator receives BTC at a 10% discount to market value — the liquidation bonus that makes this economically rational.

**Protecting yourself from liquidation:**
- Keep your health factor above 1.5 (a 50% buffer above the minimum)
- Set price alerts for BTC/USD
- Maintain USDC reserves to repay quickly if needed
- Borrow conservatively — taking 50% LTV instead of 66% gives you significant buffer

---

## For USDC Lenders

PrivateLend is also a yield opportunity for USDC holders. You supply USDC to the pool and earn the supply rate — currently tracking 5–7% APR depending on utilization.

Your USDC earns yield continuously. Withdraw at any time (subject to pool liquidity). There is no lockup.

The USDC pool is separate from borrower positions. As a lender, you are not exposed to the ZK complexity — you simply supply USDC and earn interest.

---

## Phase 2 Launch Parameters

PrivateLend launches on mainnet in Q4 2026 with conservative initial parameters:

- **TVL cap:** $50,000 BTC collateral (raised progressively)
- **Whitelist-only** for the first 30 days
- **Protocol fee:** 0% for 90-day bootstrap period
- **USDC seed liquidity:** $50,000 protocol-owned

These caps will be raised after a 30-day clean operation period and the completion of the Audit Bank engagement.

---

**Deeper reading:** [How the ZK Privacy Layer Works →](../how-it-works/zk-privacy-layer.md)
