---
title: "Technical Architecture Overview"
sidebarTitle: "Technical Overview"
---

**Version:** 0.1 (draft - pending Phase 0 validation)
**Last updated:** 2026-06-22
**Status:** Preliminary - subject to change after Phase 0 benchmarks

> **Superseded values notice:** This document predates several Phase 0/1 decisions and is kept for historical architecture context only. Where it conflicts with `docs/research/circom-circuit-design.md`, `docs/research/interest-rate-model.md`, `docs/research/oracle-design.md`, or the contract source (`contracts/contracts/writz-lend/src/`), those are the sources of truth, not this file. Known stale values below have been corrected inline; treat any other specific number in this document as unverified until cross-checked against the docs above.

---

## System Architecture

Writz Protocol operates across two blockchains: Bitcoin and Stellar. The architecture is designed to be trustless on the verification layer. Positions are plaintext: amounts, collateral and addresses are public on chain. Privacy is not part of the protocol; it is being designed as a separate, opt-in edition, in progress (see `docs/how-it-works/privacy-edition.md`).

```
┌─────────────────────────────────────────────────────────────────┐
│                         BITCOIN NETWORK                         │
│                                                                 │
│  User BTC Wallet (Xverse)                                       │
│        │                                                        │
│        │  Send BTC to P2WSH address                            │
│        ▼                                                        │
│  P2WSH Locking Script                                           │
│  ┌─────────────────────────────────────────┐                   │
│  │  Spending condition A:                  │                   │
│  │    Protocol co-signature + user sig     │  ← loan repaid    │
│  │  Spending condition B:                  │                   │
│  │    Timelock expiry (safety fallback)    │  ← emergency      │
│  └─────────────────────────────────────────┘                   │
│        │                                                        │
│        │  Bitcoin transaction confirmed (6 blocks)             │
└────────┼────────────────────────────────────────────────────────┘
         │
         │  SPV Proof Package
         │  (block headers + Merkle proof + raw tx)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STELLAR / SOROBAN                          │
│                                                                 │
│  ┌────────────────────────────────────────┐                     │
│  │     Bitcoin SPV Contract               │                     │
│  │                                        │                     │
│  │  verify_transaction(                   │                     │
│  │    headers: Vec<BlockHeader>,          │                     │
│  │    merkle_proof: MerkleProof,          │                     │
│  │    raw_tx: Transaction                 │                     │
│  │  ) → bool                              │                     │
│  │                                        │                     │
│  │  Operations:                           │                     │
│  │  • Validate header PoW (SHA256d)       │                     │
│  │  • Validate header chain continuity    │                     │
│  │  • Verify Merkle inclusion proof       │                     │
│  │  • Extract output address + amount     │                     │
│  └─────────────────┬──────────────────────┘                     │
│                    │  Verification result                        │
│                    ▼                                            │
│  ┌────────────────────────────────────────┐                     │
│  │     Writz Lend Contract               │                     │
│  │                                        │                     │
│  │  deposit(spv_proof, key_sig) → txid    │                     │
│  │  borrow(txid, amount) → USDC           │                     │
│  │  repay(txid, usdc_amount)              │                     │
│  │  liquidate(txid)   (keeper)            │                     │
│  │  publish_release_psbt(txid, psbt)      │                     │
│  │                                        │                     │
│  │  Plaintext positions keyed by txid     │                     │
│  └─────────────────┬──────────────────────┘                     │
│                    │                                            │
│                    ▼                                            │
│  ┌────────────────────────────────────────┐                     │
│  │     USDC Pool (Stellar native)         │                     │
│  │                                        │                     │
│  │  Lenders supply USDC → earn yield      │                     │
│  │  Borrowers receive USDC                │                     │
│  │  Protocol captures spread              │                     │
│  └────────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. P2WSH Locking Script (Bitcoin)

The BTC locking mechanism lives entirely on Bitcoin. It is a Pay-to-Witness-Script-Hash (P2WSH) address whose redeem script encodes two spending conditions using Bitcoin Script.

**Script design (simplified):**

```
OP_IF
  <protocol_pubkey> OP_CHECKSIGVERIFY
  <user_pubkey> OP_CHECKSIG
OP_ELSE
  <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
  <user_pubkey> OP_CHECKSIG
OP_ENDIF
```

**Spending path A (normal - loan repaid):**
- Both the protocol and the user sign the release transaction
- This is triggered when the user repays their USDC loan
- The Soroban contract generates the co-signature upon verifying repayment

**Spending path B (emergency - timelock expiry):**
- After a predefined locktime (e.g., loan maturity + 30 days), the user can spend without the protocol's signature
- Protects users if the protocol becomes unavailable

**Taproot consideration:** Taproot (P2TR) would make the normal spending path look like a regular payment, adding privacy on the Bitcoin side. This is a Phase 2+ consideration - P2WSH is simpler to implement first.

---

### 2. Bitcoin SPV Contract (Soroban)

The core of Writz's technical innovation. A Soroban smart contract that verifies Bitcoin transactions cryptographically.

**Approach: Stateless SPV**

Rather than maintaining a chain of Bitcoin block headers on Stellar (expensive, creates relayer dependency), Writz uses stateless SPV: the caller provides the relevant headers at verification time, and the contract verifies them without storing state.

**Core functions:**

```rust
// Verify that a Bitcoin transaction is included in a confirmed block
pub fn verify_transaction(
    env: Env,
    // The block headers - must form a valid chain with sufficient PoW
    headers: Vec<BitcoinBlockHeader>,
    // Merkle proof: sibling hashes from tx to block root
    merkle_proof: Vec<Bytes32>,
    // The transaction index in the block
    tx_index: u32,
    // The raw Bitcoin transaction
    raw_tx: Bytes,
    // Minimum confirmations required
    min_confirmations: u32,
) -> SpvVerificationResult

// Extract the output sent to a specific address from a transaction
pub fn extract_output(
    raw_tx: Bytes,
    expected_address: BitcoinAddress,
) -> Option<u64>  // Returns satoshi amount if found
```

**Cryptographic operations required:**
- `SHA256d` (double-SHA256): Bitcoin's primary hash function - used for block hashes, txids, Merkle tree nodes
- Merkle proof verification: O(log n) SHA256d operations for n transactions in the block
- Block header PoW verification: check that `SHA256d(header) < target`
- Header chain continuity: verify each header's `prev_block_hash` matches the previous

**Reference implementation:** `summa-tx/bitcoin-spv` Rust library provides all these functions. The Soroban port will adapt this library.

---

### 3. Privacy (not part of the protocol)

Writz v1 has no privacy layer. Positions, amounts and collateral are public on chain. An opt-in privacy edition with its own contracts (`commitment-tree`, `zk-verifier`, Circom circuits verified with Groth16 on Soroban), its own pool, audit and trusted-setup ceremony is in progress on testnet and planned for after v1 is live on mainnet, with no date. See `docs/how-it-works/privacy-edition.md`.

---

### 4. Writz Lend Contract (Soroban)

The lending logic that sits above the SPV layer.

**Key parameters (to be finalized in Phase 0):**
- Collateralization ratio: 150% minimum (BTC value must be 1.5x the USDC borrowed)
- Liquidation threshold: 120% (position liquidated if BTC/USDC ratio drops below this)
- Liquidation bonus: 10% of debt, paid in USDC from the protocol reserve (funded by 15% of interest), capped at the reserve balance
- Borrow rate: variable, determined by utilization ratio (similar to Blend/Aave)
- Supply rate: borrow rate × utilization × (1 - protocol fee percentage)
- Protocol fee: 15% of interest spread (finalized; see `PROTOCOL_FEE_BP` in `contracts/contracts/writz-lend/src/rates.rs` and `docs/research/interest-rate-model.md`)

**Interest rate model:**
```
utilization = borrowed_usdc / total_usdc_supplied

if utilization <= optimal_utilization (75%):
    borrow_rate = base_rate + (utilization / optimal) × slope1
else:
    borrow_rate = base_rate + slope1 + ((utilization - optimal) / (1 - optimal)) × slope2
```
(Corrected - this section originally showed 80% optimal utilization; the finalized value is 75%, see `docs/research/interest-rate-model.md`.)

**Liquidation flow:**
- A designated keeper monitors positions, which are public on chain
- When a position drops below 120% collateralization at the oracle price, the keeper calls `liquidate`; the contract re-checks the ratio itself
- If the keeper has been inactive for 24 hours (no liquidation and no heartbeat), any caller may liquidate an undercollateralized position
- Liquidator pays USDC and receives a USDC bonus from the protocol reserve; no BTC is released (GHSA-5rxp-7f9g-r66x)

---

### 5. USDC Liquidity Pools (Stellar native)

The supply side of Writz Lend. USDC lenders deposit into pools and earn yield. This is standard Stellar asset mechanics - no novel engineering required.

- Lenders supply USDC → receive interest-bearing receipt tokens
- Borrowers draw from these pools against their BTC collateral
- Interest accrues continuously; claimable at any time

---

### 6. Open SDK

A Rust crate that wraps the SPV verification logic, making it consumable by any other Soroban developer.

```rust
// Third-party Soroban contract using Writz SPV
use writz_spv::StellarSpvClient;

let spv = StellarSpvClient::new(env, WRITZ_SPV_CONTRACT_ADDRESS);
let result = spv.verify_payment(
    raw_tx,
    merkle_proof,
    block_headers,
    expected_address,
    min_confirmations: 6,
);
```

---

## Data Flow - Full User Journey

### Deposit + Borrow

```
1. User connects Xverse (BTC) + Freighter (Stellar) in Writz UI
2. Writz generates a unique P2WSH address for this deposit
3. User sends BTC to the P2WSH address on Bitcoin
4. After 6 confirmations:
   a. Writz header service provides block headers + Merkle proof
   b. User (or Writz UI) submits SPV proof to Soroban SPV contract
   c. SPV contract verifies and returns true
5. Writz Lend contract recognizes the deposit
   a. Rebuilds the Writz P2WSH, checks the user's key-control signature, consumes the txid
   b. Creates a plaintext position keyed by the Bitcoin txid
   c. User can now borrow up to 66% of BTC value in USDC
6. User requests USDC loan
   a. Contract checks the 150% collateral ratio at the oracle price
   b. USDC transferred to user's Stellar wallet
```

### Repay + Withdraw

```
1. User repays USDC loan + accrued interest
2. Writz Lend contract confirms repayment
3. Relayer co-signs the P2WSH spending path A PSBT and publishes it on writz-lend
4. User signs and broadcasts the BTC release transaction on Bitcoin
5. BTC arrives in user's original wallet
```

### Liquidation

```
1. Keeper detects an undercollateralized position from public chain state
2. Keeper calls liquidate(txid); the contract recomputes the health ratio from the oracle price
3. Liquidator pays USDC to cover the loan
4. Contract pays the liquidator a USDC bonus from the reserve (capped at its balance) and records the liquidation. The protocol never moves BTC.
```

---

## Security Considerations

### Bitcoin-side risks

| Risk | Mitigation |
|---|---|
| Bitcoin reorg (chain reorganization) | Require 6 confirmations - a 6-block reorg is extremely rare (has not happened in Bitcoin's history) |
| P2WSH script bug | Formal verification of locking script; multiple independent reviews |
| Protocol key compromise | Use MPC (multi-party computation) or HSM for protocol co-signing key |

### Soroban-side risks

| Risk | Mitigation |
|---|---|
| SPV contract bug | External audit; stateless approach limits attack surface |
| Oracle/price feed manipulation | Use median of multiple price oracles (Pyth primary, Reflector secondary) - see `docs/research/oracle-design.md` |
| Interest rate model edge cases | Stress-test model against historical volatility; cap max borrow rate |

### Economic risks

| Risk | Mitigation |
|---|---|
| BTC price crash → mass liquidations | Conservative 150% collateral ratio; liquidation discount creates keeper incentive |
| USDC supply drought | No minimum borrow guarantee; utilization-based rates auto-adjust |
| Keeper failure (no liquidations) | Stale-keeper fallback: after 24 hours of keeper inactivity, anyone with USDC can liquidate an eligible position |

---

## Technology Stack

| Component | Technology |
|---|---|
| Stellar smart contracts | Soroban (Rust) |
| Bitcoin SPV library | summa-tx/bitcoin-spv (Rust) - adapted |
| Bitcoin scripting | P2WSH (Phase 1) → Taproot (Phase 3) |
| Frontend | React/Next.js |
| Bitcoin wallet | Xverse (via PSBT standard) |
| Stellar wallet | Stellar Wallets Kit (Freighter, Lobstr, others) |
| Price oracles | Pyth (primary) + Reflector (secondary), SEP-40 median - see `docs/research/oracle-design.md` |
| Header service | Custom Node.js service connecting to Bitcoin full node |

---

*Last updated: 2026-06-22 - This document is preliminary. Architecture will be updated after Phase 0 benchmarks confirm feasibility of SPV in Soroban.*
