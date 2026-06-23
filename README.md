# Writz Protocol

**Trustless Bitcoin DeFi on Stellar — with ZK-private positions.**

Writz lets BTC holders borrow USDC against their Bitcoin without wrapping, bridging, or revealing their collateral position on-chain. A Soroban SPV contract verifies the on-chain BTC lock; a Groth16 ZK circuit hides the position; a P2WSH Bitcoin script enforces the locking rules at the Bitcoin layer.

---

## Architecture

```
Bitcoin mainnet                          Stellar / Soroban
─────────────────                        ─────────────────────────────────────
User locks BTC                           commitment-tree
  └─ P2WSH script                    ┌──   ├─ verify_deposit(spv_proof, zk_proof)
       ├─ Path A: co-sign release     │    ├─ borrow(zk_proof)
       └─ Path B: CLTV refund         │    └─ repay(zk_proof)
                                      │
Relayer (TypeScript)  ────────────────┤    bitcoin-spv
  └─ watches BTC mempool              │      └─ verify_transaction(header, proof, tx)
  └─ submits SPV proofs               │
                                      │    zk-verifier
ZK prover (snarkjs / Groth16)         └──    └─ Groth16 BN254 pairing check
  └─ deposit.circom                              (Protocol 26 host functions)
  └─ borrow_repay.circom
  └─ liquidation.circom
```

---

## Repository Structure

```
writz/
├── contracts/               # Soroban smart contracts (Rust)
│   ├── contracts/
│   │   ├── bitcoin-spv/     # Bitcoin SPV header chain verification
│   │   ├── zk-verifier/     # Groth16 BN254 proof verifier
│   │   ├── commitment-tree/ # Poseidon Merkle tree + lending logic
│   │   └── private-lend/    # PrivateLend orchestration contract
│   ├── deployments/
│   │   └── testnet.md       # Live testnet contract addresses + tx log
│   └── Cargo.toml
│
├── circuits/                # ZK circuits (Circom + snarkjs)
│   ├── src/
│   │   ├── deposit.circom
│   │   ├── borrow_repay.circom
│   │   ├── liquidation.circom
│   │   └── merkle.circom
│   ├── keys/                # Verification keys (vkey.json — committed)
│   └── test/                # Proof generation + verification tests
│
├── relayer/                 # SPV relayer service (TypeScript)
│   └── src/                 # Watches Bitcoin, submits SPV proofs to Soroban
│
├── bitcoin-script/          # Bitcoin locking script toolkit (TypeScript)
│   ├── src/
│   │   ├── script.ts        # P2WSH script builder
│   │   ├── address.ts       # Address derivation
│   │   ├── spend.ts         # Path A/B signing
│   │   └── keys.ts          # Key management
│   └── scripts/
│       └── e2e_testnet.mjs  # Bitcoin testnet3 end-to-end test
│
├── scripts/
│   └── deploy/              # Deployment + setup scripts
│       ├── set_vkeys.js     # Set Groth16 VKs on zk-verifier
│       └── e2e_zkflow.js    # Full ZK cycle test on Soroban testnet
│
└── docs/                    # Research, architecture, roadmap, SCF docs
```

---

## Testnet Deployments (Soroban testnet — 2026-06-22)

| Contract | ID |
|---|---|
| `bitcoin-spv` | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| `zk-verifier` | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| `commitment-tree` | `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7` |
| `private-lend` | `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |

Full deployment log, init transactions, and verified calls: [`contracts/deployments/testnet.md`](contracts/deployments/testnet.md)

---

## What Has Been Verified On-Chain

- **SPV verification** — Bitcoin block header + Merkle proof verified by Soroban contract ✅
- **Groth16 deposit proof** — BN254 pairing check via Protocol 26 host functions ✅
- **Poseidon Merkle tree** — leaf insertion and root update ✅
- **Groth16 borrow proof** — ZK collateral ratio enforcement (150% min) ✅
- **Groth16 repay proof** — field-negation repay amount recovered correctly ✅
- **P2WSH locking script** — Path A co-signed release; dry-run on testnet3 ✅

---

## Quick Start

### Prerequisites

- [Rust + `wasm32v1-none` target](https://www.rust-lang.org/tools/install)
- [Stellar CLI ≥ 27](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli)
- Node.js ≥ 20
- [circom](https://docs.circom.io/getting-started/installation/) + snarkjs

### Build contracts

```bash
cd contracts
stellar contract build
```

### Run contract tests

```bash
cd contracts
cargo test
```

### Run ZK circuit tests

```bash
cd circuits
npm install
npm test
```

### Run relayer tests

```bash
cd relayer
npm install
npm test
```

### Run Bitcoin script tests

```bash
cd bitcoin-script
npm install
npm test
```

### Bitcoin P2WSH dry-run (no funds needed)

```bash
cd bitcoin-script
npm run build
node scripts/e2e_testnet.mjs --dry-run
```

### Full ZK end-to-end on Soroban testnet

```bash
WRITZ_DEV_SECRET=<your-testnet-key> node scripts/deploy/e2e_zkflow.js
```

---

## Test Coverage

| Module | Tests | Status |
|---|---|---|
| `bitcoin-spv` contract | 28 | ✅ all pass |
| `zk-verifier` contract | 12 | ✅ all pass |
| `commitment-tree` contract | 50 | ✅ all pass |
| `private-lend` contract | 50 | ✅ all pass |
| relayer service | 35 | ✅ all pass |
| bitcoin-script | 48 | ✅ all pass |
| ZK circuits | 45 | ✅ all pass |

---

## Products

| Product | Description | Status |
|---|---|---|
| **PrivateLend** | BTC collateral → private USDC loan | Phase 1 — testnet ✅ |
| **Dark Swap** | Private BTC ↔ USDC swap | Planned (Phase 3) |
| **BTC Savings** | BTC collateral + auto USDC yield | Planned (Phase 3) |
| **ZK Proof of Reserve** | B2B: prove BTC holdings privately | Planned (Phase 3) |

---

## Documentation

Full research and architecture docs in [`docs/`](docs/):

- [Project Overview](docs/project-overview.md)
- [Technical Architecture](docs/architecture/technical-overview.md)
- [Roadmap](docs/roadmap/roadmap.md)
- [Research: Bitcoin SPV](docs/research/spv-implementations.md)
- [Research: ZK Circuit Design](docs/research/circom-circuit-design.md)
- [Research: Soroban Compute](docs/research/soroban-compute-benchmarks.md)
- [Research: Bitcoin Locking Script](docs/research/bitcoin-locking-script.md)

---

## License

MIT
