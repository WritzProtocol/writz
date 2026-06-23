# Writz Protocol — Technical Architecture Overview

**Version:** 0.1 (draft — pending Phase 0 validation)
**Last updated:** 2026-06-22
**Status:** Preliminary — subject to change after Phase 0 benchmarks

---

## System Architecture

Writz Protocol operates across two blockchains: Bitcoin and Stellar. The architecture is designed to be trustless on the verification layer while using Stellar's ZK infrastructure to make positions private.

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
│  │     PrivateLend Contract               │                     │
│  │                                        │                     │
│  │  deposit(spv_proof) → Position         │                     │
│  │  borrow(position_id, amount) → USDC    │                     │
│  │  repay(position_id, usdc_amount)       │                     │
│  │  liquidate(zk_proof_undercollateral)   │                     │
│  │                                        │                     │
│  │  ZK Privacy Layer (Protocol X-Ray):    │                     │
│  │  • Collateral amounts hidden           │                     │
│  │  • Loan amounts hidden                 │                     │
│  │  • Position health hidden              │                     │
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

**Spending path A (normal — loan repaid):**
- Both the protocol and the user sign the release transaction
- This is triggered when the user repays their USDC loan
- The Soroban contract generates the co-signature upon verifying repayment

**Spending path B (emergency — timelock expiry):**
- After a predefined locktime (e.g., loan maturity + 30 days), the user can spend without the protocol's signature
- Protects users if the protocol becomes unavailable

**Taproot consideration:** Taproot (P2TR) would make the normal spending path look like a regular payment, adding privacy on the Bitcoin side. This is a Phase 2+ consideration — P2WSH is simpler to implement first.

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
    // The block headers — must form a valid chain with sufficient PoW
    headers: Vec<BitcoinBlockHeader>,
    // Merkle proof: sibling hashes from tx to block root
    merkle_proof: Vec<Bytes32>,
    // The transaction index in the block
    tx_index: u32,
    // The raw Bitcoin transaction
    raw_tx: Bytes,
    // Minimum confirmations required
    min_confirmations: u32,
) -> VerificationResult

// Extract the output sent to a specific address from a transaction
pub fn extract_output(
    raw_tx: Bytes,
    expected_address: BitcoinAddress,
) -> Option<u64>  // Returns satoshi amount if found
```

**Cryptographic operations required:**
- `SHA256d` (double-SHA256): Bitcoin's primary hash function — used for block hashes, txids, Merkle tree nodes
- Merkle proof verification: O(log n) SHA256d operations for n transactions in the block
- Block header PoW verification: check that `SHA256d(header) < target`
- Header chain continuity: verify each header's `prev_block_hash` matches the previous

**Reference implementation:** `summa-tx/bitcoin-spv` Rust library provides all these functions. The Soroban port will adapt this library.

---

### 3. ZK Privacy Layer (Soroban + Protocol X-Ray)

Writz uses Stellar's Protocol X-Ray to implement zero-knowledge proofs that hide position details.

**What is hidden:**
- The collateral amount (how much BTC a user deposited)
- The loan amount (how much USDC was borrowed)
- The health ratio (how close a position is to liquidation)
- The user's identity (positions are identified by ZK proof, not public key)

**What remains visible:**
- Total protocol TVL (aggregate, not individual)
- Total USDC outstanding (aggregate)
- Liquidation events (that a liquidation occurred, but not who or how much)

**ZK proof flow for deposits:**

```
User deposits BTC
    │
    ▼
SPV contract verifies BTC transaction (public)
    │
    ▼
PrivateLend creates a position commitment:
  commitment = hash(amount, user_secret, nonce)
  ZK proof: "I know (amount, secret, nonce) such that
             commitment = hash(amount, secret, nonce)
             AND amount >= MIN_COLLATERAL"
    │
    ▼
Commitment stored on-chain (public)
ZK proof verified on-chain (public)
Actual amount never revealed
```

**Technology:** Noir circuit (Aztec's ZK language), verified via Groth16 inside Soroban using Protocol X-Ray's ZK verifier.

---

### 4. PrivateLend Contract (Soroban)

The lending logic that sits above the SPV and ZK layers.

**Key parameters (to be finalized in Phase 0):**
- Collateralization ratio: 150% minimum (BTC value must be 1.5x the USDC borrowed)
- Liquidation threshold: 120% (position liquidated if BTC/USDC ratio drops below this)
- Liquidation penalty: 10% (liquidator receives a 10% discount on the BTC)
- Borrow rate: variable, determined by utilization ratio (similar to Blend/Aave)
- Supply rate: borrow rate × (1 - protocol fee percentage)
- Protocol fee: 15–20% of interest spread

**Interest rate model:**
```
utilization = borrowed_usdc / total_usdc_supplied

if utilization <= optimal_utilization (80%):
    borrow_rate = base_rate + (utilization / optimal) × slope1
else:
    borrow_rate = base_rate + slope1 + ((utilization - optimal) / (1 - optimal)) × slope2
```

**Liquidation flow (private):**
- A keeper bot continuously monitors positions (it has access to private position data via operator key)
- When a position drops below 120% collateralization, the keeper submits a ZK proof that the position is liquidatable — without revealing the specific amounts
- Anyone can liquidate by providing the proof
- Liquidator pays USDC, receives protocol co-signature for BTC release + 10% bonus

---

### 5. USDC Liquidity Pools (Stellar native)

The supply side of PrivateLend. USDC lenders deposit into pools and earn yield. This is standard Stellar asset mechanics — no novel engineering required.

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

## Data Flow — Full User Journey

### Deposit + Borrow

```
1. User connects Xverse (BTC) + Freighter (Stellar) in Writz UI
2. Writz generates a unique P2WSH address for this deposit
3. User sends BTC to the P2WSH address on Bitcoin
4. After 6 confirmations:
   a. Writz header service provides block headers + Merkle proof
   b. User (or Writz UI) submits SPV proof to Soroban SPV contract
   c. SPV contract verifies and returns true
5. PrivateLend contract recognizes the deposit
   a. Creates a position commitment (ZK)
   b. User can now borrow up to 66% of BTC value in USDC
6. User requests USDC loan
   a. ZK proof generated for loan amount (stays private)
   b. USDC transferred to user's Stellar wallet
```

### Repay + Withdraw

```
1. User repays USDC loan + accrued interest
2. PrivateLend contract confirms repayment
3. Protocol generates co-signature for P2WSH spending path A
4. User broadcasts BTC release transaction on Bitcoin
5. BTC arrives in user's original wallet
```

### Liquidation

```
1. Keeper detects undercollateralized position (via private operator key)
2. Keeper generates ZK proof: "this position's health ratio < 120%"
3. ZK proof verified on-chain (no amounts revealed)
4. Liquidator pays USDC to cover the loan
5. Protocol co-signs BTC release to liquidator
6. Liquidator receives BTC (at a 10% discount from market value)
```

---

## Security Considerations

### Bitcoin-side risks

| Risk | Mitigation |
|---|---|
| Bitcoin reorg (chain reorganization) | Require 6 confirmations — a 6-block reorg is extremely rare (has not happened in Bitcoin's history) |
| P2WSH script bug | Formal verification of locking script; multiple independent reviews |
| Protocol key compromise | Use MPC (multi-party computation) or HSM for protocol co-signing key |

### Soroban-side risks

| Risk | Mitigation |
|---|---|
| SPV contract bug | External audit; stateless approach limits attack surface |
| ZK proof soundness failure | Use battle-tested Groth16; rely on Stellar's Protocol X-Ray rather than custom circuits |
| Oracle/price feed manipulation | Use median of multiple price oracles (Pyth, DIA, Stellar native) |
| Interest rate model edge cases | Stress-test model against historical volatility; cap max borrow rate |

### Economic risks

| Risk | Mitigation |
|---|---|
| BTC price crash → mass liquidations | Conservative 150% collateral ratio; liquidation discount creates keeper incentive |
| USDC supply drought | No minimum borrow guarantee; utilization-based rates auto-adjust |
| Keeper failure (no liquidations) | Open liquidation — anyone with USDC can liquidate an eligible position |

---

## Technology Stack

| Component | Technology |
|---|---|
| Stellar smart contracts | Soroban (Rust) |
| ZK proofs | Noir circuits + Groth16 via Protocol X-Ray |
| Bitcoin SPV library | summa-tx/bitcoin-spv (Rust) — adapted |
| Bitcoin scripting | P2WSH (Phase 1) → Taproot (Phase 3) |
| Frontend | React/Next.js |
| Bitcoin wallet | Xverse (via PSBT standard) |
| Stellar wallet | Stellar Wallets Kit (Freighter, Lobstr, others) |
| Price oracles | Pyth Network + DIA (multi-oracle median) |
| Header service | Custom Node.js service connecting to Bitcoin full node |

---

*Last updated: 2026-06-22 — This document is preliminary. Architecture will be updated after Phase 0 benchmarks confirm feasibility of SPV in Soroban.*
