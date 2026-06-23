# Research: Stellar ZK Infrastructure — Protocol 25, 26 & 27

**Author:** Justin (Business Analyst) + Technical Research
**Date:** 2026-06-22
**Status:** Complete
**Phase:** 0.2 — Stellar Protocol X-Ray Deep Dive

---

## Executive Summary

Stellar has shipped the most complete compliance-friendly ZK infrastructure of any major blockchain ecosystem in 2026. Three consecutive protocol upgrades (X-Ray/P25, Yardstick/P26, and the forthcoming Zipper/P27) have progressively built out cryptographic primitives, reduced proof verification costs, and introduced smart account features that directly benefit Writz Protocol.

**Bottom line for Writz:**
- ZK position privacy is **technically feasible today** using Circom + Groth16 (the same stack as Stellar Private Payments)
- Protocol 26 (live May 2026) significantly reduces ZK verification cost on-chain
- Protocol 27 (July 8, 2026) introduces delegated authentication — directly useful for Writz's protocol co-signing mechanism
- A complete open-source reference implementation exists (NethermindEth/stellar-private-payments) that Writz can learn from directly

---

## Protocol 25 — X-Ray (Mainnet: January 22, 2026)

### What it is

Protocol 25, nicknamed **X-Ray**, is Stellar's foundational ZK upgrade. It embedded elliptic curve cryptography and ZK-friendly hashing natively into Soroban's host environment, making zero-knowledge proof verification on-chain practical for the first time.

### Technical primitives added

#### CAP-0074: BN254 Elliptic Curve Host Functions

Added native host functions for elliptic curve operations on **BN254** — the most widely used curve in the ZK ecosystem today (the same curve used by Ethereum's EIP-196/EIP-197 precompiles, Starknet, ZK Email, and most Circom-based applications).

Operations exposed:
- `bn254_add` — point addition on BN254
- `bn254_scalar_mul` — scalar multiplication on BN254
- `bn254_pairing` — bilinear pairing (the core operation for Groth16 verification)

**Why BN254 specifically:** BN254 (also known as alt_bn128) is the curve that powers Groth16 proofs, which is the proving system behind Circom, the most mature ZK circuit development tool. By targeting BN254, Stellar immediately enabled the entire Circom ecosystem.

> Note: BLS12-381 was added earlier (CAP-0059). BN254 was prioritized for Protocol 25 because of its widespread adoption in production ZK tooling, despite BLS12-381 offering slightly better security properties.

#### CAP-0075: Poseidon and Poseidon2 Hash Functions

Added the **Poseidon** and **Poseidon2** hash function primitives as native host functions.

**Why Poseidon matters for ZK:** Traditional cryptographic hash functions (SHA-256, Keccak) are computationally expensive inside ZK circuits because they use operations (bitwise, modular arithmetic in large primes) that don't translate efficiently to constraint systems. Poseidon was designed specifically to be ZK-friendly — it uses field arithmetic that maps cleanly to ZK constraints, resulting in circuits that are 10-100x smaller than SHA-256-based alternatives.

For Writz specifically, Poseidon is the hash function used to build:
- Position commitment trees (hiding collateral amounts)
- Merkle trees for nullifier sets (preventing double-spending)
- The commitment `commitment = Poseidon(amount, secret, nonce)`

### What became possible with Protocol 25

With BN254 + Poseidon on Soroban:
- **Groth16 proof verification** — verify a SNARK proof in a single Soroban transaction
- **Circom circuit compatibility** — any circuit built with Circom can be verified on Stellar
- **RISC Zero zkVM proofs** — arbitrary Rust program execution can be proven and verified on-chain
- **Privacy pools** — the Stellar Private Payments framework (shipped shortly after P25)

### Cost baseline established

A Groth16 SNARK verification requires approximately **40 million Soroban instructions** — roughly half of the testnet's maximum instruction budget per transaction. This is feasible but tight, and Protocol 26 was specifically designed to reduce this cost.

---

## Protocol 26 — Yardstick (Mainnet: May 6, 2026)

### What it is

Protocol 26, nicknamed **Yardstick**, brought precision and optimization to Stellar: a series of targeted improvements to Soroban's computation capabilities, ZK cryptography, and ledger management.

### ZK-specific additions: CAP-0080

**Nine new BN254 host functions** that move heavy ZK arithmetic from Wasm (expensive, slow) into the host layer (cheap, fast):

| Function | Purpose |
|---|---|
| `bn254_msm` | Multi-scalar multiplication — the heaviest operation in Groth16 verification |
| `bn254_field_add` | Scalar-field addition |
| `bn254_field_sub` | Scalar-field subtraction |
| `bn254_field_mul` | Scalar-field multiplication |
| `bn254_field_pow` | Scalar-field exponentiation |
| `bn254_field_inv` | Scalar-field inverse |
| `bn254_g1_is_on_curve` | Curve membership check for G1 points |
| `bn254_g2_is_on_curve` | Curve membership check for G2 points |
| `bls12_381_is_on_curve` | Curve membership check for BLS12-381 points |

**Why MSM matters:** Multi-scalar multiplication is the computationally dominant operation in Groth16 verification. Moving it from Wasm (where it had to be implemented in pure Rust and counted instruction-by-instruction) into a host function (where it's executed natively at hardware speed and billed as a fixed cost) reduces verification cost dramatically.

**Impact on Noir:** The Interstellar project (Ratherlabs) is building a Noir → BLS12-381 proving backend for Soroban. Protocol 26's new field arithmetic host functions make Noir proof verification significantly cheaper once that pipeline is complete.

### Other Protocol 26 features relevant to Writz

#### CAP-0077: Quorum Freeze (Ledger Entry Freezing)
The first consensus-driven on-chain mechanism to freeze compromised ledger entries. A validator quorum can freeze a specific key or contract without a full protocol upgrade.

**Writz relevance:** If a critical vulnerability is discovered in the Writz SPV contract or PrivateLend, the network now has a mechanism to freeze the affected contract while a fix is deployed. This is a meaningful security improvement for DeFi protocols on Stellar.

#### CAP-0082: Checked 256-bit Integer Arithmetic
256-bit integer operations in Soroban now **trap on overflow** rather than silently wrapping around. Any arithmetic that would exceed the 256-bit boundary aborts the transaction with an error.

**Writz relevance:** Critical for PrivateLend's financial calculations. Overflow in lending calculations (interest accumulation, collateral ratios, liquidation thresholds) is a classic DeFi exploit vector. Protocol 26 makes these errors explicit and transaction-aborting rather than silent.

#### SAC Improvements
The Stellar Asset Contract (SAC) can now create unlimited trustlines for G-accounts directly and auto-create account entries when sending XLM to new addresses.

**Writz relevance:** Simplifies USDC pool management — PrivateLend can create trustlines for lenders programmatically without pre-existing account setup.

---

## Protocol 27 — Zipper (Mainnet vote: July 8, 2026)

### Timeline

| Date | Event |
|---|---|
| June 4, 2026 | Upgrade guide published by SDF |
| June 5, 2026 | Stellar Core + SDK releases |
| June 18, 2026 | Testnet upgrade |
| July 8, 2026 | Mainnet validator vote |

### What it is

Protocol 27, nicknamed **Zipper**, makes **authentication delegation** a first-class feature on Stellar. One account can officially authorize another to act on its behalf, unlocking modular multisig, social recovery, and programmable signing policies.

### CAP-0071-01: Authentication Delegation

Two new host functions:

**`delegate_account_auth(address)`**
Called inside a custom account's `__check_auth` function to delegate authentication to a specified address. When an account calls this, the delegated address can approve transactions on behalf of the delegating account.

**`get_delegated_signers_for_current_auth_check()`**
Returns the list of addresses currently delegated for the active auth check, enabling contracts to inspect and reason about the delegation chain.

**New credential type:** `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES`
Bundles all delegated signers and their signatures into a single authorization entry, eliminating the need for separate authorization entries per delegated signer and reducing transaction size.

**Key properties:**
- Delegation can be **nested recursively** — delegated signers can themselves have delegated signers
- Any account (including smart contract accounts) can serve as a delegate
- Enables: social recovery, modular multisig, time-locked signing, session keys

### CAP-0071-02: Address-Bound Credentials

Introduces `SOROBAN_CREDENTIALS_ADDRESS_V2` — a new credential type with address-bound signature payloads. AddressV2 will **replace V1 in Protocol 28**, giving developers until the next upgrade to migrate.

### Breaking change: SDK consolidation

`@stellar/stellar-base` is being consolidated into `@stellar/stellar-sdk`. Anyone importing `stellar-base` directly must update imports to `@stellar/stellar-sdk`.

### Writz relevance — Protocol 27 is highly significant

**Protocol co-signing key architecture:**
The core mechanism in Writz requires a protocol-held co-signing key to authorize BTC release when loans are repaid. Protocol 27's auth delegation enables a much more robust design:

```
Writz Protocol Master Account
    │
    ├── delegate_account_auth(Operator Set A)  ← daily operations
    ├── delegate_account_auth(Operator Set B)  ← emergency recovery
    └── delegate_account_auth(TimeLock Contract) ← automatic release after maturity
```

Instead of a single protocol private key (single point of failure), Writz can distribute the co-signing authority across multiple delegated accounts with different roles and thresholds.

**Smart account users:**
Protocol 27 also enables end users to use smart contract accounts with delegated signers for their Writz positions — enabling things like:
- Multi-sig controlled positions (2-of-3 family members must approve borrowing)
- Session key access (temporary delegation to a frontend app)
- Dead-man's switch recovery (delegate to a backup address if main key is lost)

---

## Quantum Preparedness Roadmap (Announced June 9, 2026)

The SDF published a three-stage quantum preparedness plan that will affect Writz's long-term key management strategy.

| Stage | Timeline | What happens |
|---|---|---|
| **Stage 1** | 2026 | ML-DSA-44 and ML-DSA-65 (NIST post-quantum standards) added as native Soroban host functions |
| **Stage 2** | 2027 | Opt-in quantum-safe signer types for existing accounts |
| **Stage 3** | Flexible (post-2029) | Ed25519 deprecated when quantum threat is real |

**Writz relevance:** Stellar separates account identity from signing keys, meaning Writz's protocol keys can be migrated to post-quantum signatures (Stage 2, 2027) without changing the contract addresses or user positions. This is a meaningful long-term security advantage over EVM-based DeFi, where key migration requires contract redeployment.

---

## Stellar Private Payments — Reference Implementation

**Repository:** [NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)
**Docs:** [nethermindeth.github.io/stellar-private-payments](https://nethermindeth.github.io/stellar-private-payments/)
**Released:** February 2026 (shortly after Protocol 25 mainnet)
**Built by:** Nethermind ZK Engineering Team

### Architecture

The most complete open-source reference for ZK-private asset management on Stellar. Directly applicable to Writz's position privacy design.

**Model:** UTXO-based commitments (similar to Zcash shielded pool / Tornado Cash)

```
Deposit flow:
  User sends token to pool contract
    → Creates a commitment: Poseidon(amount, secret, nonce)
    → Commitment added to on-chain Merkle tree
    → User stores (amount, secret, nonce) privately

Transfer flow:
  User generates ZK proof:
    - "I know a (amount, secret, nonce) s.t. commitment is in the Merkle tree"
    - "I am spending this commitment to create new output commitments"
    - "Inputs = Outputs (no money created or destroyed)"
    - "I haven't spent this commitment before (nullifier not in nullifier set)"
  Proof verified on-chain by Groth16 verifier contract
  Nullifier recorded to prevent double-spend
  New output commitments created
```

### Technical stack

| Component | Technology |
|---|---|
| ZK circuits | Circom |
| Proving system | Groth16 |
| Elliptic curve | BN254 |
| ZK-friendly hash | Poseidon |
| Proof generation | WebAssembly (browser-side) |
| On-chain verifier | Soroban smart contract |
| Compliance | ASP membership/non-membership Merkle trees |

### Compliance system (ASPs)

Association Set Providers (ASPs) maintain two Merkle trees:
- **Allow list:** addresses permitted to interact with the pool
- **Block list:** addresses flagged for suspicious activity

Users can be required to prove they are on the allow list AND not on the block list, without revealing their identity. Operators can update these lists without accessing individual transaction data.

### What Writz takes from this directly

| Stellar Private Payments feature | Writz adaptation |
|---|---|
| Commitment = Poseidon(amount, secret, nonce) | PrivateLend position = Poseidon(collateral_btc, usdc_debt, secret, nonce) |
| Merkle tree of commitments | Merkle tree of active lending positions |
| Nullifier set (prevent double-spend) | Nullifier set (prevent double-repay / double-liquidation) |
| Circom circuit for transfer | Circom circuit for borrow/repay/liquidation proofs |
| Groth16 verifier on Soroban | Same — directly reusable |
| ASP compliance | Same — Writz can use ASPs for regulatory compliance |
| Browser-side WASM proving | Same — user generates ZK proof in browser before submitting |

---

## ZK Tooling Landscape on Stellar

### Proven / Production-ready today

| Tool | Status | Use case |
|---|---|---|
| **Circom + Groth16** | ✅ Production | Write circuits in Circom → generate Groth16 proofs → verify on Soroban via BN254 host functions |
| **RISC Zero** | ✅ Production | Prove arbitrary Rust program execution → verify on Soroban |
| **Stellar Private Payments** | ✅ Open source | Reference implementation of private asset pool on Soroban |
| **Groth16 verifier contract** | ✅ Example code | `stellar/soroban-examples/groth16_verifier` — ready to use |

### Emerging / In development

| Tool | Status | Use case |
|---|---|---|
| **Interstellar (Ratherlabs)** | 🟡 In development | Noir → BLS12-381 proving backend for Soroban; write ZK programs in Noir |
| **NoirLang direct** | 🟡 Possible with P26 | P26's new BN254 host functions make Noir verification cheaper when Interstellar ships |

### Writz recommendation: Use Circom + Groth16

For Writz's v1 privacy layer, use **Circom + Groth16 on BN254** — the same stack as Stellar Private Payments. It is:
- The only fully production-tested ZK stack on Stellar today
- Well-documented with working examples in the Stellar ecosystem
- Immediately compatible with Protocol 25 + 26 host functions
- Has browser-side WASM proving libraries ready

Noir + Soroban (via Interstellar) is worth tracking for v2 once it's production-ready — Noir is a more developer-friendly ZK language than Circom.

---

## Protocol Timeline Summary

```
2025
 Sep │ Protocol 23 (Whisk) — Parallel Soroban execution

2026
 Jan │ Protocol 25 (X-Ray) — BN254 + Poseidon → ZK on Soroban
     │   ↳ Stellar Private Payments open-sourced (Feb 2026)
     │
 May │ Protocol 26 (Yardstick) — BN254 MSM + scalar field arithmetic
     │   → ZK verification cost significantly reduced
     │   → Checked 256-bit arithmetic (overflow protection)
     │   → Quorum freeze (emergency contract freezing)
     │
 Jul │ Protocol 27 (Zipper) — Auth delegation [mainnet vote Jul 8]
     │   → Protocol co-signing key can be distributed/delegated
     │   → Smart account users with delegated signers
     │   → SDK: stellar-base merges into stellar-sdk
     │
2027 │ Quantum Stage 2 — Opt-in post-quantum signers
```

---

## Capability Assessment for Writz Protocol

| Writz requirement | Stellar capability | Protocol | Verdict |
|---|---|---|---|
| ZK proof of position privacy | Groth16 via BN254 (Circom) | P25 live | ✅ Feasible today |
| ZK-friendly hashing (commitments) | Poseidon host functions | P25 live | ✅ Feasible today |
| Affordable proof verification | BN254 MSM + scalar arithmetic | P26 live | ✅ Cost acceptable |
| Overflow-safe lending math | Checked 256-bit arithmetic | P26 live | ✅ Built-in |
| Protocol co-sign key distribution | Auth delegation | P27 Jul 8 | ✅ Imminent |
| Emergency contract freeze | Quorum freeze | P26 live | ✅ Available |
| Reference ZK pool implementation | Stellar Private Payments | P25 era | ✅ Open source |
| Browser-side proof generation | WASM Groth16 prover | P25 era | ✅ Available |
| Post-quantum key migration | ML-DSA via Soroban host | 2026 Stage 1 | 🟡 Coming |
| Noir-based circuits | Interstellar (in dev) | P26+ | 🟡 Not yet |

---

## Critical Findings for Writz Architecture

### 1. Use Circom + Groth16, not Noir (for now)
The Stellar Private Payments project by Nethermind uses Circom + Groth16 and is live today. Writz should use the same stack for v1 — it's the only production-ready ZK path on Stellar. Noir can be evaluated for v2.

### 2. Protocol 27 changes the co-signing key design
The Writz architecture doc assumed a single protocol co-signing key. Protocol 27 (shipping July 8) enables distributing this across multiple delegated signers with different roles. **Update the architecture before building the key management system.**

### 3. The Stellar Private Payments codebase is the direct reference
[NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments) implements exactly what Writz needs for position privacy: Poseidon commitments, Merkle trees, nullifier sets, Groth16 verification on Soroban, and browser-side WASM proving. Study this codebase before writing any Writz circuit code.

### 4. The 40M instruction limit requires careful circuit design
A Groth16 verification costs ~40M instructions, roughly half the per-transaction budget. Complex circuits with many constraints will approach this limit. Protocol 26's MSM host functions help. Circuit complexity (number of constraints) should be minimized in the Writz Circom design.

### 5. Protocol 26's overflow protection is free safety
Use `checked_add`, `checked_mul` etc. throughout the PrivateLend contract. Overflow in collateral ratio calculations is a classic exploit — Protocol 26 makes this a guaranteed transaction abort rather than silent corruption.

### 6. The compliance layer (ASPs) is built, not custom
Stellar Private Payments already implements the ASP membership/block-list system. Writz should reuse or integrate this rather than building custom compliance infrastructure.

---

## Recommended Next Steps

1. **Clone and run** [NethermindEth/stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments) locally — understand the complete ZK flow from circuit to Soroban contract
2. **Study** the `groth16_verifier` example in [stellar/soroban-examples](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier) — this is the on-chain verifier Writz will use
3. **Design Writz's Circom circuit** for position commitments before writing Soroban code:
   - Inputs: `collateral_satoshis`, `usdc_debt`, `secret`, `nonce`
   - Commitment: `Poseidon(collateral_satoshis, usdc_debt, secret, nonce)`
   - Constraints: collateral ratio ≥ 150%, no double-spend (nullifier check), valid Merkle inclusion
4. **Wait for Protocol 27 (July 8)** before finalizing the protocol co-signing key architecture — delegated auth changes the design significantly
5. **Track Interstellar** (Ratherlabs Noir backend) for potential adoption in v2

---

*Last updated: 2026-06-22*

*Sources:*
- [Announcing Stellar X-Ray, Protocol 25 — stellar.org](https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25)
- [Yardstick, Stellar Protocol 26 — stellar.org](https://stellar.org/blog/foundation-news/yardstick-stellar-protocol-26)
- [Protocol 26 Upgrade Guide — stellar.org](https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide)
- [Stellar Zipper Protocol 27 Upgrade Guide — stellar.org](https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide)
- [ZK Proofs on Stellar — developers.stellar.org](https://developers.stellar.org/docs/build/apps/zk)
- [NethermindEth/stellar-private-payments — GitHub](https://github.com/NethermindEth/stellar-private-payments)
- [Stellar Private Payments Docs — nethermindeth.github.io](https://nethermindeth.github.io/stellar-private-payments/)
- [CAP-0074: BN254 Host Functions — GitHub](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0075.md)
- [Interstellar: Noir + BLS12-381 for Soroban — Ratherlabs](https://github.com/orgs/noir-lang/discussions/8654)
- [Stellar Quantum Preparedness Plan — stellar.org](https://stellar.org/blog/foundation-news/introducing-the-quantum-preparedness-plan)
- [How Stellar Enables ZK Proof Verification with Protocol 25 — bitrue.com](https://www.bitrue.com/blog/stellar-zk-proof-verification)
- [Prototyping Privacy Pools on Stellar — stellar.org](https://stellar.org/blog/ecosystem/prototyping-privacy-pools-on-stellar)
