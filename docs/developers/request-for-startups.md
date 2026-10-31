---
title: "What to build on Writz"
description: "Startup ideas that use the Writz primitives live on Stellar testnet today, scoped for a weekend and for a business after it, plus the showcase of projects built on Writz."
---

Writz lets Stellar know what happened on Bitcoin. A Soroban contract can check that a Bitcoin transaction is buried in the Bitcoin chain, and a borrower can lock native BTC on Bitcoin and take USDC on Stellar against it, with no bridge, no custodian and no wrapped token.

This page lists products we would like to see built on top of that. Each idea is meant to work twice: as a demo a small team can ship in a weekend hackathon, and as a business someone would pay for once it is real. Every idea names the Writz piece it uses, and only pieces that are live on Stellar testnet today. Anything that is not live yet is in [Not available yet](#not-available-yet), so you do not plan a weekend around it.

<Tip>
Building at the Pura Vida Ideathon (23 to 26 October 2026)? Any idea on this page, or your own, is eligible for the Writz integration bounties. The event page has the rules and the deadline.
</Tip>

Not a Soroban developer? Start with [No Soroban needed: build on Writz yield](#no-soroban-needed-build-on-writz-yield). Those ideas lend USDC to Writz Lend, let it earn the interest Bitcoin borrowers pay and take it out, from a web page or a bot, with no contract of your own.

---

## What is live on testnet

| Primitive | What it gives you | How to reach it |
|---|---|---|
| **Bitcoin payment verification** (`bitcoin-spv`) | An on-chain Bitcoin header light client. `verify_transaction` checks that a transaction is in a block on the best Bitcoin chain with at least N confirmations and returns its `txid`, `block_hash`, `block_height` and `confirmations`. Read-only, permissionless, callable from any Soroban contract or by simulation | Contract ID in [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md); interface in the [Contract Reference](/developers/contract-reference) |
| **SPV proof API** | `GET https://api.testnet.writz.xyz/spv-proof/:txid?confirmations=N` returns the raw transaction, its Merkle proof and `sorobanArgs` ready to pass to `verify_transaction` | [api.testnet.writz.xyz](https://api.testnet.writz.xyz) lists every endpoint |
| **BTC-collateralized USDC credit** (Writz Lend, `writz-lend`) | A borrower locks BTC in a P2WSH script on Bitcoin, registers it with `deposit`, borrows USDC up to 66.7% of its value (`borrow`), repays (`repay`) and takes the BTC back. Lenders `supply_usdc` and `withdraw_supply`. Read functions: `get_position`, `get_health_ratio_bp`, `get_borrow_rate_bp`, `get_supply_rate_bp`, `get_protocol_state` | [Writz Lend](/products/writz-lend); current contract ID in the deployment record above |
| **Bitcoin lock script** (`@writz/bitcoin-script`) | TypeScript: builds the deposit redeem script and address, and the release and emergency (timelock) spends | [`bitcoin-script/`](https://github.com/WritzProtocol/writz/tree/main/bitcoin-script) in the repo (not published to npm; install from the repo) |
| **Bitcoin transaction parsing** (`spv-types`) | Rust, `no_std`: `btc_parser::find_p2wsh_output` returns the satoshi value of the first output whose scriptPubKey equals the one you expect (any output type, despite the name); `key_proof` checks a BIP-137 signature from a Bitcoin key | [`contracts/contracts/spv-types/`](https://github.com/WritzProtocol/writz/tree/main/contracts/contracts/spv-types) (depend on it by git path) |
| **USDC yield** (Writz Lend, lender side) | Lenders `supply_usdc` to the Writz Lend pool and `withdraw_supply` with interest. `get_supply_balance` returns a lender's balance including interest, `get_supply_rate_bp` the current annual rate. The interest comes from borrowers, so the rate is zero while nothing is borrowed | [Writz Lend](/products/writz-lend); current contract ID in the deployment record above |

Things to know before you start:

- **Try the app first.** The [Guides](/guides/start-here) walk through wallet setup, test funds and a full loan in the testnet app, click by click, so you see the flow you are building on.
- **The Bitcoin side is Signet.** On testnet, `bitcoin-spv` follows Bitcoin Signet, and the Writz relayer keeps it in sync with the Signet tip. Get Signet coins from any public Signet faucet. A transaction that is not on Signet will not verify.
- **Confirmations take time.** Six Signet confirmations take about an hour, sometimes longer. Make your Bitcoin transactions on day one, not an hour before the deadline. For a demo you can ask for fewer confirmations; say so in your pitch.
- **`verify_transaction` does not remember.** It proves a transaction is in the chain; it does not mark it as used. If your contract pays out against a Bitcoin payment, store the `txid` and refuse it the second time. It also does not read outputs: parse `raw_tx` to check the amount and the recipient (use `spv-types` from Rust).
- **A Writz Lend deposit is a real Bitcoin transaction.** It needs Signet BTC sent to the address `@writz/bitcoin-script` derives, the confirmations the deployment requires (1 on testnet), the proof from the SPV proof API, and a BIP-137 signature from the depositor's Bitcoin key over the message the contract rebuilds (reference implementation: `signDeposit` in [`scripts/deploy/e2e_local.mjs`](https://github.com/WritzProtocol/writz/blob/main/scripts/deploy/e2e_local.mjs)). The minimum deposit is 5,000 sats on testnet and 100,000 sats (0.001 BTC) on mainnet.
- **Testnet USDC.** Writz Lend uses Circle's testnet USDC (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). Add the trustline in your wallet and swap testnet XLM for it, or use Circle's faucet.
- **Testnet only.** Nothing here is audited, and Writz lending is not on mainnet (target: Q2 to Q3 2027). Do not put real funds through it.

---

## No Soroban needed: build on Writz yield

These ideas need a designer and a front-end developer more than a smart contract developer. The integration is the same in all of them: the user lends USDC to the Writz Lend pool, it earns the interest Bitcoin borrowers pay, and the user takes it out when they want. Your product is everything around that: who saves, why, how often, and what they see.

| What the user does | Contract call | What the user signs |
|---|---|---|
| Save | `supply_usdc(supplier, amount)` | One Stellar transaction, built by your page, signed in the user's own wallet |
| Take money out | `withdraw_supply(supplier, amount)` | One Stellar transaction, the same way |
| See the balance | `get_supply_balance(lender)`, principal plus interest | Nothing: a simulated read |
| See the rate | `get_supply_rate_bp()`, annual basis points | Nothing: a simulated read |

The yield is not a subsidy. It is the interest that people who lock BTC and borrow USDC pay to the pool, minus the 15% protocol fee; see [Writz Lend, For USDC Lenders](/products/writz-lend#for-usdc-lenders-earn).

Before you design around it:

- **Test money, not real money.** Writz Lend holds Circle's testnet USDC (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`), which has no value. The user's account needs a trustline to it first; swap testnet XLM for it on the DEX or use Circle's faucet.
- **No promised rate.** The rate is variable and comes only from borrowers. While nothing is borrowed it is zero, and with very little borrowed `get_supply_rate_bp` still reads `0` (it counts whole basis points: `500` is 5% a year). On 2026-10-25 it read `0` with 2 USDC borrowed from a 1,000 USDC pool. Read it live, label it as variable, and design the screen for the zero case. Do not put a fixed APY in your pitch or your UI.
- **Withdrawals depend on free liquidity.** A lender can always withdraw up to their balance, as long as that USDC is not lent out at that moment. When borrowers hold most of the pool, a large withdrawal fails with `InsufficientLiquidity` (#11) until they repay or new lenders supply. Show that state instead of a generic error.
- **The user keeps the keys.** Your page builds the transaction; the user's wallet signs it. Let users sign in their own wallet ([Stellar Wallets Kit](https://stellarwalletskit.dev) covers Freighter, xBull, Lobstr and others). If your app collects users' USDC into an account you control, you have become a custodian, and you should say so in your pitch.
- **One balance per Stellar account.** Writz Lend tracks one supply balance per account. Goals, sub-accounts and "money for the trip" versus "money for school" live in your app's own database, not on chain.
- **Use your own RPC budget wisely.** Reads are simulations against Soroban RPC, not relayer calls. A bot or a backend that serves many users should cache the rate and avoid polling every user's balance every few seconds.

### Integrate yield in 15 minutes

From the command line, with `LEND` set to the current `writz-lend` ID from [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md) and an account that holds Circle testnet USDC (amounts in stroops, `100000000` is 10 USDC):

```bash
stellar contract invoke --id $LEND --network testnet --source-account me --send=no -- get_supply_rate_bp
stellar contract invoke --id $LEND --network testnet --source-account me -- supply_usdc --supplier $(stellar keys address me) --amount 100000000
stellar contract invoke --id $LEND --network testnet --source-account me --send=no -- get_supply_balance --lender $(stellar keys address me)
stellar contract invoke --id $LEND --network testnet --source-account me -- withdraw_supply --supplier $(stellar keys address me) --amount 100000000
```

From a web page, with `@stellar/stellar-sdk` 16.x. Reads are simulated and need no signature; a save or a withdrawal is prepared by your page, signed in the user's wallet and submitted by your page:

```ts
import { Address, BASE_FEE, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";

const LEND = "CABF7VK7F25ZGDLV6EWSAU3NYQYKDQNDSJIISDMDZAUASMSXUADSHZGG"; // writz-lend, contracts/deployments/testnet.md
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const lend = new Contract(LEND);

async function build(address: string, method: string, ...args: any[]) {
  const account = await server.getAccount(address);
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(lend.call(method, ...args))
    .setTimeout(300)
    .build();
}

async function read(address: string, method: string, ...args: any[]) {
  const sim = await server.simulateTransaction(await build(address, method, ...args));
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval);
}

export const rateBp = (address: string) => read(address, "get_supply_rate_bp").then(Number); // 500 is 5% a year; 0 while nothing is borrowed
export const balanceStroops = (address: string) =>
  read(address, "get_supply_balance", new Address(address).toScVal()) as Promise<bigint>; // 7 decimals, interest included

async function send(address: string, method: "supply_usdc" | "withdraw_supply", usdc: number) {
  const amount = nativeToScVal(BigInt(Math.round(usdc * 1e7)), { type: "i128" });
  const tx = await server.prepareTransaction(await build(address, method, new Address(address).toScVal(), amount));
  const signedXdr = await signWithWallet(tx.toXDR()); // your wallet integration
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET));
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(sent.status);
  return server.pollTransaction(sent.hash, { attempts: 30 });
}

export const save = (address: string, usdc: number) => send(address, "supply_usdc", usdc);
export const takeOut = (address: string, usdc: number) => send(address, "withdraw_supply", usdc);
```

`prepareTransaction` simulates first, so a call that would fail throws before the wallet opens: `Error(Contract, #13)` on `withdraw_supply` means more than the balance, `#11` more than the free liquidity, `#17` that the pool is paused. An account without a trustline to the test USDC fails inside the token contract on `supply_usdc`. To withdraw everything, pass the exact balance from `get_supply_balance`. Prepare a fresh transaction if the user waits long before signing: a built transaction carries the account's sequence number and goes stale. `stellar contract bindings typescript` generates a typed client instead of these helpers.

With `@writz/sdk` (`npm install @writz/sdk`, see [Build on Writz](/developers/integrate#packages)) the same calls are `lend.getSupplyRateBp()`, `lend.getSupplyBalance(address)`, `lend.buildSupplyUsdc(address, stroops)` and `lend.buildWithdrawSupply(address, stroops)`, which return the unsigned transaction for the wallet.

Checked on 2026-10-25 against Stellar testnet and the live `writz-lend` contract, with the TypeScript above: `get_supply_rate_bp` returned `0` and `get_supply_balance` the supplier's 1,000 USDC; `supply_usdc` and `withdraw_supply` of 10 USDC were prepared by simulation for an account that holds the test USDC, a `withdraw_supply` above its balance failed with `#13`, and `supply_usdc` from an account without a trustline failed inside the token contract. Nothing was submitted, so these checks left no deposits behind.

### A. Dollar savings with goals

**Problem.** Students and young workers in Costa Rica and across Latin America save in a currency that loses value, or not at all, because a dollar account takes paperwork and a savings goal has nowhere visible to live.

**Who pays.** Free for savers; the business is a small share of the yield, or a cooperative, bank or university that offers it to its members under its own name.

**Writz surface.** Writz Lend, lender side.

**48h scope.** A digital alcancía, mobile first: create a goal (name, target, date), connect a wallet, save with `supply_usdc` (the saver signs one transaction), and a progress bar from `get_supply_balance` against the target. Show the live rate from `get_supply_rate_bp`, marked as variable, with a clear screen for when it is zero, and a withdraw button. Goals live in your own database; the pool sees one balance per account.

**Stretch.** Round-ups and saving streaks, a goal shared with family, sign-in by email with an embedded wallet, cash in and out in colones through a SEP-24 anchor.

### B. A remittance that saves a slice on arrival

**Problem.** Families that receive remittances spend all of it on arrival. Saving a fixed share is easy to plan and hard to do by hand every time.

**Who pays.** Remittance apps and wallets, as a feature that keeps money and users on their platform; a share of the yield on what is saved.

**Writz surface.** Writz Lend, lender side. Remittances on Stellar arrive in Circle USDC, the asset the lending pool holds, so the saved slice goes straight in without a swap.

**48h scope.** A receiver app that watches the account for incoming USDC payments (Horizon's payments stream), and on each one proposes "save 10%", built as a `supply_usdc` transaction the receiver signs. A history screen of received versus saved, and the saved balance with interest from `get_supply_balance`. Show the live rate from `get_supply_rate_bp`, and what the screen says when it is zero.

**Stretch.** A rule per sender, a SEP-24 anchor for cash out, and [Bitcoin-backed remittances](#3-borrow-do-not-sell-bitcoin-backed-remittances) on the sending side.

### C. A treasury for small businesses

**Problem.** A hostel, a surf school or a freelancer paid in USDC keeps money idle between getting paid and paying suppliers.

**Who pays.** Small businesses, a monthly plan; accountants and point-of-sale platforms that offer it to their merchants.

**Writz surface.** Writz Lend, lender side.

**48h scope.** A dashboard with one rule: keep X USDC in the wallet for expenses, lend the rest to the pool. A button that builds the `supply_usdc` or `withdraw_supply` to get back to the rule, signed by the owner. Interest earned since the first deposit, computed as `get_supply_balance` minus net deposits (which your app records). Handle the case where the pool's free liquidity is lower than the withdrawal the rule asks for.

**Stretch.** A business account that needs two signatures (Stellar multisig), withdrawals timed for scheduled supplier payments, an export for the accountant.

### D. An endowment that spends only the yield

**Problem.** NGOs, school associations and community projects receive donations and want them to last. A fund that pays out only what its money earns keeps the principal intact.

**Who pays.** NGOs and foundations, a platform fee; donors, per campaign.

**Writz surface.** Writz Lend, lender side.

**48h scope.** Donors send USDC to the fund's own Stellar account (a plain payment; if donors supplied to the pool themselves, the balance would be theirs, not the fund's). The fund lends the donations to Writz Lend with `supply_usdc`. A public page shows the principal (the sum of donations, recorded by your app), the current value from `get_supply_balance`, and "available to spend": value minus principal. The treasurer withdraws exactly that amount with `withdraw_supply` and pays a beneficiary, with every transaction linked. Be honest on the page that "available to spend" stays at zero while nothing is borrowed.

**Stretch.** A Soroban contract that is itself the supplier and enforces on chain that the principal never leaves, donor receipts, members voting on where the yield goes.

### E. A savings bot in the chat app people already use

**Problem.** Many people in Latin America live in WhatsApp and Telegram, not in wallet apps.

**Who pays.** Cooperatives, communities and fintechs that want a chat channel to their members; a share of the yield.

**Writz surface.** Writz Lend, lender side.

**48h scope.** A Telegram bot (its Bot API is free and quick to start with; WhatsApp's business API needs approval, so leave it for later) with `/rate`, `/balance` and `/save 10`. The bot reads `get_supply_rate_bp` and `get_supply_balance` by simulation and, for a deposit, replies with a link to a small page where the user signs the `supply_usdc` in their own wallet. The bot never holds a key. A weekly message with what the user saved. Cache the rate: one bot serving many users should not simulate on every message.

**Stretch.** Group savings challenges, reminders on payday, and the [savings circle](#8-savings-circles-that-earn-while-they-wait) from idea 8 run inside a group chat.

| Idea | Writz surface | Stellar fit | Weekend | Business |
|---|---|---|---|---|
| [A. Dollar savings with goals](#a-dollar-savings-with-goals) | Writz Lend, lender side | Medium | High | Medium |
| [B. Remittance that saves](#b-a-remittance-that-saves-a-slice-on-arrival) | Writz Lend, lender side | High | High | High |
| [C. Business treasury](#c-a-treasury-for-small-businesses) | Writz Lend, lender side | High | High | Medium |
| [D. Endowment](#d-an-endowment-that-spends-only-the-yield) | Writz Lend, lender side | Medium | High | Medium |
| [E. Savings bot](#e-a-savings-bot-in-the-chat-app-people-already-use) | Writz Lend, lender side | Medium | High | Medium |

Scores use the same questions as the table below. Stellar fit is Medium where the same savings app could run on another chain's lending market; it rises when you add Stellar-specific pieces such as a SEP-24 anchor for cash in and out.

---

## How the ideas are scored

| Score | Question |
|---|---|
| **Stellar fit** | Is Stellar essential: USDC settlement, anchors, Soroban contracts, low fees? Would the product fall apart on another chain or off-chain? |
| **Weekend** | Can two to four people show it working end to end, on testnet, in about 48 hours? |
| **Business** | Is there a clear customer who already has this problem and would pay to have it solved? |

High means it clearly passes; Medium means it passes with a caveat named in the idea.

| # | Idea | Writz primitive | Stellar fit | Weekend | Business |
|---|---|---|---|---|---|
| 1 | [P2P Bitcoin-for-USDC escrow](#1-p2p-bitcoin-for-usdc-escrow) | Payment verification | High | High | High |
| 2 | [Pay with Bitcoin, settle the books on Stellar](#2-pay-with-bitcoin-settle-the-books-on-stellar) | Payment verification | High | High | Medium |
| 3 | [Borrow, do not sell: Bitcoin-backed remittances](#3-borrow-do-not-sell-bitcoin-backed-remittances) | USDC credit | High | Medium | High |
| 4 | [Payroll from a Bitcoin treasury](#4-payroll-from-a-bitcoin-treasury) | USDC credit | High | Medium | High |
| 5 | [Position guardian](#5-position-guardian) | USDC credit (read) | High | High | Medium |
| 6 | [A Bitcoin-backed credit line for AI agents](#6-a-bitcoin-backed-credit-line-for-ai-agents) | USDC credit | High | Medium | Medium |
| 7 | [Bitcoin payment checks as a tool for agents](#7-bitcoin-payment-checks-as-a-tool-for-agents) | Payment verification | Medium | High | Medium |
| 8 | [Savings circles that earn while they wait](#8-savings-circles-that-earn-while-they-wait) | USDC lending | High | High | Medium |

---

## The ideas

### 1. P2P Bitcoin-for-USDC escrow

**Problem.** Across Latin America, people trade Bitcoin for dollars peer to peer in chat groups and P2P marketplaces. One side always has to send first and trust the other, or both trust a platform that holds the funds. Scams and frozen accounts are the cost.

**Who pays.** Traders and OTC desks, a small fee per completed trade; P2P marketplaces that want settlement without holding customer funds.

**Writz primitive.** Payment verification. The USDC seller locks USDC in a Soroban escrow; the buyer pays BTC on Bitcoin; the escrow calls `verify_transaction`, parses the outputs, and releases the USDC only when the BTC has reached the seller's address with enough confirmations.

**48h scope.** A Soroban escrow contract (create offer, lock USDC, claim with an SPV proof, refund after a deadline) with a cross-contract call to `bitcoin-spv`, an output check with `spv-types`, and a used-`txid` set. A small web page that takes a Signet `txid`, fetches the proof from the SPV proof API and submits the claim. One complete trade on testnet, with transaction links.

**Stretch.** The reverse direction (BTC seller is paid USDC), partial fills, reputation per Stellar address, a SEP-24 anchor so the USDC seller can be paid out in local currency.

### 2. Pay with Bitcoin, settle the books on Stellar

**Problem.** Tourist businesses in Costa Rica (hostels, surf schools, tour operators) are asked to accept Bitcoin, but checking that a payment really arrived, issuing a receipt and reconciling it with dollar accounting is manual and error-prone.

**Who pays.** Merchants, per invoice or a monthly plan; point-of-sale and booking platforms that want Bitcoin acceptance without building it.

**Writz primitive.** Payment verification. Each invoice is a record on Stellar; it is marked paid when `verify_transaction` proves the matching Bitcoin payment, and a receipt is issued on chain that any accountant or auditor can check.

**48h scope.** An invoice page (amount, merchant Bitcoin address, expiry), a Soroban contract that marks an invoice paid against an SPV proof and rejects a reused `txid`, and a merchant dashboard listing paid invoices with their Bitcoin and Stellar transaction links. Demo one Signet payment to one invoice.

**Stretch.** Fiat value fixed at invoice time from the Reflector oracle, payout of the dollar amount in USDC through an anchor, a QR flow for a phone at the counter.

### 3. Borrow, do not sell: Bitcoin-backed remittances

**Problem.** Many people who hold Bitcoin in Central America also send money home every month. Selling Bitcoin to send dollars means giving up the Bitcoin, and in some places a taxable event. Borrowing against it keeps the Bitcoin and sends dollars today.

**Who pays.** The sender, a fee on each remittance on top of the loan interest; wallets and remittance apps that add "send without selling" as a feature.

**Writz primitive.** BTC-collateralized USDC credit. The sender borrows USDC on Writz Lend against BTC that never leaves Bitcoin, and the USDC is sent on Stellar to the recipient or to an anchor that pays out locally.

**48h scope.** A mobile-first web app: show an existing Writz Lend position and how much can be borrowed safely, borrow, send the USDC to a recipient address, and show the repayment schedule. Use the [Stellar test anchor](https://testanchor.stellar.org) (SEP-24) to show a local cash-out step. Create the Bitcoin deposit on day one; it needs six Signet confirmations.

**Stretch.** Recipient onboarding without a wallet (claimable balances or a passkey wallet), reminders before a position gets close to liquidation, a real anchor partner per corridor.

### 4. Payroll from a Bitcoin treasury

**Problem.** Startups and small companies that hold part of their treasury in Bitcoin still pay salaries and suppliers in dollars. Every payday they sell Bitcoin, often at a bad moment.

**Who pays.** Companies, a monthly subscription per seat or per payroll run.

**Writz primitive.** BTC-collateralized USDC credit. On payday the company borrows USDC against its locked BTC and pays everyone in one Stellar transaction; it repays from revenue as it comes in.

**48h scope.** A dashboard: treasury position (collateral, debt, health from `get_health_ratio_bp`, current rate from `get_borrow_rate_bp`), a payee list, and a "run payroll" action that borrows the total and pays every payee in one transaction. A guard that refuses a run that would push the position's health below a threshold the company sets.

**Stretch.** Scheduled runs, a multisig approval before each run, payslips, payouts in local currency through anchors.

### 5. Position guardian

**Problem.** A borrower's position can be liquidated if the price of Bitcoin falls. Most borrowers do not watch prices around the clock, and finding out after the fact is the worst way to learn.

**Who pays.** Borrowers, a premium tier with more alerts and channels; wallets and lending front ends that want to offer the alerts to their users.

**Writz primitive.** BTC-collateralized USDC credit, read side. `get_position` and `get_health_ratio_bp` give the current state of a position; the Reflector price feed the contract reads gives the market.

**48h scope.** A Telegram or WhatsApp bot: register a position by its Bitcoin `txid`, poll its health, alert at thresholds the user picks, and show the Bitcoin price at which it would be liquidated. Include a one-tap link to repay (a SEP-7 payment request or a link into a web page that builds the `repay` call for the user's wallet).

**Stretch.** Automatic partial repayment from a USDC balance the user pre-authorizes, a weekly position report, support for every position a Stellar address holds.

### 6. A Bitcoin-backed credit line for AI agents

**Problem.** AI agents increasingly pay for APIs, data and compute per request in USDC. Someone has to keep their wallets funded, and the person who owns the agent may hold Bitcoin rather than dollars.

**Who pays.** Agent builders and teams that run agents, a fee on credit drawn or a monthly plan.

**Writz primitive.** BTC-collateralized USDC credit. The owner keeps a Writz Lend position; the agent's Stellar wallet is topped up with borrowed USDC under limits the owner sets, and the agent spends it on paid APIs (for example over x402 on Stellar).

**48h scope.** An agent with its own Stellar account and a spending policy (per-request and daily limits), a top-up flow the owner signs that borrows on Writz Lend and funds the agent, and the agent paying a paid API in USDC. A ledger page showing what the agent spent and what the owner owes.

**Stretch.** Automatic repayment from income the agent earns, a policy contract on Soroban so the limits are enforced on chain rather than in the agent's code.

### 7. Bitcoin payment checks as a tool for agents

**Problem.** An agent or a service that sells to agents and wants to accept Bitcoin needs a way to know a payment is final before it delivers. Calling a block explorer means trusting it.

**Who pays.** Developers of agent services, per verification or a monthly plan; marketplaces of agent tools.

**Writz primitive.** Payment verification, packaged as a tool: an MCP server (or a small HTTP service) that takes a `txid`, an expected output and a number of confirmations, fetches the proof, and answers from `verify_transaction` on Stellar rather than from an explorer.

**48h scope.** An MCP server with a `verify_bitcoin_payment` tool, an agent that sells a piece of content and releases it only after the tool confirms a Signet payment, and a short demo of the full loop.

**Stretch.** Recording the verified `txid` in a Soroban contract so the same payment cannot unlock two deliveries, webhooks, a hosted plan.

### 8. Savings circles that earn while they wait

**Problem.** Rotating savings groups (tandas, cundinas) are common across Latin America: members pay in every week and one member takes the pot each round. The pot sits idle, and the organizer has to be trusted with it.

**Who pays.** Groups, a small share of the yield; cooperatives and community organizations that run many circles.

**Writz primitive.** USDC lending, the Writz Lend lender side. Between payouts, the group's USDC is lent to the Writz Lend pool and earns the interest Bitcoin borrowers pay.

**48h scope.** A Soroban contract for one circle (members, contribution, rotation order, payout) that is itself the supplier: it calls `supply_usdc` with each contribution and `withdraw_supply` for the pot when a member's turn comes, plus a simple page for members. A payout can fail if the pool's free liquidity is below the pot at that moment, so the contract needs a retry or a partial payout rule.

**Stretch.** Penalties for late payments, invitations by phone number, a group whose members hold Bitcoin and contribute by borrowing against it on Writz Lend.

---

## Not available yet

These are on the Writz roadmap or in progress. Do not depend on them this weekend; if your idea needs one, build against the live primitives above and describe the rest as your next step.

| Not available | Status |
|---|---|
| Writz lending on mainnet | Testnet only; mainnet target Q2 to Q3 2027 |
| Privacy for positions | A separate, opt-in privacy edition is being designed. It is not part of the protocol, and its testnet contracts are not an integration target |
| An SDK on npm or crates.io | Not published; use `@writz/bitcoin-script` and `spv-types` from the repository |
| A liquidator receiving Bitcoin | Not how liquidation works today: it clears the debt on Stellar and no BTC moves to the liquidator (see [Writz Lend](/products/writz-lend)). Do not design a product that assumes it |
| Proof of Bitcoin reserves, private conversion, automatic yield | Planned features listed in Vision, not built |
| Submitting Bitcoin headers yourself | On testnet, only the Writz relayer submits Signet headers to `bitcoin-spv` |

---

## Built on Writz

Projects that use a Writz primitive on Stellar. Each card links to the project's repository and its proof that the integration works on chain.

<CardGroup cols={3}>
  <Card title="Your project here" icon="plus" href="#get-listed">
    Ship something that uses Writz on testnet and open a pull request to add it.
  </Card>
</CardGroup>

### Get listed

1. Use at least one primitive from [What is live on testnet](#what-is-live-on-testnet) in a way your demo depends on, not just a link.
2. Put your code in a public repository, with a README that says which primitive you use and how.
3. Open a pull request to [WritzProtocol/writz](https://github.com/WritzProtocol/writz) that adds one card to this section: project name, one sentence, an icon, and a link to the repository. In the pull request description, list the testnet contract IDs or transaction hashes that show the integration working.
4. We check the transactions on testnet and merge. A listing is not an endorsement or an audit.

Questions while you build: ask in the Writz [Discord](https://discord.gg/zDa4xRN9Xe).
