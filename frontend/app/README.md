# Writz app

The Writz dApp: Borrow against native BTC, Lend to the pool, Earn through the
DeFindex vault, and the public `/metrics` dashboard. Next.js (App Router, React,
TypeScript). The same code is deployed once per network, selected by
`NEXT_PUBLIC_WRITZ_ENV`:

- `testnet`, served at testnet.writz.xyz.
- `mainnet`, reserved for app.writz.xyz, not deployed yet.

The marketing site lives in `../landing`. See
`../../docs/developers/deploy-targets.md` for how each deployment is provisioned.

## Prerequisites

- **Bun** (package manager + scripts) and **Node.js 24**, both pinned in
  `.tool-versions` (selected automatically with asdf - otherwise install Bun and
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
See `.env.example` for the full list. Defaults target Stellar testnet
(addresses from `../../contracts/deployments/testnet.md`).

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

## UI mock harness (dev only)

`src/lib/mock` holds fixtures for every screen state the app renders
(wallets, positions, chain reads, relayer index, Earn, Lend, Protocol).
It is off unless the build sets `NEXT_PUBLIC_UI_MOCK=1`, never runs on a
`mainnet` target, and needs a known scenario in the URL:

```bash
NEXT_PUBLIC_UI_MOCK=1 bun run dev   # then open e.g. /?scenario=H11
```

Scenario IDs: `G1`-`G7`, `H1`-`H21`, `B1`-`B37`, `L1`-`L25`, `E1`-`E11`,
`N1`-`N19`, `P1`-`P5`, `R1`-`R4`, `tx.<lifecycle>` and `status.<kind>`; the
list lives in `src/lib/mock/scenarios.ts`. With a scenario selected,
`StatusProvider` (`src/lib/status`) answers from its fixtures instead of the
network.

## Structure

```
src/
  app/                 # App Router pages + layout
  config.ts            # environment-driven configuration
  lib/contracts/       # typed wrappers over the generated bindings
packages/
  commitment-tree/     # generated TypeScript bindings (vendored)
```
