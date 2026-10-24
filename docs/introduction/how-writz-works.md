---
title: "How Writz Works"
---

*No technical knowledge required. Read this first.*

---

## The Safe Deposit Box Analogy

Imagine a safe deposit box at a bank. The box has two locks - one for you, one for the bank. Neither of you can open it alone under normal conditions. When you want to close your loan, both keys turn and the box opens. But there is also an emergency rule: if the bank disappears, a time-lock eventually lets you open the box alone.

Now replace the physical bank with a Bitcoin Script - a program written directly into Bitcoin's blockchain. Replace the physical box with a Bitcoin address. Replace the bank key with the protocol's co-signing key, which signs automatically once the Stellar contract records that your loan is repaid in full.

That is the foundation of Writz.

Your BTC is secured by rules on Bitcoin itself. No company holds your keys. No federation can collude. If Writz disappears entirely, you can still recover your BTC after a time-lock period - because the emergency rule is written into Bitcoin Script, not controlled by anyone.

---

## The Five Steps

### Step 1 - You lock BTC on Bitcoin

Writz generates a unique Bitcoin address for your deposit. It looks like any Bitcoin address: `bc1q...`. You send BTC from your wallet to this address.

Under the hood, this address is a P2WSH - a Bitcoin "smart contract" address with two spending conditions encoded directly in Bitcoin:

- **Normal path:** Both you and Writz must sign to release the BTC. Writz only co-signs when your USDC loan is repaid.
- **Emergency path:** After a time-lock period (loan term + safety buffer), you can spend the BTC alone - no Writz signature needed.

Your BTC is on Bitcoin. It never leaves. Nobody else can touch it.

### Step 2 - The deposit is verified on Stellar

After your BTC transaction gets 6 confirmations on Bitcoin (about 1 hour), a cryptographic proof is assembled. This proof contains:

- The Bitcoin block headers covering your transaction
- A Merkle proof showing your transaction is included in a specific block
- The raw transaction data

This bundle gets submitted to a Soroban smart contract on Stellar called the **bitcoin-spv** contract. The contract runs Bitcoin's own verification logic - double-SHA256 hashing, Merkle proof checking, proof-of-work validation - and confirms that your Bitcoin transaction happened. No oracle. No trusted third party. Pure cryptographic verification.

This is called **Simplified Payment Verification** (SPV). The contract acts like a lightweight Bitcoin node.

### Step 3 - Your position is created

You sign a short message with the Bitcoin key in the script, proving the deposit is yours, and approve one Stellar transaction. The **writz-lend** contract checks that your BTC is locked under the exact Writz script, asks the **bitcoin-spv** contract to verify the transaction, and records your position: the Bitcoin transaction, the amount of BTC and your Stellar address.

### Step 4 - You borrow USDC

You request a USDC loan against your locked BTC. Your loan can be up to 66% of your BTC's current USD value. The **writz-lend** contract prices your BTC with an on-chain BTC/USD oracle, checks that your collateral stays at 150% or more of the loan, and sends the USDC - Circle's native USDC on Stellar - to your Stellar wallet.

### Step 5 - You repay and get your BTC back

When you repay the USDC loan plus interest in full, the Writz relayer co-signs the Bitcoin release transaction with the protocol key and publishes it on Stellar. You add your own signature and broadcast it on Bitcoin. Your BTC arrives back in your wallet.

---

## What Is Public

Writz Lend positions are plaintext, like in any other lending market. Your Stellar address, your Bitcoin deposit transaction, how much BTC you locked, how much USDC you borrowed and repaid, and whether a position was liquidated are all visible on chain.

Privacy is not part of the protocol. It is being designed as a separate, opt-in edition, in progress and on testnet only, that Writz Lend users never touch: see [Privacy edition (in progress)](/how-it-works/privacy-edition).

---

## The Full Picture

```
                          BITCOIN NETWORK
                ─────────────────────────────────────────
                Your Wallet
                     │
                     │   Send BTC to P2WSH address
                     ▼
                P2WSH Script Address
                ┌──────────────────────────────────┐
                │  NORMAL:  You + Writz co-sign    │
                │  EMERGENCY: Timelock → you alone │
                └──────────────────────────────────┘
                     │
                     │  6 confirmations (~1 hour)
                     │
          ───────────┼─────────────────────────────────────
                     │       STELLAR / SOROBAN
                     │
                     ▼
              writz-lend contract
              (checks the script, records the position)
                     │
                     ▼
              bitcoin-spv contract
              (verifies block headers + Merkle proof)
                     │
                     ▼
              Borrow: USDC lands in your Stellar wallet

     When you repay ──► relayer co-signs, PSBT on Stellar ──► you sign, BTC released
```

---

## The Core Pieces Are Already Working

As of mid-2026:

- A real Bitcoin Signet transaction was locked in a P2WSH script and co-signed released: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098)
- `bitcoin-spv` and `writz-lend` are deployed on Stellar testnet and verify Signet deposits against the header chain stored on Stellar. See `contracts/deployments/testnet.md` for the current contract IDs and verified calls, and `docs/developers/runbook.md` for the manual Signet walkthrough.

What remains before mainnet is an external audit of the contracts, a formed legal entity and a second price source. No trusted-setup ceremony is on that path.

---

**Next:** [Why Stellar, Why Now →](/introduction/why-stellar-why-now)  
**Or dive deeper:** [The Technical Architecture →](/how-it-works/bitcoin-side)
