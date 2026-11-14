<p align="center">
  <a href="https://writz.xyz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/brand/writz-lockup-white.svg">
      <img alt="Writz" src="docs/brand/writz-lockup-black.svg" width="300">
    </picture>
  </a>
</p>

<h3 align="center">Bitcoin was built to be yours. Your loans should be too.</h3>

<p align="center">
  Borrow USDC on Stellar against native Bitcoin that never leaves the Bitcoin network.<br>
  No bridge. No custodian. No wrapped tokens.
</p>

<p align="center">
  <a href="https://github.com/WritzProtocol/writz/actions/workflows/ci.yml?query=branch%3Amain"><img alt="CI" src="https://github.com/WritzProtocol/writz/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://stellar.expert/explorer/testnet/contract/CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS"><img alt="Network: Stellar testnet" src="https://img.shields.io/badge/network-Stellar%20Testnet-blue"></a>
  <a href="https://www.npmjs.com/package/@writz/sdk"><img alt="npm: @writz/sdk" src="https://img.shields.io/npm/v/@writz/sdk?label=%40writz%2Fsdk"></a>
  <a href="https://crates.io/crates/writz-spv-client"><img alt="crates.io: writz-spv-client" src="https://img.shields.io/crates/v/writz-spv-client?label=writz-spv-client"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
</p>

<p align="center">
  <a href="https://writz.xyz"><b>Website</b></a> &nbsp;·&nbsp;
  <a href="https://testnet.writz.xyz"><b>Testnet app</b></a> &nbsp;·&nbsp;
  <a href="https://docs.writz.xyz"><b>Documentation</b></a> &nbsp;·&nbsp;
  <a href="https://docs.writz.xyz/architecture/technical-overview"><b>Technical architecture</b></a> &nbsp;·&nbsp;
  <a href="https://api.testnet.writz.xyz"><b>Relayer API</b></a> &nbsp;·&nbsp;
  <a href="https://discord.gg/zDa4xRN9Xe"><b>Discord</b></a> &nbsp;·&nbsp;
  <a href="https://x.com/WritzProtocol"><b>X</b></a>
</p>

---

**Writz** is a Bitcoin lending protocol on Stellar where the collateral never leaves Bitcoin. Lock native BTC directly from your Bitcoin wallet (Signet coins on today's testnet), borrow USDC on Stellar, and take it back alone if Writz ever disappears.

The BTC sits in a Bitcoin script that the borrower and the protocol can only spend from together, and that the borrower can spend from alone once a timelock expires. A Bitcoin light client written as a Soroban contract verifies the deposit on Stellar with proof-of-work and a Merkle proof, so no oracle, bridge or federation has to vouch for it. USDC lenders fund the pool and earn the interest borrowers pay.

## Contents

- [The problem](#the-problem)
- [How Writz solves it](#how-writz-solves-it)
- [Status](#status)
- [System architecture](#system-architecture)
- [Loan lifecycle](#loan-lifecycle)
- [Bitcoin script design](#bitcoin-script-design)
- [Smart contracts](#smart-contracts)
- [Security and trust model](#security-and-trust-model)
- [Build on Writz](#build-on-writz)
- [Products and business model](#products-and-business-model)
- [Developing in this repository](#developing-in-this-repository)
- [Documentation](#documentation)
- [Get involved](#get-involved)
- [Contributing](#contributing)
- [License](#license)

---

## The problem

Borrowing against Bitcoin in DeFi almost always means handing it to someone else first. Wrapped BTC such as WBTC is backed by coins held by custodians. Threshold networks such as tBTC, and pegs such as Stacks sBTC, rely on a signer set that could move the coins if enough members acted together. The alternative is to sell the BTC or bridge it to another chain, which adds bridge contracts, peg mechanisms and the custody behind them.

Most Bitcoin holders who would borrow against their coins stay out for exactly these reasons: they will not give up custody, and they will not trust a bridge or a wrapped token. Read more in [The Problem](https://docs.writz.xyz/introduction/the-problem).

## How Writz solves it

| | Writz | Custodial lenders and wrapped-BTC protocols |
|---|---|---|
| **Who holds the BTC** | A Bitcoin script; no company or signer set can move it alone | A custodian or a signer set |
| **What the collateral is** | Native BTC on the Bitcoin chain | A wrapped token (WBTC, tBTC and similar) |
| **How the deposit is proven** | Bitcoin light client on Soroban: proof-of-work, difficulty and Merkle inclusion | The issuer or bridge attests to it |
| **If the protocol disappears** | CLTV timelock: the borrower reclaims the BTC alone | Depends on the protocol or custodian staying available |

Stellar is the execution layer because Circle issues USDC natively there, neither bridged nor wrapped, and Soroban's compute budget fits a full Bitcoin header light client written in Rust. Read more in [Why Stellar, Why Now](https://docs.writz.xyz/introduction/why-stellar-why-now).

---

## Status

As of November 2026, the protocol's two contracts (`bitcoin-spv`, deployed on 25 October, and `writz-lend`, deployed on 2 November) are live on Stellar testnet, and Bitcoin Signet transactions have been verified on-chain.

| What | Status |
|---|---|
| Bitcoin SPV verification on Soroban | Live on testnet |
| `writz-lend` deposit, borrow, repay and release PSBT | Live on testnet |
| P2WSH locking + co-signed BTC release | Broadcast on Bitcoin Signet |
| USDC lenders earn the interest borrowers pay ([evidence](https://docs.writz.xyz/developers/evidence/lender-yield-testnet)) | Live on testnet |
| Receive the loan as EURC, PYUSD or XLM (Soroswap) or as USDC on Base Sepolia (Circle CCTP V2) | Live on testnet |

Before mainnet, Writz adds default enforcement through Bitcoin transactions the borrower pre-signs at deposit, a 2-of-3 protocol signer set, a second price source (RedStone) and an external audit. Mainnet is planned for Q2 to Q3 2027. What is live and what is designed is set out in the [technical architecture](https://docs.writz.xyz/architecture/technical-overview).

The project started as a whitepaper (v1.0, July 2026, DOI [10.5281/zenodo.23148520](https://doi.org/10.5281/zenodo.23148520)). The design has moved on since; the [technical architecture](https://docs.writz.xyz/architecture/technical-overview) is the current reference.

### Live testnet contracts

| Contract | Address | WASM |
|---|---|---|
| `bitcoin-spv` | [`CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO`](https://stellar.expert/explorer/testnet/contract/CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO) | 45.2 KB |
| `writz-lend` | [`CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS`](https://stellar.expert/explorer/testnet/contract/CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS) | 94.6 KB |

Both were redeployed on 2026-10-25 because testnet rent rose sharply; positions on the previous contracts were closed and their BTC released. `writz-lend` was redeployed again on 2026-11-01, so its `supply` and `withdraw` events carry the scaled amount and the supply index (#257), and on 2026-11-02 for the projected pool and supply views (#256, #377); `bitcoin-spv` was not. The storage windows that drive rent are now deployment parameters, see [Storage and TTL management](https://docs.writz.xyz/how-it-works/stellar-side#storage-and-ttl-management).

Full deployment log, init transactions and verified calls: [`contracts/deployments/testnet.md`](contracts/deployments/testnet.md). Machine-readable IDs: [`contracts/deployments/testnet.json`](contracts/deployments/testnet.json).

---

## System architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/system-architecture-dark.svg">
  <img alt="Writz Protocol system architecture" src="docs/diagrams/system-architecture.svg">
</picture>

The diagrams show the protocol as designed; what runs on testnet today, the trust model and what is planned before mainnet are in the [technical architecture](https://docs.writz.xyz/architecture/technical-overview).

The protocol operates across two blockchains. Bitcoin is the custody layer: BTC never leaves the Bitcoin network. Stellar is the execution layer: SPV verification, loan logic and USDC flows run on Soroban.

**Four layers, each with a clear boundary:**

1. **Bitcoin Network** - user's BTC wallet locks funds into a P2WSH script. The script enforces two spending conditions; no third party can move the funds.
2. **Backend Services** - an SPV Relayer watches Bitcoin blocks, submits their headers to the `bitcoin-spv` light client and assembles transaction proofs against them, and a repay watcher co-signs the release PSBT once a loan is fully repaid.
3. **Soroban Contracts** - `bitcoin-spv` verifies Bitcoin transactions cryptographically; `writz-lend` registers deposits and issues, accrues and settles USDC loans.
4. **Browser** - keys stay on the user's device. The Bitcoin wallet signs the key-control proof and the release transaction; the Stellar wallet signs Soroban transactions.

Positions, amounts and collateral are public on chain, like any other lending market.

---

## Loan lifecycle

### 1. Deposit and borrow

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/deposit-and-borrow-dark.svg">
  <img alt="From a Bitcoin deposit to a USDC loan" src="docs/diagrams/deposit-and-borrow.svg">
</picture>

1. User connects their Bitcoin wallet (Xverse) and a Stellar wallet (Varial, formerly Freighter) to the Writz UI. On testnet, an email or social sign-in with a Signet test key kept in the browser replaces both.
2. The frontend derives a unique P2WSH address for this deposit (user public key + protocol public key + timelock).
3. User sends BTC to that address on Bitcoin. The script is now live on-chain.
4. After the required confirmations (1 on this testnet deployment, 6 on mainnet), the SPV Relayer assembles a proof bundle: raw transaction, block headers, and Merkle inclusion path.
5. The user signs a key-control message with the Bitcoin key in the script, and calls `writz-lend.deposit` with the proof bundle and the signature.
6. `writz-lend` rebuilds the expected P2WSH script, asks `bitcoin-spv` to verify the transaction's inclusion and confirmations cryptographically, with no oracle and no trusted party, and records the position.
7. The user can now borrow USDC from the `writz-lend` pool while keeping a collateral ratio of at least 150% (debt up to about two thirds of the BTC value). After borrowing, the user can keep USDC, convert it through the Soroswap router (EURC, PYUSD, XLM), or send it as native USDC to Base Sepolia with Circle CCTP V2 (testnet).

### 2. Borrow and repay

`writz-lend.borrow` checks the post-borrow collateral ratio against the BTC/USD oracle price and refuses anything below 150%, or a borrow when the position's Bitcoin timelock is less than 4,320 blocks above the `bitcoin-spv` tip. Interest accrues on a utilization-based curve. `repay` accepts partial or full repayment; a full repayment closes the position and emits a `repay_full` event.

If the collateral ratio falls below 120%, a keeper liquidates the position: it pays the outstanding USDC debt and receives a bonus from the protocol reserve. See [Liquidation](https://docs.writz.xyz/products/writz-lend#liquidation).

### 3. BTC release

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/repay-and-release-dark.svg">
  <img alt="Repaying a loan and releasing the Bitcoin" src="docs/diagrams/repay-and-release.svg">
</picture>

When the loan is fully repaid, the relayer's repay watcher builds the release PSBT (Partially Signed Bitcoin Transaction), co-signs it with the protocol key, and publishes it on `writz-lend` with `publish_release_psbt`, so it can be fetched even if the rest of the Writz stack is down. The user countersigns with their Bitcoin wallet and broadcasts. BTC arrives back in their wallet. The protocol never held custody at any point.

### Lending USDC

Lenders supply USDC to the same `writz-lend` pool and earn the interest borrowers pay, minus the protocol fee. The rate is variable and zero while nothing is borrowed. See [For USDC lenders](https://docs.writz.xyz/products/writz-lend#for-usdc-lenders-earn) and the [lending guide](https://docs.writz.xyz/guides/lend).

---

## Bitcoin script design

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/vault-spending-paths-dark.svg">
  <img alt="Writz vault spending paths" src="docs/diagrams/vault-spending-paths.svg">
</picture>

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

**Path B - Emergency recovery (timelock):** After the timelock height chosen at deposit (`borrow` requires it to be at least 4,320 blocks, about 30 days, above the Bitcoin tip; liquidation closes 288 blocks before it), the user can spend without any protocol involvement. If Writz disappears, the user's funds are never locked forever. The step-by-step procedure is in [Manual emergency recovery](https://docs.writz.xyz/how-it-works/manual-emergency-recovery).

The full P2WSH builder, address derivation and PSBT signing toolkit live in [`bitcoin-script/`](bitcoin-script/); the design is explained in [Bitcoin Side](https://docs.writz.xyz/how-it-works/bitcoin-side).

---

## Smart contracts

| Contract | Purpose | Depends on |
|---|---|---|
| `bitcoin-spv` | SHA256d, PoW validation, checkpoint-anchored difficulty check, Merkle inclusion, block header chain, deposit txid registry | - |
| `writz-lend` | Deposit registration, USDC lending pool (supply, withdraw, borrow, repay), interest rate model, keeper liquidation, release PSBT publication; plaintext positions | `bitcoin-spv`, USDC, Reflector oracle |

**Interest rate model:** a kinked curve, base rate + linear slope up to 75% utilization, then a steep slope to discourage over-borrowing. Protocol captures the spread between borrow and supply rates.

`writz-lend` consumes each deposit txid in the `bitcoin-spv` registry, so the same Bitcoin output cannot back two positions; see the [Security Model](https://docs.writz.xyz/security/security-model) for how this also closes the Merkle duplicate-leaf ambiguity (CVE-2012-2459-class) at the deposit layer.

### Key parameters

Values set by the `writz-lend` constructor today.

| Parameter | Value |
|---|---|
| Minimum collateral ratio | 150% (maximum LTV about 66.7%) |
| Liquidation threshold | 120% |
| Liquidation bonus | 10% of the debt, paid in USDC from the protocol reserve |
| Interest rate curve | 0% base, 8% at 75% utilization, then a 200% slope above it |
| Protocol fee | 15% of interest, kept as the protocol reserve |
| Minimum deposit | 100,000 sats on mainnet; 5,000 sats on testnet |
| Bitcoin confirmations | 6 on mainnet; 1 on testnet |
| Borrow timelock margin | Timelock at least 4,320 blocks (about 30 days) above the Bitcoin tip known on Stellar |
| Liquidation cutoff | No liquidation within 288 blocks (about 2 days) of the timelock |
| Price source | Reflector BTC/USD oracle, rejected if older than 1 hour |

The full list, with the rate model worked through, is in [Writz Lend](https://docs.writz.xyz/products/writz-lend#key-parameters) and [Stellar Side](https://docs.writz.xyz/how-it-works/stellar-side). Every public function is documented in the [Contract Reference](https://docs.writz.xyz/developers/contract-reference).

---

## Security and trust model

### Risk model

| Risk | Mitigation |
|---|---|
| Bitcoin reorg | Confirmation depth set at deployment: 6 on mainnet (1 on the current testnet deployment) |
| P2WSH script bug | Formal review; emergency timelock protects users regardless |
| Protocol key compromise | The protocol key cannot move BTC without the user's key; a 2-of-3 protocol side in the P2WSH script is planned, with a published signing policy |
| SPV contract exploit | Header light client anchored to a public checkpoint, with proof-of-work, exact difficulty and chainwork checks; no upgrade path; independent audit planned before mainnet. See [SPV vs Wrapped Bitcoin](https://docs.writz.xyz/security/spv-vs-wrapped) |
| Oracle manipulation | Reflector SEP-40 feed with a one-hour staleness check; a second source (RedStone) with a divergence guard is planned |
| Mass liquidation (BTC crash) | Conservative 150% collateral ratio, liquidation below 120%; a designated keeper liquidates, and liquidation opens to anyone if the keeper goes stale |

The full analysis is in the [Security Model](https://docs.writz.xyz/security/security-model) and the [STRIDE threat model](https://docs.writz.xyz/security/stride-threat-model).

### Audit roadmap

| Scope | Timing |
|---|---|
| Soroban contracts (`bitcoin-spv`, `writz-lend`) | Before mainnet |
| Bitcoin P2WSH scripting | Internal, ongoing; external review before mainnet |

Mainnet launch is gated on zero open critical/high findings from the external contract audit. Status is tracked in [Audits](https://docs.writz.xyz/security/audits).

### Reporting a vulnerability

Open a private [GitHub Security Advisory](https://github.com/WritzProtocol/writz/security/advisories/new). Full policy, response targets and safe harbour are in [`SECURITY.md`](SECURITY.md); rewards and severity bands in the [Bug Bounty](https://docs.writz.xyz/security/bug-bounty).

---

## Build on Writz

The **Bitcoin SPV SDK** is open infrastructure. Any Stellar protocol that needs to verify a Bitcoin transaction on-chain can use `bitcoin-spv` with one call, through [`writz-spv-client`](https://crates.io/crates/writz-spv-client) (Rust, from a Soroban contract) or [`@writz/sdk`](https://www.npmjs.com/package/@writz/sdk) (TypeScript, from an app). Verification is free today; no per-call fee exists.

```rust
verify_transaction(
    block_hash: BytesN<32>,
    merkle_proof: Vec<BytesN<32>>,
    tx_index: u32,
    raw_tx: Bytes,
    min_confirmations: u32,
) -> Result<SpvVerificationResult, SPVError>
```

- [Build on Writz](https://docs.writz.xyz/developers/integrate): prove a Bitcoin transaction from your contract or app, on testnet.
- [SPV SDK](https://docs.writz.xyz/developers/spv-sdk): the verification primitive and its guarantees.
- [For AI Agents](https://docs.writz.xyz/developers/for-ai-agents): exact IDs, signatures and verified examples for coding agents (also summarised in [`AGENTS.md`](AGENTS.md)).
- [Request for Startups](https://docs.writz.xyz/developers/request-for-startups): products we would like to see built on top of Writz.
- Runnable code in [`examples/`](examples/).

---

## Products and business model

| Product | Description | Status |
|---|---|---|
| **Writz Lend** | Deposit BTC as collateral → borrow USDC. Lend USDC to the pool → earn the interest borrowers pay | Testnet. Mainnet planned for Q2 to Q3 2027 |

Writz Lend is the only product. Possible future directions are listed in [Vision](https://docs.writz.xyz/roadmap/vision#planned-for-later) and are not products.

| Revenue stream | Mechanism |
|---|---|
| **Lending spread** | Borrow rate minus supply rate on Writz Lend |
| **SPV API fees** (later, not live) | Possible per-verification or subscription pricing for third-party integrations; verification is free today |
| **Protocol reserve** | A share of borrower interest kept on chain; today it funds liquidation bonuses |

---

## Developing in this repository

### Repository structure

```
writz/
├── contracts/               # Writz v1 Soroban contracts (Rust)
│   ├── contracts/
│   │   ├── bitcoin-spv/     # SHA256d, PoW, Merkle inclusion, block headers
│   │   ├── writz-lend/      # Deposits, USDC pool, interest model, liquidation
│   │   ├── spv-types/       # Types shared by bitcoin-spv and its consumers
│   │   └── writz-spv-client/ # Rust client crate for bitcoin-spv
│   └── deployments/
│       └── testnet.md       # Live addresses, tx hashes, verified calls
│
├── relayer/                 # SPV Relayer service (TypeScript, Express, Bun)
│   └── src/
│       ├── routes/proof.ts  # GET /spv-proof/:txid
│       ├── routes/deposit-status.ts  # GET /deposit-status/:txid
│       ├── routes/timeline.ts  # GET /timeline/:btcTxid
│       ├── routes/cctp.ts  # POST /cctp/relay, GET /cctp/relay/:burnHash
│       ├── routes/faucet.ts  # Signet faucet for social sign-in accounts (testnet)
│       └── bitcoin/         # Esplora client, header fetching, proof assembly
│
├── bitcoin-script/          # Bitcoin locking script toolkit (TypeScript)
│   └── src/
│       ├── script.ts        # P2WSH builder
│       ├── address.ts       # Address derivation (testnet / mainnet)
│       ├── spend.ts         # Path A/B PSBT signing
│       └── keys.ts          # Key management
│
├── frontend/
│   ├── app/src/             # Next.js testnet app (React 19, TypeScript)
│   │   ├── components/      # borrow, loan, lend, earn, reclaim
│   │   ├── lib/flows/       # deposit, borrow, repay, release, lend
│   │   └── lib/receive/     # Soroswap swap, Circle CCTP burn and relay status
│   └── landing/             # writz.xyz
│
├── packages/
│   ├── sdk/                 # @writz/sdk, TypeScript client with the testnet preset
│   ├── writz-lend/          # Generated TypeScript bindings for writz-lend
│   └── brand/               # Graphite & Gold design tokens
│
├── examples/                # Runnable integration examples
├── scripts/
│   └── deploy/              # Deployment scripts: deploy_stack.mjs, e2e_local.mjs
│
└── docs/                    # Documentation source, published at docs.writz.xyz (Mintlify)
```

### Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Smart contracts | Soroban, Rust | Protocol 26, `soroban-sdk = "26"` |
| Bitcoin scripting | P2WSH, absolute CLTV timelock | `bitcoinjs-lib`, `ecpair` |
| Bitcoin wallets | Xverse (sats-connect), Signet test key in the browser on testnet | PSBT standard |
| Frontend | Next.js 16, React 19, TypeScript | App Router, Tailwind CSS 4 |
| Stellar wallets | Stellar Wallets Kit, Pollar | Varial, Lobstr, email and social login on testnet |
| Relayer runtime | Bun, Express.js | Alpine Docker, Esplora-backed |
| CI | GitHub Actions | Per-module jobs plus docs sync, all must pass |

### Prerequisites

```bash
# Rust with Soroban WASM target
rustup target add wasm32v1-none
cargo install stellar-cli --locked --version 27  # or later

# Node.js / Bun (for relayer, bitcoin-script, frontend)
node --version  # >= 20
bun --version   # >= 1.1
```

### Run all tests

Each module has its own toolchain. There is no unifying root build, and the
package manager is **not** the same everywhere. Run them from the repo root:

```bash
# 1. Soroban contracts: bitcoin-spv, writz-lend and spv-types
cd contracts && cargo test
cd ..

# 2. Bitcoin script toolkit (Bun's own test runner)
cd bitcoin-script && bun install && bun test

# 3. Relayer service
#    Deps install with Bun, but the suite itself is Jest (ts-jest), so it must
#    be run through the package script - plain `bun test` picks Bun's runner
#    instead and fails. The relayer also imports the local @writz/* packages
#    via their built dist/ output, so build those first.
cd ../bitcoin-script && bun run build
cd ../packages/writz-lend && bun install
cd ../../relayer && bun install && bun run test
```

| Module | Language | How to run |
|---|---|---|
| `bitcoin-spv` contract | Rust | `cd contracts && cargo test -p bitcoin-spv` |
| `writz-lend` contract | Rust | `cd contracts && cargo test -p writz-lend` |
| `spv-types` | Rust | `cd contracts && cargo test -p spv-types` |
| Relayer service | TypeScript | `cd relayer && bun run test` |
| Bitcoin script toolkit | TypeScript | `cd bitcoin-script && bun test` |

CI runs every suite on each pull request. If anything fails locally, [open an issue](https://github.com/WritzProtocol/writz/issues).

### Frontend dev server

```bash
cd frontend/app
cp .env.example .env.local
# Fill in NEXT_PUBLIC_* contract addresses from contracts/deployments/testnet.md
# Set NEXT_PUBLIC_RELAYER_URL=https://api.testnet.writz.xyz
bun install && bun dev
# → http://localhost:3000
```

The testnet app is live at **[testnet.writz.xyz](https://testnet.writz.xyz)**. Deploying the full stack, operating the relayer and recovering its state are covered in the [Quick Start](https://docs.writz.xyz/developers/quick-start), the [Runbook](https://docs.writz.xyz/developers/runbook) and [Relayer Recovery](https://docs.writz.xyz/developers/relayer-recovery).

### Architecture diagrams

The diagrams are drawn as HTML and SVG in `docs/diagrams/source/`; each `build_*.py` writes a light and a dark variant, and the SVGs in `docs/diagrams/` are exported from them.

---

## Documentation

Everything is published at **[docs.writz.xyz](https://docs.writz.xyz)**.

| Section | Pages |
|---|---|
| **Start here** | [Technical architecture](https://docs.writz.xyz/architecture/technical-overview) · [What is Writz?](https://docs.writz.xyz/introduction/what-is-writz) · [The Problem](https://docs.writz.xyz/introduction/the-problem) · [How Writz Works](https://docs.writz.xyz/introduction/how-writz-works) · [Why Stellar, Why Now](https://docs.writz.xyz/introduction/why-stellar-why-now) |
| **Use the app** | [Start here](https://docs.writz.xyz/guides/start-here) · [Get test funds](https://docs.writz.xyz/guides/get-test-funds) · [Borrow](https://docs.writz.xyz/guides/borrow) · [Repay and release](https://docs.writz.xyz/guides/repay-and-release) · [Lend](https://docs.writz.xyz/guides/lend) · [Troubleshooting](https://docs.writz.xyz/guides/troubleshooting) |
| **Product** | [Writz Lend](https://docs.writz.xyz/products/writz-lend) |
| **How it works** | [Bitcoin Side](https://docs.writz.xyz/how-it-works/bitcoin-side) · [SPV Verification](https://docs.writz.xyz/how-it-works/spv-verification) · [Stellar Side](https://docs.writz.xyz/how-it-works/stellar-side) · [Manual proof submission](https://docs.writz.xyz/how-it-works/manual-proof-submission) · [Manual emergency recovery](https://docs.writz.xyz/how-it-works/manual-emergency-recovery) |
| **Developers** | [Build on Writz](https://docs.writz.xyz/developers/integrate) · [For AI Agents](https://docs.writz.xyz/developers/for-ai-agents) · [SPV SDK](https://docs.writz.xyz/developers/spv-sdk) · [Quick Start](https://docs.writz.xyz/developers/quick-start) · [Contract Reference](https://docs.writz.xyz/developers/contract-reference) · [Contribution Guide](https://docs.writz.xyz/developers/contribution-guide) |
| **Security** | [Security Model](https://docs.writz.xyz/security/security-model) · [SPV vs Wrapped Bitcoin](https://docs.writz.xyz/security/spv-vs-wrapped) · [Audits](https://docs.writz.xyz/security/audits) · [Bug Bounty](https://docs.writz.xyz/security/bug-bounty) · [STRIDE threat model](https://docs.writz.xyz/security/stride-threat-model) |
| **Vision** | [Vision](https://docs.writz.xyz/roadmap/vision) |

---

## Get involved

| You are | Start here |
|---|---|
| **BTC holder** who wants to borrow USDC against BTC | [Borrow guide →](https://docs.writz.xyz/guides/borrow) |
| **USDC holder** who wants to supply the lending pool | [Lend guide →](https://docs.writz.xyz/guides/lend) |
| **Developer** who wants to build on the protocol | [Build on Writz →](https://docs.writz.xyz/developers/integrate) |
| **Stellar protocol** that needs Bitcoin verification | [SPV SDK →](https://docs.writz.xyz/developers/spv-sdk) |
| **Security researcher** | [Bug Bounty →](https://docs.writz.xyz/security/bug-bounty) |
| **Contributor** | [Contribution Guide →](https://docs.writz.xyz/developers/contribution-guide) |

Questions and feedback: [Discord](https://discord.gg/zDa4xRN9Xe) and [X](https://x.com/WritzProtocol).

## Contributing

1. Fork the repo and create a branch from `main`.
2. Run the test suites of the modules you touched before opening a PR; CI must pass.
3. For new features, add tests. For bug fixes, add a regression test.
4. Open a PR with a clear description of what changed and why.

Detailed guidelines are in the [Contribution Guide](https://docs.writz.xyz/developers/contribution-guide).

## License

Apache License 2.0, see [`LICENSE`](LICENSE).
