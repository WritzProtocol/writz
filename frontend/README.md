# Writz frontend

Next.js (App Router, React, TypeScript) web app for the Writz protocol. This is
the scaffold from issue #4: it talks to the Soroban testnet contracts and reads
live on-chain state. Wallets, ZK proving, and the deposit/borrow/repay flows are
added in subsequent issues.

## Prerequisites

- **Bun** (package manager + scripts) and **Node.js 24**, both pinned in
  `.tool-versions` (selected automatically with asdf — otherwise install Bun and
  Node 24). Bun installs dependencies and runs the scripts; Node is the runtime
  Next.js executes under.

## Setup

```bash
cp .env.example .env.local   # public testnet config; adjust if needed
bun install                  # also links the generated contract bindings
```

## Develop / build

```bash
bun run dev      # http://localhost:3000
bun run build    # production build
bun run start    # serve the production build
bun run lint     # eslint
```

The home page reads `get_merkle_root` and `get_pool_state` from the
`commitment-tree` contract on testnet, which verifies the app is correctly wired
to Soroban.

## Configuration

All contract addresses and endpoints come from `NEXT_PUBLIC_*` environment
variables, centralized in `src/config.ts`. Nothing is hardcoded in components.
See `.env.example` for the full list. Defaults target Soroban testnet
(addresses from `../contracts/deployments/testnet.md`).

## Contract bindings

Typed contract clients are generated with the Stellar CLI and vendored under
`packages/`:

```bash
stellar contract bindings typescript \
  --contract-id <CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --output-dir packages/<name> --overwrite
```

The app consumes them as `file:` dependencies (e.g. `commitment-tree`). Next
transpiles each binding from TypeScript source (`transpilePackages` in
`next.config.ts`, with the package `exports` pointing at `src/index.ts`), so no
build step or committed `dist/` is needed. App helpers that wrap a binding live
in `src/lib/contracts/`.

## Structure

```
src/
  app/                 # App Router pages + layout
  config.ts            # environment-driven configuration
  lib/contracts/       # typed wrappers over the generated bindings
packages/
  commitment-tree/     # generated TypeScript bindings (vendored)
```
