# ZK Proof of Reserve

**Prove you hold Bitcoin. Without revealing your wallet.**

ZK Proof of Reserve is a B2B product built on the Writz Protocol infrastructure. It allows companies — exchanges, fintechs, funds, custodians — to generate cryptographic proof that they control a specific amount of Bitcoin without revealing their wallet addresses, exact holdings, or any information that competitors or attackers could exploit.

---

## The Problem It Solves

After FTX collapsed in November 2022, "Proof of Reserve" became a regulatory and reputational expectation for any company that holds customer crypto assets. But the approaches used today are deeply flawed:

**On-chain Merkle proofs (Kraken, Binance approach):** The exchange publishes a Merkle tree of customer balances. Anyone can verify their balance is included. But the exchange must also reveal the total balance — and connecting wallet addresses to exchange identity is trivial for a sophisticated chain analyst. This leaks competitive intelligence and creates security risk.

**Attestation by auditors (Chainalysis, Nansen approach):** A third-party auditor signs off on the holdings. But this requires trusting the auditor, is expensive, and does not provide cryptographic verification. The customer must trust the attestation, not verify it.

**What's needed:** A proof that says "this entity controls at least X BTC" — verifiable by anyone — without revealing wallet addresses, the exact amount, or any other sensitive information.

That is what ZK Proof of Reserve delivers.

---

## How It Works

### For the Enterprise Customer

1. You specify the BTC threshold you want to prove (e.g., "we hold at least 1,000 BTC").
2. You run the Writz PoR client locally. It connects to your Bitcoin node (or a trusted Esplora instance) and fetches your UTXOs.
3. The client generates a Groth16 ZK proof that your UTXO set sums to at least the claimed threshold.
4. The proof is anchored to a specific Bitcoin block — providing a timestamp for the attestation.
5. The proof and a verification key are published. Anyone can verify the proof independently.

### What the Proof Reveals

| Information | Revealed? |
|---|---|
| That the prover controls ≥ X BTC | **Yes** (this is the claim) |
| The exact BTC amount | No |
| Wallet addresses or UTXOs | No |
| Transaction history | No |
| Any information about custody structure | No |

### Verification

Anyone — a regulator, an auditor, a counterparty, a retail customer — can run the public verification script against the published proof and verification key. No trust in Writz or the enterprise required. The math speaks.

---

## Use Cases

**Exchanges and custodians:** Publish regular ZK PoR attestations as a regulatory compliance artifact. Replace or supplement existing Proof of Reserve processes with a cryptographically stronger standard.

**Crypto funds and asset managers:** Prove BTC holdings to limited partners or counterparties without revealing the fund's wallet structure or exact position size.

**OTC desks and market makers:** Demonstrate capital adequacy to trading counterparties without competitive intelligence leakage.

**Mining companies:** Prove treasury holdings to lenders or investors without disclosing wallet addresses that could be targeted.

**Fintechs and neobanks:** Demonstrate to regulators that BTC held on behalf of customers is fully backed, without revealing the underlying custody infrastructure.

---

## Pricing Model

ZK Proof of Reserve is a SaaS product priced by attestation frequency:

| Plan | Attestations | Price |
|---|---|---|
| **Standard** | Monthly | $500/month |
| **Professional** | Weekly | $1,500/month |
| **Enterprise** | Daily or on-demand | Custom |

All plans include the on-premise PoR client, public verification tooling, and documentation for regulators and auditors.

**Volume pricing** is available for enterprise customers with multiple BTC custody entities.

---

## Technical Foundation

ZK Proof of Reserve uses the same Groth16 BN254 circuit infrastructure as PrivateLend's ZK layer. The ZK circuit is purpose-built for reserve attestation:

- Input: UTXO set (private), block hash at attestation time (public), threshold (public)
- Constraint: sum of UTXO values ≥ threshold
- Output: A Groth16 proof that can be verified by anyone with the published verification key

The circuit is compiled, the trusted setup ceremony is run publicly, and the verification key is published openly. The verification client is open source — any developer can inspect and run the verification independently.

---

## Status and Timeline

ZK Proof of Reserve is planned for Phase 3 (Q3 2027), after PrivateLend is live on mainnet and the ZK infrastructure has been audited.

The circuit design is complete. The required ZK infrastructure (zk-verifier contract, Groth16 BN254 pairing) is already deployed on Soroban testnet as part of the PrivateLend stack.

---

## Request a Demo

Institutions interested in early access to ZK Proof of Reserve can contact the Writz team directly. We are targeting 5 enterprise customers by end of 2027.

**Contact:** [team@writz.io](mailto:team@writz.io)

---

**Back to:** [All Products →](privatelend.md)
