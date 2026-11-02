---
title: "Quick Start"
---

> **Building on Writz from your own project?** This page is the contributor guide: it builds and tests this repository. To call the deployed contracts from your app or your Soroban contract, start with [Build on Writz](/developers/integrate). AI coding agents: [For AI Agents](/developers/for-ai-agents).

The core lending and verification logic in this repository is working code, not a mockup: the contracts are deployed on Stellar testnet, and the tests pass (see `docs/developers/runbook.md`). Writz v1 is `bitcoin-spv` and `writz-lend`. `writz-lend/src/oracle.rs`'s `get_btc_price_stroops` now calls a real Reflector oracle on testnet (see `docs/research/oracle-design.md`). Start here and have something running in under 5 minutes.

---

## Prerequisites

Install the following before proceeding:

```bash
# Rust + WebAssembly target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# Stellar CLI (version 27 or later)
# macOS
brew install stellar-cli
# Linux
cargo install --locked stellar-cli

# Node.js 20+
# https://nodejs.org/

# Bun 1.1+ - bitcoin-script, relayer, frontend and packages/* install with Bun.
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

Expected output: 253 tests pass across `bitcoin-spv` (80), `writz-lend` (163), and `spv-types` (10).

### Bitcoin script toolkit (TypeScript, Bun)

```bash
cd bitcoin-script
bun install
bun test
```

Expected output: 72 tests pass.

### Relayer service (TypeScript, Bun install + Jest)

The relayer installs with Bun but its suite is Jest (ts-jest), so it must run
through the package script - plain `bun test` selects Bun's own runner and
fails. It also imports the local `@writz/*` packages via their built `dist/`
output, so build those first.

```bash
cd bitcoin-script && bun run build
cd ../packages/writz-lend && bun install
cd ../../relayer && bun install && bun run test
```

Expected output: 523 tests pass.

### All together: 848 tests, all passing.

---

## Build the Contracts

```bash
cd contracts
stellar contract build
```

This produces Wasm artifacts in `contracts/target/wasm32v1-none/release/`:
- `bitcoin_spv.wasm` - 28.4 KB
- `writz_lend.wasm` - 23.7 KB

---

## Use the Testnet Deployments

Both contracts are live on Stellar testnet. You can call them directly without deploying:

```bash
# Check the SPV contract is alive
stellar contract invoke \
  --id CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO \
  --network testnet \
  -- get_version

```

---

## Run the Bitcoin P2WSH End-to-End

This script tests the Bitcoin locking and release flow on Bitcoin Signet. No funds required for a dry run.

```bash
cd bitcoin-script
npm run build

# Dry run - builds and inspects the P2WSH transaction without broadcasting
node scripts/e2e_testnet.mjs --dry-run

# Live broadcast (requires Signet BTC - get from a Signet faucet)
node scripts/e2e_testnet.mjs
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
inputs and prints the plan. Set `STELLAR_NETWORK=local` to rehearse against the
local network above. The inputs are listed in `scripts/deploy/.env.example`.

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
      types.rs      - Config, Checkpoint (SpvVerificationResult now lives in the shared `spv-types` crate)
    writz-lend/src/
      lib.rs        - lending contract
      rates.rs      - kinked interest rate model


relayer/src/
  index.ts      - Express API: GET /spv-proof/:txid
  spv.ts        - SPV proof assembly (Esplora + Merkle computation)
  bitcoin.ts    - Bitcoin types and parsing

bitcoin-script/src/
  script.ts     - P2WSH redeem script builder
  address.ts    - Deposit address derivation
  spend.ts      - Path A/B PSBT signing
  keys.ts       - Key management utilities
```

---

**Next:** [Bitcoin SPV SDK →](/developers/spv-sdk)
