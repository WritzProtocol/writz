---
title: "What to build on Writz"
description: "Startup ideas that use the Writz primitives live on Stellar testnet today, scoped for a weekend and for a business after it, plus the showcase of projects built on Writz."
---

Writz lets Stellar know what happened on Bitcoin. A Soroban contract can check that a Bitcoin transaction is buried in the Bitcoin chain, and a borrower can lock native BTC on Bitcoin and take USDC on Stellar against it, with no bridge, no custodian and no wrapped token.

This page lists products we would like to see built on top of that. Each idea is meant to work twice: as a demo a small team can ship in a weekend hackathon, and as a business someone would pay for once it is real. Every idea names the Writz piece it uses, and only pieces that are live on Stellar testnet today. Anything that is not live yet is in [Not available yet](#not-available-yet), so you do not plan a weekend around it.

<Tip>
Building at the Pura Vida Ideathon (23 to 26 October 2026)? Any idea on this page, or your own, is eligible for the Writz integration bounties. The event page has the rules and the deadline.
</Tip>

---

## What is live on testnet

| Primitive | What it gives you | How to reach it |
|---|---|---|
| **Bitcoin payment verification** (`bitcoin-spv`) | An on-chain Bitcoin header light client. `verify_transaction` checks that a transaction is in a block on the best Bitcoin chain with at least N confirmations and returns its `txid`, `block_hash`, `block_height` and `confirmations`. Read-only, permissionless, callable from any Soroban contract or by simulation | Contract ID in [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md); interface in the [Contract Reference](/developers/contract-reference) |
| **SPV proof API** | `GET https://api.testnet.writz.xyz/spv-proof/:txid?confirmations=N` returns the raw transaction, its Merkle proof and `sorobanArgs` ready to pass to `verify_transaction` | [api.testnet.writz.xyz](https://api.testnet.writz.xyz) lists every endpoint |
| **BTC-collateralized USDC credit** (Writz Lend, `writz-lend`) | A borrower locks BTC in a P2WSH script on Bitcoin, registers it with `deposit`, borrows USDC up to 66.7% of its value (`borrow`), repays (`repay`) and takes the BTC back. Lenders `supply_usdc` and `withdraw_supply`. Read functions: `get_position`, `get_health_ratio_bp`, `get_borrow_rate_bp`, `get_supply_rate_bp`, `get_protocol_state` | [Writz Lend](/products/writz-lend); current contract ID in the deployment record above |
| **Bitcoin lock script** (`@writz/bitcoin-script`) | TypeScript: builds the deposit redeem script and address, and the release and emergency (timelock) spends | [`bitcoin-script/`](https://github.com/WritzProtocol/writz/tree/main/bitcoin-script) in the repo (not published to npm; install from the repo) |
| **Bitcoin transaction parsing** (`spv-types`) | Rust, `no_std`: `btc_parser::find_p2wsh_output` returns the satoshi value of the first output whose scriptPubKey equals the one you expect (any output type, despite the name); `key_proof` checks a BIP-137 signature from a Bitcoin key | [`contracts/contracts/spv-types/`](https://github.com/WritzProtocol/writz/tree/main/contracts/contracts/spv-types) (depend on it by git path) |
| **USDC yield** (Earn) | A Writz DeFindex vault that supplies USDC to Blend. `POST /defindex/deposit` and `/withdraw` return an unsigned transaction for the user's wallet to sign; `GET /defindex/apy` and `/position` read it | [Earn](/products/earn) |

Things to know before you start:

- **The Bitcoin side is Signet.** On testnet, `bitcoin-spv` follows Bitcoin Signet, and the Writz relayer keeps it in sync with the Signet tip. Get Signet coins from any public Signet faucet. A transaction that is not on Signet will not verify.
- **Confirmations take time.** Six Signet confirmations take about an hour, sometimes longer. Make your Bitcoin transactions on day one, not an hour before the deadline. For a demo you can ask for fewer confirmations; say so in your pitch.
- **`verify_transaction` does not remember.** It proves a transaction is in the chain; it does not mark it as used. If your contract pays out against a Bitcoin payment, store the `txid` and refuse it the second time. It also does not read outputs: parse `raw_tx` to check the amount and the recipient (use `spv-types` from Rust).
- **A Writz Lend deposit is a real Bitcoin transaction.** It needs Signet BTC sent to the address `@writz/bitcoin-script` derives, six confirmations, the proof from the SPV proof API, and a BIP-137 signature from the depositor's Bitcoin key over the message the contract rebuilds (reference implementation: `signDeposit` in [`scripts/deploy/e2e_local.mjs`](https://github.com/WritzProtocol/writz/blob/main/scripts/deploy/e2e_local.mjs)). The minimum deposit is 100,000 sats (0.001 BTC).
- **Testnet USDC.** Writz Lend uses Circle's testnet USDC (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). Add the trustline in your wallet and swap testnet XLM for it, or use Circle's faucet. The testnet Earn vault holds a Blend test token instead.
- **Testnet only.** Nothing here is audited, and Writz lending is not on mainnet (target: Q2 to Q3 2027). Do not put real funds through it.

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
| 8 | [Savings circles that earn while they wait](#8-savings-circles-that-earn-while-they-wait) | Earn | High | High | Medium |

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

**Writz primitive.** Earn. Between payouts, the group's USDC sits in the Writz Earn vault and earns lending yield; the relayer builds the deposit and withdrawal transactions for the group's wallet to sign.

**48h scope.** A Soroban contract for one circle (members, contribution, rotation order, payout) that deposits contributions into Earn and withdraws the pot for the member whose turn it is, plus a simple page for members. Use the Earn endpoints on testnet.

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
| Proof of Bitcoin reserves, Dark Swap, BTC Savings | Product ideas in the docs, not built |
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
