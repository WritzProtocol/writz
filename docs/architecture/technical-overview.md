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

**Script type:** Writz stays on P2WSH with an absolute block-height time-lock for mainnet v1. An earlier plan to move to Taproot (P2TR) is withdrawn: the planned 2-of-3 protocol side does not fit a MuSig2 key path, Taproot signing is not broadly supported by the launch wallets, and Soroban has no host functions for a Taproot output check. See "Script Roadmap: P2WSH, not Taproot" in [The Bitcoin Side](/how-it-works/bitcoin-side).

---

### 2. Bitcoin SPV Contract (Soroban)

The core of Writz's technical innovation. A Soroban smart contract that verifies Bitcoin transactions cryptographically.

**Approach: an on-chain header light client**

`bitcoin-spv` keeps a compact chain of Bitcoin block headers on Stellar, anchored at a checkpoint block that is set once and never changed. Relayers submit new headers with `submit_headers`; each one must descend from a stored header, carry valid proof of work at exactly the difficulty Bitcoin's retarget rules require, and accumulate chainwork, and the contract tracks the most-work chain. A transaction is then proven against a header the contract already stored, so a caller cannot present a header chain it mined privately. An earlier stateless design, in which the caller supplied the headers at verification time, was replaced for that reason. See [How SPV Verification Works](/how-it-works/spv-verification) and [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped).

**Core functions:**

```rust
// Add contiguous block headers to the light client (80-byte raw headers).
// Permissionless unless a submitter is configured. Returns the best tip height.
pub fn submit_headers(env: Env, headers: Vec<BytesN<80>>) -> Result<u32, SPVError>

// Prove that a transaction is in a stored block on the most-work chain,
// buried under at least `min_confirmations` blocks.
pub fn verify_transaction(
    env: Env,
    block_hash: BytesN<32>,          // a header the contract already stored
    merkle_proof: Vec<BytesN<32>>,   // sibling hashes from tx to block root
    tx_index: u32,                   // the transaction index in the block
    raw_tx: Bytes,                   // the raw transaction, without witness data
    min_confirmations: u32,
) -> Result<SpvVerificationResult, SPVError> // { txid, block_hash, block_height, confirmations }
```

Output checks are done by the consumer: `writz-lend::deposit` rebuilds the expected Writz P2WSH script from the protocol key, the depositor's key and the timelock, and requires the deposit output to match it.

**Cryptographic operations required:**
- `SHA256d` (double-SHA256): Bitcoin's primary hash function - used for block hashes, txids, Merkle tree nodes
- Merkle proof verification: O(log n) SHA256d operations for n transactions in the block
- Block header PoW verification: check that `SHA256d(header) < target`
- Header chain continuity: verify each header's `prev_block_hash` matches a stored header
- Difficulty retargeting and cumulative chainwork, to follow the most-work chain

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

The supply side of Writz Lend, and what Earn means on Writz. USDC lenders supply the pool with `supply_usdc` and earn the interest borrowers pay. This is standard Stellar asset mechanics - no novel engineering required.

- Lenders supply USDC → the contract records a scaled balance that grows with the supply index (no receipt token)
- Borrowers draw from the pool against their BTC collateral
- Interest accrues continuously; `withdraw_supply` returns principal plus interest at any time, up to the USDC not lent out

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
| Bitcoin reorg (chain reorganization) | Require 6 confirmations. Reorganizations that deep are very rare: the deepest on mainnet are the 2010 value-overflow fix and the 2013 BIP-50 fork |
| P2WSH script bug | Formal verification of locking script; multiple independent reviews |
| Protocol key compromise | Planned: a 2-of-3 protocol side in the P2WSH script, three keys held separately, so no single key can co-sign a release; the signing policy will be published. The user's time-lock exit never depends on these keys |

### Soroban-side risks

| Risk | Mitigation |
|---|---|
| SPV contract bug | Small header light client with no upgrade path; independent audit planned before mainnet; exposure caps bound what a verification failure could cost lenders. See [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped) |
| Oracle/price feed manipulation | Reflector SEP-40 price feed today, rejected when older than one hour; a second source (Pyth, pull model) with a deviation guard is planned - see `docs/research/oracle-design.md` |
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
| Bitcoin SPV library | Writz's own header light client (`bitcoin-spv`, Rust, no external SPV library) |
| Bitcoin scripting | P2WSH with an absolute CLTV time-lock; a 2-of-3 miniscript form planned; Taproot withdrawn |
| Frontend | React/Next.js |
| Bitcoin wallet | Xverse (via PSBT standard) |
| Stellar wallet | Stellar Wallets Kit (Freighter, Lobstr, others) |
| Price oracles | Reflector (SEP-40) today; Pyth planned as a second source with a deviation guard - see `docs/research/oracle-design.md` |
| Header service | Custom Node.js service connecting to Bitcoin full node |

---

*Last updated: 2026-06-22 - This document is preliminary. Architecture will be updated after Phase 0 benchmarks confirm feasibility of SPV in Soroban.*
