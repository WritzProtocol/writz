# Research: Bitcoin Locking Script Design

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete
**Roadmap task:** Phase 0.4

---

## Overview

When a user deposits BTC into Writz Protocol, that BTC must be provably locked on the Bitcoin side — the user cannot move it until the loan is repaid. This document designs the Bitcoin-side locking mechanism, evaluating P2WSH vs. Taproot approaches and defining the exact script logic.

---

## The Core Problem

Bitcoin has no native way to "freeze" funds based on activity on another chain. Writz needs a mechanism where:
1. BTC is deposited to a specific Bitcoin address
2. That BTC **cannot be moved** without the protocol's co-signature (until loan is repaid)
3. The user has a **fallback recovery path** if the protocol becomes unavailable
4. The locking is **verifiable on Stellar** via SPV proof

The solution is a **2-of-2 multi-signature with a timelock escape hatch**, encoded as a Bitcoin script.

---

## Option A: P2WSH (Pay-to-Witness-Script-Hash)

**Recommended for Phase 1**

P2WSH locks funds to the hash of a custom redeem script, with spending data carried in the Witness field rather than ScriptSig. Lower witness weight = lower transaction fees when spending.

### Script Design

**Redeem script:**

```
OP_IF
    <protocol_pubkey> OP_CHECKSIGVERIFY
    <user_pubkey> OP_CHECKSIG
OP_ELSE
    <timelock_value> OP_CHECKLOCKTIMEVERIFY OP_DROP
    <user_pubkey> OP_CHECKSIG
OP_ENDIF
```

**Spending path A (normal — loan repaid):**
- Branch: `OP_IF` (push `1` to unlock)
- Requires: protocol signature + user signature
- Triggered: when user repays USDC loan and Writz co-signs the BTC release

**Spending path B (emergency — timelock expiry):**
- Branch: `OP_ELSE` (push `0` to unlock)
- Requires: only user signature + block height ≥ timelock
- Triggered: after a predefined locktime if Writz becomes unavailable
- Protects user from permanent loss if the protocol disappears

### Timelock value selection

The timelock must be long enough that:
- The loan has time to be repaid normally
- The protocol can resolve issues before the escape hatch opens
- But not so long that the user's capital is locked for an unreasonable period

**Recommended timelock formula:**
```
timelock = loan_origination_block + (loan_duration_blocks) + safety_buffer_blocks

For a 30-day loan at 10-min Bitcoin blocks:
  loan_duration = 30 × 24 × 6 = 4,320 blocks
  safety_buffer = 7 × 24 × 6 = 1,008 blocks (7 days)
  total_timelock = deposit_block + 5,328 blocks (~37 days from deposit)
```

This means if a user deposits and takes a 30-day loan, they retain the emergency option to recover their BTC after ~37 days even if Writz is completely offline.

**Implementation:** Use `OP_CHECKLOCKTIMEVERIFY` (CLTV) with an absolute block height, not a relative timelock. This avoids complexity when the loan term is extended or renewed.

### P2WSH address generation

Each deposit gets a unique P2WSH address derived from:
```
redeem_script = build_script(protocol_pubkey, user_pubkey, timelock)
script_hash = SHA256(redeem_script)
p2wsh_address = bech32_encode("bc", [0x00, script_hash])
```

The `timelock` is unique per deposit (based on current block height + loan duration). The `user_pubkey` is the user's Bitcoin public key. The `protocol_pubkey` is Writz Protocol's co-signing key.

### On-chain footprint

- **Output:** 34 bytes (version byte + 32-byte script hash)
- **Spending (path A, normal):** ~250 bytes (user sig + protocol sig + redeem script in witness)
- **Spending (path B, emergency):** ~180 bytes (user sig + redeem script in witness)
- **Fee impact:** Witness bytes are discounted by 4x in Bitcoin's fee calculation — P2WSH spends are economically efficient

---

## Option B: Taproot / P2TR (Pay-to-Taproot)

**Recommended for Phase 2+**

Taproot (BIP 341, active since November 2021) is a significant privacy and efficiency upgrade to Bitcoin scripting. It uses Schnorr signatures and Merkle trees (MAST — Merkelized Abstract Syntax Tree) to hide spending conditions until they are used.

### How Taproot improves on P2WSH for Writz

| Property | P2WSH | Taproot (P2TR) |
|---|---|---|
| **Normal spend appearance** | Clearly a multi-sig (reveals script) | Looks like single-key payment (key-path spend) |
| **Script privacy** | Redeem script revealed when spent | Unused script branches never revealed |
| **Fee efficiency (normal path)** | ~250 bytes | ~57 bytes (key-path spend with MuSig2) |
| **Complex script support** | Full Bitcoin Script | Tapscript (similar, slightly extended) |
| **Hardware wallet support** | Universal | Growing but not universal |
| **MuSig2 compatibility** | No | Yes — aggregates protocol + user key into one key |

### Taproot design for Writz

**Key-path spend (normal — loan repaid):**
Using MuSig2, the protocol key and user key are **aggregated into a single tweaked public key**. When the loan is repaid, both parties cooperatively produce a single Schnorr signature that unlocks the funds. On-chain this looks identical to a standard single-key Bitcoin payment — no evidence that it was a 2-of-2 multi-sig or a bridge deposit.

**Script-path spend (emergency — timelock):**
The timelock recovery script is embedded in a Tapscript leaf, committed to in the Taproot output. If the key-path spend is unavailable (Writz offline), the user reveals the leaf script and spends using only their key after the timelock.

**Privacy benefit:** Chain surveillance firms cannot identify Writz deposits from normal Bitcoin payments in the common case. Only the emergency path reveals the script structure.

### Why P2WSH first, Taproot later

- MuSig2 for the key-path requires interactive signing protocols (nonce exchange) between the user and the Writz backend. This adds complexity to the UX flow (two round trips instead of one).
- Hardware wallet support for Taproot key-path with MuSig2 is still limited in 2026.
- P2WSH is universally supported, well-audited, and simpler to implement correctly.
- The security properties are equivalent — only the on-chain privacy and fee efficiency differ.

---

## Protocol Co-Signing Key Architecture

### The problem

Writz holds a co-signing private key for the `protocol_pubkey` in every locking script. If this key is compromised, an attacker can drain all locked BTC by co-signing arbitrary release transactions.

### Solutions (in order of security)

**Phase 1: HSM (Hardware Security Module)**
Store the protocol private key in a cloud HSM (AWS CloudHSM, Azure Dedicated HSM). The key never leaves the HSM in plaintext. Signing requires authenticated access to the HSM service. Protects against software compromise but requires trust in the HSM provider.

**Phase 2: MPC (Multi-Party Computation)**
Distribute the protocol private key across multiple parties using threshold ECDSA (e.g., GG20/21 or CGGMP21 protocols). No single party ever holds the complete key. A 2-of-3 or 3-of-5 MPC setup is standard in institutional custody. Used by Fireblocks, Copper, and major custodians.

**Phase 2+: Stellar Auth Delegation (Protocol 27)**
Protocol 27 (July 8, 2026) enables distributing the co-signing authority on the Stellar side across multiple delegated accounts. While this doesn't directly affect the Bitcoin signing key, it enables a multi-party signing ceremony where multiple Stellar accounts must authorize a BTC co-signature before it's produced.

**Phase 3: FROST (Flexible Round-Optimized Schnorr Threshold)**
If Writz moves to Taproot (Phase 2+), FROST enables threshold Schnorr signatures where t-of-n parties cooperate to sign. More efficient than ECDSA MPC. Produces a single Schnorr signature indistinguishable from a regular single-key spend.

---

## zkRelay Alternative: ZK-SNARK Bitcoin Relay

Research uncovered an interesting alternative to pure stateless SPV: **zkRelay** — using ZK-SNARKs to batch-verify multiple Bitcoin block headers off-chain and post a single proof on-chain.

### zkRelay approach

Instead of the caller providing raw headers + Merkle proofs, a prover computes a ZK proof that:
- "I have validated N consecutive Bitcoin block headers"
- "Each header has valid PoW"
- "Transaction T is included in block at height H"

The on-chain verifier only checks the ZK proof — a constant-cost operation regardless of how many headers were validated off-chain.

**Cost reduction achieved in research:** 187x cheaper than BTC Relay's per-header approach when batching 504 headers.

### Why this matters for Writz

Writz's stateless SPV approach already avoids the worst costs of BTC Relay. But zkRelay's approach could further reduce the on-chain verification cost for the header chain portion of SPV, particularly if Writz needs to support longer confirmation periods or chains of headers for reorg safety.

**Recommendation:** Start with stateless SPV (summa-tx approach) in Phase 1. Evaluate zkRelay-style batched ZK header proofs in Phase 2 if header chain verification becomes a cost bottleneck.

---

## Bitcoin Reorg Handling

A Bitcoin block reorganization ("reorg") occurs when the network switches to a longer chain, invalidating previously confirmed blocks. If Writz accepts a deposit based on a block that later gets reorged out, the BTC effectively disappears.

### Risk assessment

- Reorgs of 1–2 blocks: happen occasionally (~once per few days)
- Reorgs of 3 blocks: extremely rare (a few times in Bitcoin's history)
- Reorgs of 6 blocks: **never happened in Bitcoin's history**

**Writz policy:** Require **6 confirmations** before accepting a deposit. This makes reorg risk negligibly small. The tradeoff is 60 minutes of user wait time — addressed in the UX section.

### Fast lane option

For users willing to pay a higher fee and accept slightly elevated risk:
- Require 3 confirmations (~30 minutes)
- Cap the maximum deposit size to $5,000 at 3-confirmation tier
- Standard deposits (>$5,000) always require 6 confirmations

---

## Complete Deposit-to-Repayment Flow

```
DEPOSIT:
1. User requests a deposit address from Writz UI
2. Writz generates unique P2WSH address:
   script = IF (writz_key + user_key) ELSE (timelock + user_key)
   address = P2WSH(SHA256(script))
3. Writz stores: (address, user_pubkey, timelock, expected_deposit_amount)
4. User sends BTC to the P2WSH address
5. After 6 Bitcoin confirmations, Writz UI prompts user to submit SPV proof
6. User (or Writz UI) submits proof to Soroban SPV contract
7. SPV contract verifies and signals PrivateLend contract
8. PrivateLend creates ZK position commitment, allows USDC borrowing

REPAYMENT:
1. User repays USDC + interest via PrivateLend contract
2. PrivateLend contract emits repayment event
3. Writz backend detects repayment event on Stellar
4. Writz backend co-signs a Bitcoin transaction spending path A:
   input: the P2WSH UTXO
   output: user's Bitcoin return address
   witness: [user_sig, writz_sig, redeem_script]
5. User broadcasts the pre-signed transaction on Bitcoin
6. BTC arrives in user's wallet (standard Bitcoin transaction)

EMERGENCY RECOVERY (if Writz offline):
1. User waits for timelock to expire (current block ≥ timelock_value)
2. User broadcasts a Bitcoin transaction spending path B:
   witness: [user_sig, 0x00, redeem_script]  (0x00 selects ELSE branch)
3. BTC returned to user without Writz involvement
```

---

## Key Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| Script type | P2WSH (Phase 1) → P2TR (Phase 2) | P2WSH: simpler, universal support. P2TR: better privacy, lower fees |
| Timelock | CLTV absolute block height | Simpler than relative timelocks, predictable |
| Timelock duration | Loan term + 7 days safety buffer | Protects users without locking capital indefinitely |
| Protocol key storage | HSM (Phase 1) → MPC (Phase 2) | Progressive decentralization of signing authority |
| Confirmation requirement | 6 standard, 3 fast-lane (capped) | 6 eliminates reorg risk; 3 improves UX for small amounts |
| SPV type | Stateless (summa-tx) | No on-chain header storage, no relayer dependency |
| Future direction | zkRelay batching for Phase 2+ | If header chain verification becomes a cost bottleneck |

---

*Last updated: 2026-06-22*
*Sources: [Bitcoin P2WSH — learnmeabitcoin.com](https://learnmeabitcoin.com/technical/script/p2wsh/) · [Taproot Technical — learnmeabitcoin.com](https://learnmeabitcoin.com/technical/upgrades/taproot/) · [zkRelay paper — eprint.iacr.org](https://eprint.iacr.org/2020/433) · [SmartCustody Timelocks — BlockchainCommons](https://github.com/BlockchainCommons/SmartCustody/blob/master/Docs/Timelocks.md)*
