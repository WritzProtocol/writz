# Writz Protocol

> **Bitcoin was built to be yours. Your loans should be too.**

Writz is the first trustless Bitcoin lending protocol on Stellar. Lock real BTC. Borrow real USDC. Every position stays private — always.

No bridge. No custodian. No wrapped tokens.  
Every other lending protocol posts your balance on a public billboard. **Writz doesn't.**

---

## Already Working

This is not a whitepaper. As of June 2026, four contracts are live on Soroban testnet, 268 tests pass, and real Bitcoin transactions have been verified on-chain.

| What | Status |
|---|---|
| Bitcoin SPV verification on Soroban | ✅ Live on testnet |
| ZK-private positions (Groth16 BN254) | ✅ Verified on-chain |
| P2WSH locking + co-signed BTC release | ✅ Broadcast on Bitcoin testnet |
| Poseidon Merkle commitment tree | ✅ Root updated on-chain |
| Full deposit → borrow → repay ZK flow | ✅ 6 sequential testnet transactions |
| 268 tests across all modules | ✅ All passing |

**Live testnet contracts (Soroban testnet):**

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| `zk-verifier` | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| `commitment-tree` | `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7` |
| `private-lend` | `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |

Full deployment log, init transactions, and verified calls: [`contracts/deployments/testnet.md`](contracts/deployments/testnet.md)

---

## How It Works

```
Bitcoin Network                         Stellar / Soroban
────────────────────                    ─────────────────────────────────────

  Your BTC Wallet                         bitcoin-spv contract
       │                                        │
       │  Send BTC to P2WSH address             │  Verifies your BTC transaction
       │  (two rules: co-sign release            │  cryptographically — no trust needed
       │   OR timelock emergency exit)           │
       ▼                                         ▼
  BTC locked on Bitcoin              commitment-tree contract
  by Bitcoin Script.                       │
  Nobody else can touch it.               │  Creates a ZK commitment
                                           │  (your amounts stay hidden)
  Relayer watches Bitcoin ─────────────────┘
  submits SPV proof bundle                 ▼

                                   ZK proof verifies your loan
                                   is collateralized — without
                                   revealing the amount.

                                         ▼

                                   USDC arrives in your Stellar wallet.
                                   Your position: invisible on-chain.

  When you repay ◄─────────────── Writz co-signs BTC release.
  Your BTC is unlocked.            You broadcast. BTC back in your wallet.
```

---

## What You Can Do With Writz

| Product | Description | Status |
|---|---|---|
| **PrivateLend** | Deposit BTC as collateral → borrow USDC privately | Phase 1 — testnet ✅ |
| **Dark Swap** | Convert BTC to USDC directly — no exchange, no visible order | Phase 3 — planned |
| **BTC Savings** | BTC collateral + USDC auto-routed to highest yield pools | Phase 3 — planned |
| **ZK Proof of Reserve** | Prove BTC holdings without revealing wallets or amounts | Phase 3 — planned |

---

## What Makes Writz Different

**1. Bitcoin Script is the custodian — not a company.**  
Your BTC is locked by a P2WSH script that runs on Bitcoin itself. There is no multisig federation, no company with a hot wallet, no bridge custodian. If Writz disappears, a time-lock lets you reclaim your BTC unilaterally. Nobody else can take it.

**2. Private by default — not optional.**  
Every position is hidden behind a ZK commitment from the moment of deposit. The Soroban contract verifies your loan is properly collateralized without knowing the amount. Liquidation bots cannot target you because they cannot see you.

**3. Real BTC in, real USDC out.**  
The input is Bitcoin — native, on-chain, no wrapping. The output is Circle's native USDC on Stellar — not synthetic, not bridged. This is the same USDC used by banks, fintechs, and remittance networks worldwide.

**4. Open infrastructure for the Stellar ecosystem.**  
The Bitcoin SPV SDK is free for any Stellar protocol to use. If you are building anything on Stellar that needs to verify a Bitcoin transaction, one function call is all it takes.

**5. Compliance-ready privacy.**  
Writz runs on Stellar, which has Association Set Providers (ASPs) for selective disclosure. Private by default. Auditable on request. The only privacy architecture that institutional players can accept.

---

## Repository Structure

```
writz/
├── contracts/               # Soroban smart contracts (Rust)
│   ├── contracts/
│   │   ├── bitcoin-spv/     # Bitcoin SPV header chain verification
│   │   ├── zk-verifier/     # Groth16 BN254 proof verifier
│   │   ├── commitment-tree/ # Poseidon Merkle tree + ZK lending logic
│   │   └── private-lend/    # Non-ZK PrivateLend skeleton
│   └── deployments/
│       └── testnet.md       # Live testnet addresses + transaction log
│
├── circuits/                # ZK circuits (Circom + snarkjs)
│   ├── src/
│   │   ├── deposit.circom
│   │   ├── borrow_repay.circom
│   │   ├── liquidation.circom
│   │   └── merkle.circom
│   └── keys/                # Verification keys (committed)
│
├── relayer/                 # SPV relayer service (TypeScript)
│   └── src/                 # Watches Bitcoin, serves SPV proof bundles
│
├── bitcoin-script/          # Bitcoin locking script toolkit (TypeScript)
│   └── src/
│       ├── script.ts        # P2WSH builder
│       ├── address.ts       # Address derivation
│       ├── spend.ts         # Path A/B signing
│       └── keys.ts          # Key management
│
└── docs/                    # Full documentation
```

---

## Test Coverage

| Module | Tests | Status |
|---|---|---|
| `bitcoin-spv` contract | 28 | ✅ All pass |
| `zk-verifier` contract | 18 | ✅ All pass |
| `commitment-tree` contract | 50 | ✅ All pass |
| `private-lend` contract | 50 | ✅ All pass |
| Relayer service | 35 | ✅ All pass |
| Bitcoin script toolkit | 48 | ✅ All pass |
| ZK circuits | 45 | ✅ All pass |

---

## Quick Start

### Prerequisites

- Rust + `wasm32v1-none` target
- Stellar CLI ≥ 27
- Node.js ≥ 20
- circom + snarkjs (for ZK circuit tests only)

### Run All Tests

```bash
# Soroban contracts — 146 tests
cd contracts && cargo test

# Relayer service — 35 tests
cd ../relayer && npm install && npm test

# Bitcoin script toolkit — 48 tests
cd ../bitcoin-script && npm install && npm test

# ZK circuits — 45 tests
cd ../circuits && npm install && npm test
```

All 268 tests pass. If anything fails, [open an issue](https://github.com/writz-protocol/writz/issues).

### Full ZK End-to-End on Soroban Testnet

```bash
WRITZ_DEV_SECRET=<your-testnet-key> node scripts/deploy/e2e_zkflow.js
```

---

## Documentation

Full documentation lives in [`docs/`](docs/):

**Start here:**
- [What is Writz?](docs/introduction/what-is-writz.md) — Plain English. The home metaphor. 5 minutes.
- [The Problem](docs/introduction/the-problem.md) — Why public DeFi breaks BTC holders.
- [How Writz Works](docs/introduction/how-writz-works.md) — Anyone can understand this. No jargon.
- [Why Stellar, Why Now](docs/introduction/why-stellar-why-now.md) — The strategic window.

**Products:**
- [PrivateLend](docs/products/privatelend.md) — Step-by-step user guide.
- [ZK Proof of Reserve](docs/products/zk-proof-of-reserve.md) — The B2B enterprise product.

**How it works (technical):**
- [Bitcoin Side](docs/how-it-works/bitcoin-side.md) — P2WSH locking, spending paths, CLTV.
- [SPV Verification](docs/how-it-works/spv-verification.md) — Trustless Bitcoin tx verification on Soroban.
- [ZK Privacy Layer](docs/how-it-works/zk-privacy-layer.md) — Groth16, Poseidon commitments, what's hidden.
- [Stellar Side](docs/how-it-works/stellar-side.md) — Contracts, interest model, USDC pool.

**Developers:**
- [Quick Start](docs/developers/quick-start.md) — Clone, build, test, deploy.
- [SPV SDK](docs/developers/spv-sdk.md) — Free Bitcoin verification for any Stellar protocol.
- [Contract Reference](docs/developers/contract-reference.md) — All public interfaces.

**Security:**
- [Security Model](docs/security/security-model.md) — What Writz protects and how.
- [Audits](docs/security/audits.md) — Audit roadmap and status.

**Roadmap:**
- [Vision](docs/roadmap/vision.md) — Where Writz is going by 2028.
- [Phases](docs/roadmap/phases.md) — Phase-by-phase execution plan.

---

## Get Involved

| You are | Start here |
|---|---|
| **BTC holder** who wants to borrow USDC privately | [PrivateLend →](docs/products/privatelend.md) |
| **Developer** who wants to build on the protocol | [Quick Start →](docs/developers/quick-start.md) |
| **Stellar protocol** that needs Bitcoin verification | [SPV SDK →](docs/developers/spv-sdk.md) |
| **Institution** exploring ZK Proof of Reserve | [ZK PoR →](docs/products/zk-proof-of-reserve.md) |

---

## License

MIT
