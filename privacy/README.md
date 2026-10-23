# Writz privacy edition (in progress)

> **Status: in progress, testnet only, not part of Writz v1.** Writz v1 is `bitcoin-spv` and `writz-lend` in [`../contracts/`](../contracts/), with plaintext positions. Nothing in this directory is part of v1 or of its mainnet plan.

The privacy edition is a separate, opt-in way to borrow against Bitcoin with zero-knowledge proofs, so the lending contract can check a position without learning its amounts. It is planned for after v1, on its own subdomain, and has no date. Users who do not want privacy never touch it, and `writz-lend` never calls these contracts.

It has its own contracts, its own lending pool, and its own security work. Before any mainnet use it needs a dedicated external audit and a multi-party trusted-setup ceremony for its circuits; the keys committed here are single-contributor development keys.

Design and current state: [Privacy edition](https://docs.writz.xyz/how-it-works/privacy-edition) in the docs.

## Layout

```
privacy/
├── contracts/               # Its own Cargo workspace, separate from ../contracts
│   ├── zk-verifier/         # Groth16 BN254 verification key store and verifier
│   └── commitment-tree/     # Poseidon Merkle tree and the ZK lending pool
├── circuits/                # Circom 2.2.3 circuits, dev keys, ceremony scripts (npm)
└── packages/
    └── commitment-tree/     # Generated TypeScript bindings for commitment-tree
```

`commitment-tree` uses the v1 `spv-types` crate through a path dependency on `../contracts/contracts/spv-types`, and calls the deployed `bitcoin-spv` for deposit verification.

## Build and test

```bash
(cd privacy/contracts && cargo test --workspace)
(cd privacy/contracts && cargo build --release --target wasm32v1-none --locked)
(cd privacy/circuits && npm ci && npm run compile && npm run setup:dev && npm test)
```

The circuits need `circom` 2.2.3 on `PATH`; see the root README. `scripts/deploy/deploy_stack.mjs` deploys the whole testnet stack, these contracts included; `--v1-only` leaves them out.

## What still depends on it

Until the app's Lend tab and home supply balance move to `writz-lend`, they read the testnet `commitment-tree` pool. The relayer keeps the commitment tree for those testnet contracts: it watches tree events, proves Merkle insertions with the `insert` circuit (its own copy of the artifacts in `relayer/circuits/`) and imports `privacy/packages/commitment-tree`.
