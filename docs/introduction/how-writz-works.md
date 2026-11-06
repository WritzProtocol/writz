---
title: "How Writz Works"
---

*No technical knowledge required. Read this first.*

---

## The Safe Deposit Box Analogy

Imagine a safe deposit box at a bank. The box has two locks, one for you and one for the bank. Neither of you can open it alone under normal conditions. When you close your loan, both keys turn and the box opens. There is also an emergency rule: if the bank disappears, a time lock eventually lets you open the box alone.

Now replace the bank with a Bitcoin Script, a small program that Bitcoin itself enforces. Replace the box with a Bitcoin address. Replace the bank key with the protocol's co-signing key, which signs automatically once the Stellar contract records that your loan is repaid in full.

That is the foundation of Writz.

Your BTC is secured by rules on Bitcoin itself. No company holds your key, and no federation holds the BTC. If Writz disappears, you can still recover your BTC once the time lock opens, because the emergency rule is written into the script, not controlled by anyone.

---

## The Five Steps

### Step 1: You lock BTC on Bitcoin

Writz generates a unique Bitcoin address for your deposit. It looks like any native SegWit address: `bc1q...` on mainnet, `tb1q...` on signet. You send BTC from your wallet to this address.

Under the hood, this address is a P2WSH (pay to witness script hash) address with two spending paths:

- **Normal path:** Both you and Writz must sign to release the BTC. Writz only co-signs when your USDC loan is repaid.
- **Emergency path:** Once a set Bitcoin block height is reached (at least about 7 days and at most about 2 years after the deposit confirms), you can spend the BTC alone, with no Writz signature.

Your BTC stays on Bitcoin. Neither path can move it without your signature.

### Step 2: The deposit is verified on Stellar

Once your BTC transaction has 6 confirmations on Bitcoin (about 1 hour; 1 on testnet), a proof is assembled. It contains:

- The hash of the Bitcoin block that includes your transaction
- A Merkle proof showing your transaction is included in a specific block
- The raw transaction data

The **bitcoin-spv** contract on Stellar keeps a chain of Bitcoin block headers, checked for proof of work as they arrive. It checks the proof against that chain: the block is in the chain with enough confirmations on top, and the Merkle proof places your transaction in it. No oracle or third party vouches for the deposit.

This is called **Simplified Payment Verification** (SPV). The contract acts as a Bitcoin light client.

### Step 3: Your position is created

You sign a short message with the Bitcoin key in the script, proving the deposit is yours, and approve one Stellar transaction. The **writz-lend** contract checks that your BTC is locked under the exact Writz script, asks the **bitcoin-spv** contract to verify the transaction, and records your position: the Bitcoin transaction, the amount of BTC and your Stellar address.

### Step 4: You borrow USDC

You request a USDC loan against your locked BTC. Your loan can be up to about 66.7% of your BTC's current USD value. The **writz-lend** contract prices your BTC with the Reflector BTC/USD oracle, checks that your collateral stays at 150% or more of the loan, and sends the USDC to your Stellar wallet. This is Circle's USDC: native USDC on mainnet, Circle's test USDC with no value on testnet.

### Step 5: You repay and get your BTC back

When you repay the USDC loan plus interest in full, the Writz relayer co-signs the Bitcoin release transaction with the protocol key and publishes it on Stellar. You add your own signature and broadcast it on Bitcoin. Your BTC arrives back in your wallet.

---

## What Is Public

Writz Lend positions are public, as in any other lending market. Your Stellar address, your Bitcoin deposit transaction, how much BTC you locked, how much USDC you borrowed and repaid, and whether a position was liquidated are all visible on chain.

---

## The Full Picture

<img className="block dark:hidden" src="/diagrams/full-picture.svg" alt="How a Writz loan works: lock BTC, prove the lock on Stellar, borrow USDC, repay, release BTC, with a timelock exit" />
<img className="hidden dark:block" src="/diagrams/full-picture-dark.svg" alt="How a Writz loan works: lock BTC, prove the lock on Stellar, borrow USDC, repay, release BTC, with a timelock exit" />

---

## What Works Today

- BTC locked in a Writz P2WSH script on Bitcoin signet was released through the cooperative path, signed by both keys: [`11932100…`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098) (June 2026).
- `bitcoin-spv` and `writz-lend` are deployed on Stellar testnet and verify signet deposits against the header chain stored on Stellar. The current contract IDs and verified calls are in [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md); the [runbook](/developers/runbook) walks through a signet deposit by hand.

Before mainnet, targeted for Q2 to Q3 2027, Writz still needs an external audit of the contracts, a formed legal entity and a second price source (RedStone, next to Reflector).

---

**Next:** [Why Stellar, Why Now →](/introduction/why-stellar-why-now)  
**Or dive deeper:** [The Bitcoin Side →](/how-it-works/bitcoin-side)
