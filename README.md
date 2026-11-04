# Writz Protocol

> **Bitcoin was built to be yours. Your loans should be too.**

[![CI](https://github.com/WritzProtocol/writz/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/WritzProtocol/writz/actions/workflows/ci.yml?query=branch%3Amain)
[![Tests](https://img.shields.io/badge/tests-623%20passing-brightgreen)](https://github.com/WritzProtocol/writz/actions)
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-blue)](https://stellar.expert/explorer/testnet)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**[Website](https://writz.xyz)** · **[Live App (testnet)](https://testnet.writz.xyz)** · **[Docs](https://docs.writz.xyz)** · **[Relayer API](https://api.testnet.writz.xyz)**

> **HackMeridian 2026 judges:** the event work, goals, demo steps and prior-work disclosure are in [HACKMERIDIAN.md](HACKMERIDIAN.md).

**Writz** is a Bitcoin lending protocol on Stellar where the collateral never leaves Bitcoin. Lock native BTC directly from your Bitcoin wallet (Signet coins on today's testnet), borrow USDC on Stellar, and take it back alone if Writz ever disappears.

No bridge. No custodian. No wrapped tokens.

---

## What Makes Writz Different

| | Writz | Every other lending protocol |
|---|---|---|
| **Custodian** | Bitcoin Script is the custodian | A company holds your BTC |
| **BTC** | Native on-chain BTC | Wrapped token (WBTC, tBTC…) |
| **Emergency exit** | CLTV timelock → reclaim alone | Depends on protocol availability |

---

## This Is Not a Whitepaper

As of October 2026, the protocol's two contracts (`bitcoin-spv` and `writz-lend`, redeployed on 25 October) are live on Stellar testnet, 839 tests pass, and Bitcoin Signet transactions have been verified on-chain.

| What | Status |
|---|---|
| Bitcoin SPV verification on Soroban | ✓ Live on testnet |
| `writz-lend` deposit, borrow, repay and release PSBT | ✓ Live on testnet |
| P2WSH locking + co-signed BTC release | ✓ Broadcast on Bitcoin Signet |
| Receive the loan as EURC, PYUSD or XLM (Soroswap) or as USDC on Base Sepolia (Circle CCTP V2) | ✓ Live on testnet |
| 839 tests across all modules | ✓ All passing |

But a few months ago, it was a whitepaper. Version 1.0 (July 2026) is at [writz.xyz/whitepaper](https://writz.xyz/whitepaper) and archived on Zenodo with the DOI [10.5281/zenodo.23148520](https://doi.org/10.5281/zenodo.23148520).

### Live Testnet Contracts

| Contract | Address | WASM | Tests |
|---|---|---|---|
| `bitcoin-spv` | `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO` | 45.2 KB | 68 |
| `writz-lend` | `CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS` | 94.6 KB | 165 |

Both were redeployed on 2026-10-25 because testnet rent rose sharply; positions on the previous contracts were closed and their BTC released. `writz-lend` was redeployed again on 2026-11-01 so its `supply` and `withdraw` events carry the scaled amount and the supply index (#257); `bitcoin-spv` was not. The storage windows that drive rent are now deployment parameters, see [Storage and TTL management](docs/how-it-works/stellar-side.md#storage-and-ttl-management).

Full deployment log, init transactions, and verified calls: [`contracts/deployments/testnet.md`](contracts/deployments/testnet.md)

---

## System Architecture

![System Architecture](docs/diagrams/output/01-system-architecture.png)

The protocol operates across two blockchains. Bitcoin is the custody layer - BTC never leaves the Bitcoin network. Stellar is the execution layer - SPV verification, loan logic, and USDC flows run on Soroban.

**Four layers, each with a clear boundary:**

1. **Bitcoin Network** - user's BTC wallet locks funds into a P2WSH script. The script enforces two spending conditions; no third party can move the funds.
2. **Backend Services** - an SPV Relayer watches Bitcoin blocks, submits their headers to the `bitcoin-spv` light client and assembles transaction proofs against them, and a repay watcher co-signs the release PSBT once a loan is fully repaid.
3. **Soroban Contracts** - `bitcoin-spv` verifies Bitcoin transactions cryptographically; `writz-lend` registers deposits and issues, accrues and settles USDC loans.
4. **Browser** - keys stay on the user's device. The Bitcoin wallet signs the key-control proof and the release transaction; the Stellar wallet signs Soroban transactions.

Positions, amounts and collateral are public on chain, like any other lending market.

---

## How It Works

### 1 - Deposit & Borrow

![Deposit Flow](docs/diagrams/output/02-deposit-flow.png)

1. User connects their Bitcoin wallet (Xverse) and a Stellar wallet (Freighter) to the Writz UI.
2. The frontend derives a unique P2WSH address for this deposit (user public key + protocol public key + timelock).
3. User sends BTC to that address on Bitcoin. The script is now live on-chain.
4. After the required confirmations (1 on this testnet deployment, 6 on mainnet), the SPV Relayer assembles a proof bundle: raw transaction, block headers, and Merkle inclusion path.
5. The user signs a key-control message with the Bitcoin key in the script, and calls `writz-lend.deposit` with the proof bundle and the signature.
6. `writz-lend` rebuilds the expected P2WSH script, asks `bitcoin-spv` to verify the transaction's inclusion and confirmations cryptographically - no oracle, no trust - and records the position.
7. The user can now borrow USDC from the `writz-lend` pool while keeping a collateral ratio of at least 150% (debt up to about two thirds of the BTC value). After borrowing, the user can keep USDC, convert it through the Soroswap router (EURC, PYUSD, XLM), or send it as native USDC to Base Sepolia with Circle CCTP V2 (testnet).

### 2 - Borrow & Repay

![Borrow / Repay Flow](docs/diagrams/output/03-borrow-repay-flow.png)

`writz-lend.borrow` checks the post-borrow collateral ratio against the BTC/USD oracle price and refuses anything below 150%, or a borrow when the position's Bitcoin timelock is less than 4,320 blocks above the `bitcoin-spv` tip. Interest accrues on a utilization-based curve. `repay` accepts partial or full repayment; a full repayment closes the position and emits a `repay_full` event.

### 3 - BTC Release

![BTC Release](docs/diagrams/output/04-btc-release-flow.png)

When the loan is fully repaid, the relayer's repay watcher builds the release PSBT (Partially Signed Bitcoin Transaction), co-signs it with the protocol key, and publishes it on `writz-lend` with `publish_release_psbt`, so it can be fetched even if the rest of the Writz stack is down. The user countersigns with their Bitcoin wallet and broadcasts. BTC arrives back in their wallet. The protocol never held custody at any point.

---

## Smart Contract Architecture

![Contract Interactions](docs/diagrams/output/07-contract-interactions.png)

| Contract | Purpose | Depends on |
|---|---|---|
| `bitcoin-spv` | SHA256d, PoW validation, checkpoint-anchored difficulty check, Merkle inclusion, block header chain, deposit txid registry | - |
| `writz-lend` | Deposit registration, USDC lending pool (supply, withdraw, borrow, repay), interest rate model, keeper liquidation, release PSBT publication; plaintext positions | `bitcoin-spv`, USDC, Reflector oracle |

**Interest rate model** - kinked curve: base rate + linear slope up to 75% utilization, then a steep slope to discourage over-borrowing. Protocol captures the spread between borrow and supply rates.

`writz-lend` consumes each deposit txid in the `bitcoin-spv` registry, so the same Bitcoin output cannot back two positions; see `docs/security/security-model.md` for how this also closes the Merkle duplicate-leaf ambiguity (CVE-2012-2459-class) at the deposit layer.

---

## Bitcoin Script Design

![Bitcoin P2WSH Script](docs/diagrams/output/09-bitcoin-script.png)

The BTC locking mechanism lives entirely on Bitcoin. The P2WSH redeem script encodes two spending paths:

```
OP_IF
  <protocol_pubkey> OP_CHECKSIGVERIFY
  <user_pubkey>     OP_CHECKSIG
OP_ELSE
  <locktime>        OP_CHECKLOCKTIMEVERIFY OP_DROP
  <user_pubkey>     OP_CHECKSIG
OP_ENDIF
```

**Path A - Cooperative release (normal case):** Both the protocol and user sign. Triggered when the loan is repaid. The relayer's repay watcher co-signs only after `writz-lend` records full repayment, and publishes the PSBT on chain with `publish_release_psbt`.

**Path B - Emergency recovery (timelock):** After the timelock height chosen at deposit (`borrow` requires it to be at least 4,320 blocks, about 30 days, above the Bitcoin tip; liquidation closes 288 blocks before it), the user can spend without any protocol involvement. If Writz disappears, the user's funds are never locked forever.

See [`bitcoin-script/`](bitcoin-script/) for the full P2WSH builder, address derivation, and PSBT signing toolkit.

---

## Products

| Product | Description | Status |
|---|---|---|
| **Writz Lend** | Deposit BTC as collateral → borrow USDC. Lend USDC to the pool → earn the interest borrowers pay | Testnet. Mainnet planned for Q2 to Q3 2027 |

Writz Lend is the only product. Possible future directions are listed in [Vision](docs/roadmap/vision.md#planned-for-later) and are not products.

The **Bitcoin SPV SDK** is also open infrastructure. Any Stellar protocol that needs to verify a Bitcoin transaction on-chain can use `bitcoin-spv` with one call, through [`writz-spv-client`](https://crates.io/crates/writz-spv-client) or [`@writz/sdk`](https://www.npmjs.com/package/@writz/sdk). Verification is free today; no per-call fee exists.

---

## Repository Structure

```
writz/
├── contracts/               # Writz v1 Soroban contracts (Rust)
│   ├── contracts/
│   │   ├── bitcoin-spv/     # SHA256d · PoW · Merkle inclusion · block headers
│   │   ├── writz-lend/      # Deposits · USDC pool · interest model · liquidation
│   │   └── spv-types/       # Types shared by bitcoin-spv and its consumers
│   └── deployments/
│       └── testnet.md       # Live addresses · tx hashes · verified calls
│
├── relayer/                 # SPV Relayer service (TypeScript · Express · Bun)
│   └── src/
│       ├── routes/proof.ts  # GET /spv-proof/:txid
│       ├── routes/deposit-status.ts  # GET /deposit-status/:txid
│       ├── routes/timeline.ts  # GET /timeline/:btcTxid
│       ├── routes/cctp.ts  # POST /cctp/relay, GET /cctp/relay/:burnHash
│       └── bitcoin/         # Esplora client · header fetching · proof assembly
│
├── bitcoin-script/          # Bitcoin locking script toolkit (TypeScript)
│   └── src/
│       ├── script.ts        # P2WSH builder
│       ├── address.ts       # Address derivation (testnet / mainnet)
│       ├── spend.ts         # Path A/B PSBT signing
│       └── keys.ts          # Key management
│
├── frontend/
│   ├── app/src/             # Next.js testnet app (React 19 · TypeScript)
│   │   ├── components/      # borrow · loan · lend · earn · reclaim
│   │   ├── lib/flows/       # deposit · borrow · repay · release · lend
│   │   └── lib/receive/     # Soroswap swap · Circle CCTP burn and relay status
│   └── landing/             # writz.xyz
│
├── packages/
│   └── brand/               # Graphite & Gold design tokens
│
├── scripts/
│   ├── deploy/              # Deployment scripts · deploy_stack.mjs · e2e_local.mjs
│   └── diagrams/            # Graphviz architecture diagrams (Python)
│
└── docs/                    # Full documentation (Mintlify)
```

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Smart contracts | Soroban · Rust | Protocol 26 · `soroban-sdk = "26"` |
| Bitcoin scripting | P2WSH (Phase 1) → Taproot (Phase 3) | `bitcoinjs-lib` · `ecpair` |
| Bitcoin wallets | Xverse · sats-connect | PSBT standard |
| Frontend | Next.js 16 · React 19 · TypeScript | App Router · Tailwind CSS 4 |
| Stellar wallets | Stellar Wallets Kit · Pollar | Freighter · Lobstr · email and social login on testnet |
| Relayer runtime | Bun · Express.js | Alpine Docker · Esplora-backed |
| CI | GitHub Actions | Per-module jobs plus docs sync · all must pass |

---

## Quick Start

### Prerequisites

```bash
# Rust with Soroban WASM target
rustup target add wasm32v1-none
cargo install stellar-cli --locked --version 27  # or later

# Node.js / Bun (for relayer, bitcoin-script, frontend)
node --version  # >= 20
bun --version   # >= 1.1

```

### Run All Tests

Each module has its own toolchain - there is no unifying root build, and the
package manager is **not** the same everywhere. Run them from the repo root:

```bash
# 1. Soroban contracts - 255 tests
cd contracts && cargo test
cd ..

# 2. Bitcoin script toolkit - 72 tests (Bun's own test runner)
cd bitcoin-script && bun install && bun test

# 3. Relayer service - 512 tests
#    Deps install with Bun, but the suite itself is Jest (ts-jest), so it must
#    be run through the package script - plain `bun test` picks Bun's runner
#    instead and fails. The relayer also imports the local @writz/* packages
#    via their built dist/ output, so build those first.
cd ../bitcoin-script && bun run build
cd ../packages/writz-lend && bun install
cd ../../relayer && bun install && bun run test
```

All 839 tests pass. If anything fails, [open an issue](https://github.com/WritzProtocol/writz/issues).

### Frontend Dev Server

```bash
cd frontend/app
cp .env.example .env.local
# Fill in NEXT_PUBLIC_* contract addresses from contracts/deployments/testnet.md
# Set NEXT_PUBLIC_RELAYER_URL=https://api.testnet.writz.xyz
bun install && bun dev
# → http://localhost:3000
```

The testnet app is live at **[testnet.writz.xyz](https://testnet.writz.xyz)**.

### Generate Architecture Diagrams

```bash
pip install graphviz
python3 scripts/diagrams/render-all.py
# → docs/diagrams/output/*.png + *.svg
```

---

## Test Coverage

| Module | Language | Tests | How to run |
|---|---|---|---|
| `bitcoin-spv` contract | Rust | 68 | `cd contracts && cargo test -p bitcoin-spv` |
| `writz-lend` contract | Rust | 100 |
| `spv-types` | Rust | 10 | `cd contracts && cargo test -p spv-types` | `cd contracts && cargo test -p writz-lend` |
| Relayer service | TypeScript | 248 | `cd relayer && bun run test` |
| Bitcoin script toolkit | TypeScript | 60 | `cd bitcoin-script && bun test` |
| **Total** | | **486** | |

---

## Business Model

| Revenue Stream | Mechanism |
|---|---|
| **Lending spread** | Borrow rate minus supply rate on Writz Lend |
| **SPV API fees** (later, not live) | Possible per-verification or subscription pricing for third-party integrations; verification is free today |
| **Protocol reserve** | A share of borrower interest kept on chain; today it funds liquidation bonuses |

---

## Security

### Risk Model

| Risk | Mitigation |
|---|---|
| Bitcoin reorg | Confirmation depth set at deployment: 6 on mainnet (1 on the current testnet deployment) |
| P2WSH script bug | Formal review; emergency timelock protects users regardless |
| Protocol key compromise | The protocol key cannot move BTC without the user's key; a 2-of-3 protocol side in the P2WSH script is planned, with a published signing policy |
| SPV contract exploit | Header light client anchored to a public checkpoint, with proof-of-work, exact difficulty and chainwork checks; no upgrade path; independent audit planned before mainnet. See [SPV vs Wrapped Bitcoin](docs/security/spv-vs-wrapped.md) |
| Oracle manipulation | Reflector SEP-40 feed with a one-hour staleness check; a second source (Pyth) with a deviation guard is planned |
| Mass liquidation (BTC crash) | Conservative 150% collateral ratio, liquidation below 120%; a designated keeper liquidates, and liquidation opens to anyone if the keeper goes stale |

### Audit Roadmap

| Scope | Timing |
|---|---|
| Soroban contracts (`bitcoin-spv`, `writz-lend`) | Before mainnet |
| Bitcoin P2WSH scripting | Internal, ongoing; external review before mainnet |

Mainnet launch is gated on zero open critical/high findings from the external contract audit.

To report a security issue: open a private [GitHub Security Advisory](https://github.com/WritzProtocol/writz/security/advisories/new). Full policy, response targets, and safe harbour in [`SECURITY.md`](SECURITY.md); rewards and severity bands in [`docs/security/bug-bounty.md`](docs/security/bug-bounty.md).

---

## Documentation

Full documentation lives in [`docs/`](docs/) and is published at **[docs.writz.xyz](https://docs.writz.xyz)**:

**Start here:**
- [Whitepaper](https://writz.xyz/whitepaper) - The technical paper (v1.0, July 2026): SPV verification and the lending market. The paper describes a stateless SPV design; the `bitcoin-spv` contract has since replaced it with an on-chain header light client. The Groth16 position privacy it describes is not part of Writz. DOI [10.5281/zenodo.23148520](https://doi.org/10.5281/zenodo.23148520).
- [What is Writz?](docs/introduction/what-is-writz.md) - Plain English. No jargon. 5 minutes.
- [The Problem](docs/introduction/the-problem.md) - Why public DeFi breaks BTC holders.
- [How Writz Works](docs/introduction/how-writz-works.md) - Full flow for any reader.
- [Why Stellar, Why Now](docs/introduction/why-stellar-why-now.md) - The strategic window.

**Products:**
- [Writz Lend](docs/products/writz-lend.md) - Step-by-step user guide.

**How it works (technical):**
- [Bitcoin Side](docs/how-it-works/bitcoin-side.md) - P2WSH locking, spending paths, CLTV.
- [SPV Verification](docs/how-it-works/spv-verification.md) - Trustless Bitcoin tx verification on Soroban.
- [Stellar Side](docs/how-it-works/stellar-side.md) - Contracts, interest model, USDC pool.

**Developers:**
- [Build on Writz](docs/developers/integrate.md) - Prove a Bitcoin transaction from your contract or app, on testnet.
- [For AI Agents](docs/developers/for-ai-agents.md) - Exact IDs, signatures and verified examples for coding agents.
- [Quick Start](docs/developers/quick-start.md) - Clone, build, test, deploy.
- [SPV SDK](docs/developers/spv-sdk.md) - Free Bitcoin verification for any Stellar protocol.
- [Contract Reference](docs/developers/contract-reference.md) - All public interfaces.

**Security:**
- [Security Model](docs/security/security-model.md) - What Writz protects and how.
- [Audits](docs/security/audits.md) - Audit roadmap and status.

**Roadmap:**
- [Vision](docs/roadmap/vision.md) - Where Writz is going by 2028.

---

## Contributing

1. Fork the repo and create a branch from `main`.
2. Run the full test suite before opening a PR - all 839 tests must pass.
3. For new features, add tests. For bug fixes, add a regression test.
4. Open a PR with a clear description of what changed and why.

See [`docs/developers/contribution-guide.md`](docs/developers/contribution-guide.md) for detailed guidelines.

---

## Get Involved

| You are | Start here |
|---|---|
| **BTC holder** who wants to borrow USDC against BTC | [Writz Lend →](docs/products/writz-lend.md) |
| **Developer** who wants to build on the protocol | [Build on Writz →](docs/developers/integrate.md) |
| **Stellar protocol** that needs Bitcoin verification | [SPV SDK →](docs/developers/spv-sdk.md) |
| **USDC holder** who wants to supply the lending pool | [Writz Lend →](docs/products/writz-lend.md#for-usdc-lenders-earn) |

---

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
