# How Writz Works

*No technical knowledge required. Read this first.*

---

## The Safe Deposit Box Analogy

Imagine a safe deposit box at a bank. The box has two locks - one for you, one for the bank. Neither of you can open it alone under normal conditions. When you want to close your loan, both keys turn and the box opens. But there is also an emergency rule: if the bank disappears, a time-lock eventually lets you open the box alone.

Now replace the physical bank with a Bitcoin Script - a program written directly into Bitcoin's blockchain. Replace the physical box with a Bitcoin address. Replace the bank key with a cryptographic signature that a Stellar smart contract generates automatically when you repay your loan.

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

### Step 3 - Your position is created privately

Once the SPV contract confirms your BTC is locked, a private position is created on the **commitment-tree** contract.

Instead of recording "address X deposited 0.5 BTC," the contract records a **commitment** - a mathematical fingerprint of your deposit. Think of it like a sealed envelope. The contract can verify the envelope exists without ever opening it. Only you know what's inside.

Technically, this commitment is `Poseidon(amount, secret, nonce)` - a ZK-friendly hash of your deposit details that you generated locally. The amount never appears on-chain in plaintext.

### Step 4 - You borrow USDC

You request a USDC loan against your locked BTC. Your loan can be up to 66% of your BTC's current USD value.

To process the loan, Writz doesn't ask "how much did you deposit?" It asks you to prove - using a **zero-knowledge proof** - that your position exists, that it's adequately collateralized, and that the loan amount is within the allowed limit. The proof is a mathematical certificate that validates all of this without revealing the actual numbers.

This proof is generated locally in your browser and verified on-chain by the **zk-verifier** contract. The USDC - Circle's native USDC on Stellar - arrives in your Stellar wallet.

### Step 5 - You repay and get your BTC back

When you repay the USDC loan plus interest, the Stellar contract generates a cryptographic co-signature for the Bitcoin release transaction. You broadcast that transaction on Bitcoin. Your BTC arrives back in your wallet.

---

## What Outside Observers Can't See

| Information | Visible on-chain? |
|---|---|
| That a deposit happened (the commitment) | Yes |
| How much BTC you deposited | **No** |
| How much USDC you borrowed | **No** |
| Your liquidation threshold | **No** |
| Your wallet address linked to a position | **No** |
| Total protocol TVL (aggregate) | Yes |
| Total USDC outstanding (aggregate) | Yes |
| Whether a liquidation occurred | Yes |
| Who was liquidated | **No** (only a nullifier is revealed, not your identity) |
| How much debt was repaid in a liquidation | **Yes** - the liquidator has to know the amount to pay it. This is the one exception to "amounts stay hidden": the published number is cryptographically bound to your commitment, so it can't be faked, but it isn't hidden either. |

The protocol can prove it is solvent without revealing any individual position to the outside world. The electric fence protects you from your neighbors and from bots watching the chain.

**It does not protect you from Writz itself.** The keeper that monitors positions for liquidation runs on a private operator key with visibility into position details that no outside observer has - that's what lets it know *when* to act without a public health-factor feed leaking the same information to front-runners. This is a deliberate trade-off (privacy from everyone except the operator, not privacy from the operator), not an oversight, and it's the same trust model as trusting the protocol's contract code and audits generally. If that distinction matters to you, read `docs/security/security-model.md` before depositing.

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
              bitcoin-spv contract
              (verifies block headers + Merkle proof)
                     │
                     ▼
              commitment-tree contract
              (creates ZK commitment - amount hidden)
                     │
                     ▼
              zk-verifier contract
              (validates your Groth16 proof)
                     │
                     ▼
              USDC lands in your Stellar wallet

     When you repay ──► Stellar contract co-signs ──► BTC released on Bitcoin
```

---

## The Core Pieces Are Already Working - Separately

The flow above is not theoretical, but it has been proven in two separate pieces, not yet as one continuous real-money flow. As of June–July 2026:

- A real Bitcoin Signet transaction was locked in a P2WSH script and co-signed released: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098)
- A full ZK cycle (deposit → borrow → repay) was executed on Soroban testnet across 6 transactions: [`8daddf52`](https://stellar.expert/explorer/testnet/tx/8daddf528c6f6254e67132265e3d9fea07fe1ce63622115b8dff4c335138bbd9). This run used a fabricated Bitcoin transaction and synthetic header to skip Signet's confirmation wait - it proves the Soroban and ZK layers, not the Bitcoin custody path.
- Groth16 BN254 pairing checks pass on-chain. Poseidon Merkle roots update correctly. ZK-enforced collateral ratios hold.

The cryptography works. The contracts work. What has not yet been demonstrated is a single deposit flowing from a real Bitcoin transaction through SPV verification into a real ZK-private position in one continuous run - see `docs/developers/runbook.md` for the manual Bitcoin-side walkthrough that closes that gap. What remains beyond that is the frontend, the mainnet audit, and the trusted setup ceremony.

---

**Next:** [Why Stellar, Why Now →](why-stellar-why-now.md)  
**Or dive deeper:** [The Technical Architecture →](../how-it-works/bitcoin-side.md)
