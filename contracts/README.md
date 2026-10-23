# Writz Protocol - Soroban Contracts

The Writz v1 Soroban contracts: `bitcoin-spv`, `writz-lend` and the shared `spv-types` crate.

The privacy edition's contracts (`zk-verifier`, `commitment-tree`) are not part of v1. They live in their own Cargo workspace under [`../privacy/contracts/`](../privacy/contracts/), so this workspace builds, tests and deploys without them. See [`../privacy/README.md`](../privacy/README.md).

## Contracts

### `bitcoin-spv`

Verifies Bitcoin SPV proofs on Soroban. Given a raw Bitcoin transaction, a block header, and a Merkle inclusion proof, it confirms the transaction is included in a Bitcoin block with a minimum number of confirmations.

Key functions: `verify_transaction(headers, merkle_proof, tx_index, raw_tx, min_confirmations)`

### `writz-lend`

Phase 1, non-ZK lending contract: plaintext BTC-collateralized positions, USDC pool supply/withdraw, and its own liquidation logic. Calls `bitcoin-spv` directly to verify deposits.

> **Note:** `writz-lend` does **not** call or compose the privacy edition's `commitment-tree` or `zk-verifier`. Both lenders register with `bitcoin-spv`'s consumed-txid registry, so one Bitcoin deposit cannot back a position in each; see `docs/security/security-model.md`.

### `spv-types`

Types and helpers shared by `bitcoin-spv` and the lending contracts that call it: `SpvVerificationResult`, the P2WSH deposit script and its parser, and the Bitcoin key-ownership proof. A library crate, not a deployed contract.

## Build

```bash
stellar contract build
```

Output WASM files go to `target/wasm32v1-none/release/`.

## Test

```bash
cargo test
```

## Deploy (testnet)

See [`deployments/testnet.md`](deployments/testnet.md) for live testnet addresses and the full deploy log.

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/bitcoin_spv.wasm \
  --source <your-key-alias> \
  --network testnet
```
