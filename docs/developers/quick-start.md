---
title: "Quick Start"
---

> **Building on Writz from your own project?** This page is the contributor guide: it builds and tests this repository. To call the deployed contracts from your app or your Soroban contract, start with [Build on Writz](/developers/integrate). AI coding agents: [For AI Agents](/developers/for-ai-agents).

Writz v1 is two Soroban contracts, `bitcoin-spv` and `writz-lend`, both deployed on Stellar testnet. `writz-lend` reads the BTC price from the Reflector oracle on testnet (`get_btc_price_stroops` in `writz-lend/src/oracle.rs`, see [The Stellar Side](/how-it-works/stellar-side#oracle-design)). This page gets the test suites running in a few minutes; the [Testnet Runbook](/developers/runbook) runs the protocol itself.

---

## Prerequisites

Install the following before proceeding:

```bash
# Rust + WebAssembly target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# Stellar CLI (CI uses 28.1.0)
# macOS
brew install stellar-cli
# Linux
cargo install --locked stellar-cli

# Node.js 22 (CI version)
# https://nodejs.org/

# Bun (CI uses 1.3.14). bitcoin-script, relayer, frontend and packages/* install with Bun.
curl -fsSL https://bun.sh/install | bash
```

---

## Clone the Repository

```bash
git clone https://github.com/WritzProtocol/writz.git
cd writz
```

---

## Run All Tests

### Soroban contracts (Rust)

```bash
cd contracts
cargo test
```

Expected output: 255 tests pass across `bitcoin-spv` (80), `writz-lend` (165), and `spv-types` (10).

### Bitcoin script toolkit (TypeScript, Bun)

```bash
cd bitcoin-script
bun install
bun test
```

Expected output: 72 tests pass.

### Relayer service (TypeScript, Bun install + Jest)

The relayer installs with Bun but its suite is Jest (ts-jest), so it must run
through the package script: plain `bun test` selects Bun's own runner and
fails. It also imports the local `@writz/*` packages, so install and build
those first.

```bash
cd bitcoin-script && bun run build
cd ../packages/writz-lend && bun install
cd ../../relayer && bun install && bun run test
```

Expected output: 512 tests pass.

### All together: 839 tests, all passing.

---

## Build the Contracts

```bash
cd contracts
stellar contract build
```

This produces `bitcoin_spv.wasm` and `writz_lend.wasm` in `contracts/target/wasm32v1-none/release/`. The deployed builds are 45,230 and 94,648 bytes; their sha256 hashes are in [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md).

---

## Use the Testnet Deployments

Both contracts are live on Stellar testnet. You can call them directly without deploying. Reads are simulated, so the source account can be any valid address and is not charged:

```bash
# Read the light client's Bitcoin tip
stellar contract invoke \
  --id CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO \
  --network testnet \
  --source-account GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT \
  --send=no \
  -- get_best_tip
```

---

## Run the Bitcoin P2WSH End-to-End

This script tests the Bitcoin locking and release flow on Bitcoin Signet. No funds required for a dry run.

```bash
cd bitcoin-script
bun install && bun run build

# Dry run: builds and inspects the P2WSH transaction without broadcasting
bun run e2e:dryrun

# Live broadcast (requires Signet BTC from a Signet faucet)
bun run e2e:testnet
```

The live broadcast will:
1. Generate a unique P2WSH address
2. Send Signet BTC to the address
3. Build the Path A co-signed release transaction
4. Sign with both user and protocol keys (PSBT round-trip)
5. Broadcast to Bitcoin Signet

Reference transactions (already executed on Bitcoin Signet):
- Funding: [`61deea44`](https://blockstream.info/signet/tx/61deea4439ecd6c325c5b23ecf4b27694ce3cb0474adbbcc6221968ecbd583a4)
- Release: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098)

---

## Deploy Your Own Contracts

`scripts/deploy/deploy_stack.mjs` deploys and wires up both contracts in
the order they depend on each other. Without `--execute` it only validates its
inputs and prints the plan. Set `STELLAR_NETWORK=local` to rehearse against a
local Stellar network (`stellar/quickstart --local`). The inputs are listed in
`scripts/deploy/.env.example`.

```bash
(cd contracts && cargo build --release --target wasm32v1-none --locked)
cd scripts/deploy
node deploy_stack.mjs             # validate and print the plan
node deploy_stack.mjs --execute   # deploy
```

Do not deploy to the shared testnet or to mainnet without the project owner's
sign-off.

---

## Repository Layout for Developers

```
contracts/
  contracts/
    bitcoin-spv/src/
      lib.rs        - public contract interface
      header.rs     - Bitcoin block header parsing + PoW verification
      merkle.rs     - Merkle proof verification
      crypto.rs     - SHA256d implementation in Soroban Wasm
      types.rs      - Config, Checkpoint, BestTip, HeaderEntry
    spv-types/src/  - shared types, the on-chain transaction parser, the deposit key proof
    writz-lend/src/
      lib.rs        - lending contract
      oracle.rs     - Reflector BTC price read
      rates.rs      - kinked interest rate model
    writz-spv-client/src/ - the published Soroban client for bitcoin-spv

relayer/src/
  index.ts          - Express API
  routes/proof.ts   - GET /spv-proof/:txid
  bitcoin/spv.ts    - SPV proof assembly (Esplora + Merkle computation)
  bitcoin/spv-submit.ts - header sync into bitcoin-spv
  repay-watcher/    - co-signed releases after full repayment

bitcoin-script/src/
  script.ts     - P2WSH redeem script builder
  address.ts    - Deposit address derivation
  spend.ts      - Path A/B PSBT signing
  keys.ts       - Key management utilities

packages/sdk/   - @writz/sdk, the published TypeScript SDK
```

---

**Next:** [Bitcoin SPV SDK →](/developers/spv-sdk)
