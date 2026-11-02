# Writz Protocol - Soroban Contracts

The Writz v1 Soroban contracts: `bitcoin-spv`, `writz-lend` and the shared `spv-types` crate.

## Contracts

### `bitcoin-spv`

Verifies Bitcoin SPV proofs on Soroban. Given a raw Bitcoin transaction, a block header, and a Merkle inclusion proof, it confirms the transaction is included in a Bitcoin block with a minimum number of confirmations.

Key functions: `verify_transaction(headers, merkle_proof, tx_index, raw_tx, min_confirmations)`

### `writz-lend`

Lending contract: plaintext BTC-collateralized positions, USDC pool supply/withdraw, and its own liquidation logic. Calls `bitcoin-spv` directly to verify deposits.

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
