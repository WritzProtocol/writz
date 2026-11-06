---
title: "USDC Vault"
description: "Technical reference for the DeFindex USDC vault in the testnet app. It is separate from the Writz protocol; yield on Writz is the lender side of Writz Lend."
noindex: true
---

**Deposit USDC. Earn yield. The vault shares stay in your wallet.**

This page documents the USDC vault on the **DeFindex vault** page of the testnet app. The vault is built on DeFindex and Blend and is not part of the Writz protocol. Yield on Writz is the lender side of Writz Lend, where Bitcoin borrowers pay the interest: see [Writz Lend, For USDC Lenders](/products/writz-lend#for-usdc-lenders-earn).

The vault is a USDC savings vault. You deposit USDC, it is lent out through Blend, and the yield accrues to your position automatically. There is no lock-up: withdraw part or all of it at any time. The vault is live on Stellar testnet at [testnet.writz.xyz/earn](https://testnet.writz.xyz/earn).

---

## What the Vault Does

The vault is a Writz-owned [DeFindex](https://docs.defindex.io) vault. DeFindex is a vault protocol on Stellar that routes deposits into yield strategies. The Writz vault has one strategy, a [Blend](https://blend.capital) USDC lending pool: your USDC is supplied to Blend borrowers, and the interest they pay is the yield you earn.

When you deposit, the vault mints vault shares (`wzUSDC`) to your own Stellar account. Shares are your claim on the vault's USDC. As Blend pays interest, the vault's USDC grows while the number of shares stays the same, so each share is worth more USDC over time. Withdrawing burns shares and returns the USDC they are worth at that moment.

Writz did not write a smart contract for the vault. It was created through the DeFindex factory. DeFindex was audited by OtterSec (March 2025) and Blend v2 by Certora and Code4rena (2025); their reports are in each project's repository.

---

## Key Parameters

| Parameter | Value |
|---|---|
| Network | Stellar testnet |
| Vault | [`CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S`](https://stellar.expert/explorer/testnet/contract/CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S) |
| Vault shares | `wzUSDC` |
| Deposit asset | Blend testnet USDC, a test token from [testnet.blend.capital](https://testnet.blend.capital), not real Circle USDC |
| Strategy | Blend USDC Strategy (`CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY`) |
| Entry and exit fee | None. Fees are only taken from yield, never from deposited capital |
| Performance fee | 1% of the yield earned |
| Lock-up | None. Withdraw at any time |

**How the fee works.** The 1% performance fee is split between Writz and DeFindex, it is not two separate charges. On 100 USDC of yield, you keep 99 USDC; of the 1 USDC fee, DeFindex takes 0.20 and Writz receives 0.80. The full breakdown, and how to verify it on-chain, is in [`contracts/deployments/defindex-vault-testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/defindex-vault-testnet.md).

**Where the APY comes from.** The APY shown in the app is read live from the vault by the relayer, through the DeFindex SDK. It is variable: it follows the interest Blend borrowers pay, which rises and falls with how much of the Blend pool is borrowed.

---

## Step by Step: Earning on Testnet

### Prerequisites

- A Google or GitHub account or an email address (testnet sign-in through Pollar), or a Stellar wallet: Freighter, xBull, Lobstr, Albedo or Rabet
- A small amount of testnet XLM for transaction fees
- Blend testnet USDC to deposit (step 3 below)

### 1. Open the app

Go to [testnet.writz.xyz/earn](https://testnet.writz.xyz/earn), or select **DeFindex vault** in the app's menu. The current APY is visible without connecting anything.

### 2. Connect

Select **Connect wallets**. Sign in with Google, GitHub or an email code, which creates a Stellar test account for you through Pollar, or connect an existing Stellar wallet. See [Sign in with Google, GitHub or email](/guides/sign-in-with-email).

### 3. Enable the USDC trustline and get test USDC

A Stellar account has to opt in to an asset before it can hold it. If your account cannot hold Blend testnet USDC yet, the app shows an **Add USDC (Blend)** button: approve it once in your wallet. The trustline keeps 0.5 XLM of your balance in reserve while it exists. If your balance is zero, the app links to the Blend testnet faucet, where you can get test USDC for free.

### 4. Deposit

Enter an amount and select **Deposit**. Your wallet asks you to sign one transaction. Once it confirms on-chain, the deposited USDC is invested into the Blend strategy straight away, and your position appears on the page.

### 5. Watch it earn

Your position refreshes every 15 seconds and the APY every minute, with no page reload. The USDC value of your position grows as yield accrues.

### 6. Withdraw

Enter an amount, or select **Max** to withdraw your full position, and sign one transaction. The USDC returns to your account. A withdrawal can land one stroop (0.0000001 USDC) under the figure you would compute by hand, from the vault's share-price rounding.

---

## Custody Model

The vault is non-custodial. Three parties take part in every deposit and withdrawal, and none of them can move your funds alone:

1. **The Writz relayer builds the transaction.** It holds the DeFindex API key, which must never reach the browser. It builds an unsigned transaction and returns it. It never signs and never submits.
2. **Your wallet signs it.** Nothing moves without your signature.
3. **Your browser submits it** to Stellar and waits for confirmation.

The vault shares are minted to your own account, not to a Writz account. The relayer cannot withdraw on your behalf, because a withdrawal needs a signature from the account that holds the shares.

The vault's managers act on the vault, not on your account. They can rebalance funds between strategies, pause a strategy, and in an emergency pull a strategy's funds back into the vault as idle USDC. In DeFindex's words, "none of these roles can withdraw funds from the users". The manager can also upgrade the vault's code, which is the most powerful permission, and the reason it needs careful custody. On testnet, one Writz key holds all four roles. On the mainnet vault they are split: the Manager and Fee Receiver are a 2-of-4 multisig, and the Emergency Manager and Rebalance Manager are separate single keys. See [DeFindex vault roles](https://docs.defindex.io/getting-started/vault-roles).

---

## Public stats

Anyone can check how the vault is doing on the app's Protocol page, [testnet.writz.xyz/protocol](https://testnet.writz.xyz/protocol), without a wallet:

| Stat | What it shows |
|---|---|
| Total in vault | The USDC (Blend) the vault manages right now, read from the chain. It includes accrued yield |
| Depositors | Distinct accounts that have ever deposited |
| APY | The vault's current APY, from Blend lending |
| Strategy | Where the vault's USDC earns: the Blend lending pool |
| 30-day retention | Depositors grouped by the day of their first deposit. A depositor counts as retained if they still hold a positive balance 30 days after their first deposit. Cohorts younger than 30 days are shown as too early to tell, not as churned |

The same page shows the borrow pool (available to borrow, supplied by lenders, borrowed across open loans) and links each Writz contract on Stellar Expert.

---

## Status

| Network | Status |
|---|---|
| Stellar testnet | Live at [testnet.writz.xyz](https://testnet.writz.xyz) |
| Stellar mainnet | Vault [`CDODNWQY…RF2A6GU`](https://stellar.expert/explorer/public/contract/CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU) deployed on 2026-10-01 with split roles and a 20 USDC team seed, on Circle USDC and a Blend fixed strategy. No public app for it yet; planned at app.writz.xyz |

---

## For Developers

- **Relayer routes.** `GET /defindex/apy`, `GET /defindex/position`, `POST /defindex/deposit`, `POST /defindex/withdraw`, `GET /metrics/tvl` and `GET /metrics/retention` are documented in the [relayer README](https://github.com/WritzProtocol/writz/blob/main/relayer/README.md). The public testnet relayer is at `https://api.testnet.writz.xyz`.
- **Browser flow.** The build, sign and submit split lives in [`frontend/app/src/lib/flows/earn.ts`](https://github.com/WritzProtocol/writz/blob/main/frontend/app/src/lib/flows/earn.ts).
- **End-to-end test.** The relayer's Earn cycle test submits a real deposit and withdrawal against the testnet vault. See "The Earn end-to-end cycle" in the relayer README.
- **Vault deployments.** Addresses, transactions, fees and roles are in [`defindex-vault-testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/defindex-vault-testnet.md) and [`defindex-vault-mainnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/defindex-vault-mainnet.md).
