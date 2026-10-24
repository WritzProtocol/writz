---
title: "Writz Lend"
---

**Deposit Bitcoin. Borrow USDC. Take your BTC back alone if Writz ever disappears.**

Writz Lend is the lending product of Writz Protocol. Bitcoin is the collateral and USDC is the borrowed asset. The BTC never leaves Bitcoin: it is locked in a script that you co-own with the protocol, and the `writz-lend` contract on Stellar recognizes it through `bitcoin-spv`, an on-chain Bitcoin header light client. There is no bridge, no custodian and no wrapped BTC.

Positions are plaintext. Your collateral amount, debt, health ratio, Stellar address and Bitcoin deposit transaction are public on chain, like in any other lending market. Privacy is not part of the protocol; it is being designed as a separate, opt-in [privacy edition (in progress)](/how-it-works/privacy-edition) that Writz Lend users never touch.

---

## What Writz Lend Does

You lock BTC in a P2WSH script on Bitcoin and register it with `writz-lend` using an SPV proof. You borrow up to 66.7% of its USD value in USDC. When you repay in full, the protocol co-signs the release and you take your BTC back with your own signature. If the protocol ever stops co-signing, the script's timelock lets you spend the BTC alone.

Interest accrues continuously at a variable rate determined by how much of the pool is currently borrowed (utilization). Repay at any time, in full or in part.

---

## Key Parameters

These are the values set by the `writz-lend` constructor today.

| Parameter | Value |
|---|---|
| Minimum collateral ratio | 150% (BTC value must be 1.5x the USDC borrowed) |
| Maximum LTV | 66.7% (you can borrow up to 2/3 of your BTC's value) |
| Liquidation threshold | 120% (position is eligible for liquidation below this ratio) |
| Liquidation bonus | 10% of the debt, paid to the liquidator in USDC from the protocol reserve |
| Minimum deposit | 0.001 BTC (100,000 sats); 0.00005 BTC (5,000 sats) on testnet |
| Minimum confirmations | 6 Bitcoin blocks (~60 minutes); 1 on testnet |
| Timelock window | 1,008 to 105,000 blocks above the deposit block (about 7 days to 2 years) |
| Total borrow cap | 50,000 USDC across the pool (admin-set) |
| Protocol fee | 15% of interest, kept as the protocol reserve |
| Price source | Reflector BTC/USD oracle (single source today) |

---

## Interest Rate Model

The borrow rate adjusts dynamically based on how much of the USDC pool is being borrowed.

```
Optimal utilization:  75%
Base borrow rate:      0%
Slope 1 (0 to 75%):   rises linearly to 8% APR at 75% utilization
Slope 2 (75 to 100%): adds up to 200% APR, reaching 208% APR at 100%

Protocol fee:         15% of interest
Supply rate:          borrow rate x utilization x 0.85
```

**What this means in practice** (from `contracts/contracts/writz-lend/src/rates.rs`):

- At 50% utilization: ~5.3% APR borrow rate, ~2.3% APR supply rate
- At 75% utilization: 8% APR borrow rate, ~5.1% APR supply rate
- Above 75%: rates rise steeply to incentivize repayment and new USDC supply

The model is designed to keep utilization near 75% - the point where lenders earn competitive yield and borrowers pay reasonable rates.

---

## Step-by-Step: Borrowing Against Your BTC

### Prerequisites

- A Bitcoin wallet (Xverse recommended)
- A Stellar wallet (Freighter, Lobstr, or any wallet compatible with Stellar Wallets Kit)
- BTC to deposit (minimum 0.001 BTC; 0.00005 BTC on testnet, which one Signet faucet payout covers)
- A small amount of XLM for Stellar transaction fees (~1 XLM)

You don't need to understand SPV or Merkle proofs to use Writz Lend. The steps below tell you what to click and what to expect; each step also has an optional "How this works" note for anyone who wants the technical detail.

### Step 1 - Connect Your Wallets

Open the Writz app at `writz.xyz`. Connect your Bitcoin wallet (Xverse) and your Stellar wallet (Freighter or Lobstr). Both connections happen in your browser - no private keys leave your device.

### Step 2 - Choose Your Deposit Amount

Select how much BTC you want to deposit as collateral. Writz shows you the maximum USDC you can borrow at the current BTC price (up to 66.7% of the BTC value in USD), and generates a Bitcoin deposit address for you to send to.

<details>
<summary>How this works technically</summary>

The generated address is a P2WSH (Pay-to-Witness-Script-Hash) address. Its script holds your Bitcoin public key, the protocol's co-signing key and a CLTV timelock height - see [Bitcoin Side](/how-it-works/bitcoin-side) for the full script design.

</details>

### Step 3 - Send BTC to the Deposit Address

Send the BTC to the generated address from your Bitcoin wallet. Double-check the address before sending - this is a standard Bitcoin transaction.

Wait for 6 confirmations (~60 minutes; 1 on testnet). The Writz app shows a live confirmation count while you wait.

### Step 4 - Register the Deposit

Once your transaction has the confirmations it needs, the app asks your Bitcoin wallet to sign a short message and your Stellar wallet to approve one transaction. That transaction registers the deposit with `writz-lend`, and your position appears in the app.

<details>
<summary>How this works technically</summary>

The app fetches an SPV proof (the block hash, the Merkle inclusion path and the raw transaction) from the relayer and calls `writz-lend.deposit`. The contract:

1. Rebuilds the Writz redeem script from the protocol key in its config, your Bitcoin public key and the timelock height, and requires the deposit output to be exactly that P2WSH. An output you could spend alone, or someone else's output, cannot match.
2. Calls `bitcoin-spv.verify_transaction`, which checks proof of work, Merkle inclusion and 6 confirmations against the header chain stored on Stellar. No oracle and no third party vouches for the deposit.
3. Requires the timelock to lie 1,008 to 105,000 blocks above the block that confirmed the deposit.
4. Checks the signed message (a standard Bitcoin "sign message" signature by the key in the script, bound to this contract, your Stellar address and the txid), so nobody watching Bitcoin can register your deposit as their own.
5. Consumes the txid in `bitcoin-spv`'s shared registry, so the same output can never back two positions, reads the deposited amount from the raw transaction and records the position, keyed by the Bitcoin txid.

See [SPV Verification](/how-it-works/spv-verification) for the full mechanics.

</details>

### Step 5 - Borrow USDC

Choose how much USDC to borrow (up to 66.7% of your BTC's current value). USDC arrives in your Stellar wallet within seconds of the Soroban transaction confirming.

<details>
<summary>How this works technically</summary>

`writz-lend.borrow` accrues interest on the position, prices the collateral with the Reflector BTC/USD oracle and refuses any borrow that would leave the collateral ratio below 150%, that exceeds the pool's available liquidity, or that would take total borrowing above the 50,000 USDC cap. Only the Stellar address that registered the deposit can borrow against it.

</details>

### Step 6 - Monitor Your Health Factor

Your position has a **health factor** - the ratio of your collateral value to your debt. Above 1.5 you are safe. Below 1.2, your position is eligible for liquidation. The contract exposes it as `get_health_ratio_bp`, and the app shows it on your position.

Watch the BTC/USD price. If BTC drops significantly, repay part of your loan to restore your health factor.

### Step 7 - Repay

Repay your USDC loan plus accrued interest at any time. Partial repayment is supported. A repayment that clears the whole debt closes the position.

### Step 8 - Release Your BTC

After a full repayment, the protocol co-signs the transaction that returns your BTC, and the app asks your Bitcoin wallet to sign and broadcast it. Your BTC arrives in your wallet once the transaction confirms on Bitcoin.

<details>
<summary>How this works technically</summary>

A full repayment emits a `repay_full` event. The relayer's repay watcher sees it, rebuilds your redeem script from the position, builds the cooperative-path (Path A) release PSBT paying your key's own address, co-signs it with the protocol key and publishes it on `writz-lend` with `publish_release_psbt`. Because the half-signed PSBT is stored on Stellar, you can fetch it with `get_release_psbt` and finish it even if the rest of the Writz stack is down. Your wallet adds your signature and broadcasts.

</details>

### If Writz Stops Co-signing: the Timelock Exit

If the protocol never co-signs (for example, if Writz disappears), the script's second path lets you spend the BTC with your key alone once the CLTV timelock height is reached. No Writz service is needed. See [Manual Emergency Recovery](/how-it-works/manual-emergency-recovery).

---

## Liquidation

If your health factor drops below 1.2 (collateral ratio below 120%), your position becomes eligible for liquidation.

**How liquidation works today:** `writz-lend.liquidate` can be called by a designated keeper address. If the keeper has not liquidated or sent a heartbeat for 24 hours, any caller may liquidate an undercollateralized position instead, so a stalled keeper cannot block liquidations. Who calls does not change the check: the contract recomputes the health ratio from the oracle price and refuses a healthy position.

The liquidator pays the full outstanding USDC debt and receives a 10% USDC bonus from the protocol reserve (funded by 15% of interest). If the reserve holds less than the bonus, the liquidator gets what the reserve holds. The position is marked liquidated and its debt is cleared.

**No BTC moves in a liquidation today.** The protocol never takes or sells your BTC, and it does not hand BTC to the liquidator. The relayer only co-signs a release after a full repayment, so a liquidated position's BTC stays in its script until the timelock height, when the key in the script can spend it alone. The protocol's exposure from this is bounded by the 50,000 USDC total borrow cap.

**Protecting yourself from liquidation:**
- Keep your health factor above 1.5 - the app color-codes it (green above 150%, amber 120 to 150%, red below 120%)
- Watch the BTC/USD price
- Maintain USDC to repay quickly if needed
- Borrow conservatively - taking 50% LTV instead of 66.7% gives you a significant buffer

---

## For USDC Lenders: Earn

Earn on Writz means lending USDC to the Writz Lend pool. The USDC lenders supply is what Bitcoin borrowers draw against, and the interest those borrowers pay is the lenders' yield. Nothing else is in between: no vault, no strategy, no second protocol. On testnet, use the **Lend** tab at [testnet.writz.xyz](https://testnet.writz.xyz), or call the contract directly.

**How the yield works**

- You supply USDC with `supply_usdc(supplier, amount)`. The pool records your deposit as scaled units, so your balance grows as the supply index grows with every interest payment. `get_supply_balance(lender)` returns your balance with the interest included.
- The supply rate follows utilization: `supply rate = borrow rate x utilization x 0.85` (see the interest rate model above). The 15% that is not passed to lenders is the protocol reserve, which pays liquidation bonuses.
- The rate is variable and can be zero. With nothing borrowed, nobody pays interest and lenders earn nothing; with very little borrowed, `get_supply_rate_bp()` still reads `0` because the rate is counted in whole basis points. Read it live. Writz never promises an APY.

**Withdrawing**

- `withdraw_supply(supplier, amount)` returns up to your balance, principal plus interest. There is no lockup and no fee on deposits or withdrawals.
- You can only withdraw USDC that is not lent out at that moment. If borrowers hold most of the pool, a withdrawal above the free liquidity fails (`InsufficientLiquidity`) until borrowers repay or new lenders supply. High utilization raises the borrow rate steeply above 75%, which is what pulls that liquidity back.

**What you are exposed to**

- Your USDC funds loans backed by BTC at a 150% minimum collateral ratio, eligible for liquidation below 120%. A liquidation repays the full debt to the pool in USDC; the liquidator is paid from the protocol reserve, not with BTC (see Liquidation above). A position that nobody liquidates stays borrowed, and the pool's total exposure is bounded by the 50,000 USDC borrow cap.
- Collateral is priced by a single oracle today (Reflector BTC/USD), and the contracts are not audited yet. Writz lending is on testnet only, with test USDC that has no value.

| Lender call | What it does | Signed by |
|---|---|---|
| `supply_usdc(supplier, amount)` | Moves `amount` USDC stroops from the supplier into the pool | The supplier |
| `withdraw_supply(supplier, amount)` | Returns `amount` USDC stroops, up to the balance and the free liquidity | The supplier |
| `get_supply_balance(lender)` | The lender's balance with interest, in stroops (7 decimals) | Read only |
| `get_supply_rate_bp()` | The current annual supply rate in basis points (`500` is 5%) | Read only |

Code for a web page, a bot or the CLI is in [Build on Writz](/developers/integrate#7-earn-yield-on-usdc-as-a-lender).

---

## Mainnet

Writz Lend is targeted for mainnet in Q2 to Q3 2027, starting with conservative parameters:

- **Borrow cap:** starting low and raised progressively (the contract's cap is 50,000 USDC today)
- **Whitelist-only** for the first 30 days
- **Protocol fee:** the launch value is not decided yet (the contract charges 15% of interest today)

The date is a target, not a commitment. It depends on gates that are not yet closed, including a formed legal entity, an external audit of the contracts, and a second price source cross-checking Reflector. No trusted-setup ceremony is on the v1 mainnet path. None of this blocks using Writz Lend on testnet today.

---

**Deeper reading:** [The Bitcoin Side →](/how-it-works/bitcoin-side) · [The Stellar Side →](/how-it-works/stellar-side)
