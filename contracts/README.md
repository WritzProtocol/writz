# Writz Protocol — Soroban Contracts

Four Soroban contracts that implement the Writz Protocol on Stellar.

## Contracts

### `bitcoin-spv`

Verifies Bitcoin SPV proofs on Soroban. Given a raw Bitcoin transaction, a block header, and a Merkle inclusion proof, it confirms the transaction is included in a Bitcoin block with a minimum number of confirmations.

Key functions: `verify_transaction(headers, merkle_proof, tx_index, raw_tx, min_confirmations)`

### `zk-verifier`

Stores Groth16 BN254 verification keys for the three Writz circuits (Deposit, BorrowRepay, Liquidation) and verifies proofs using Protocol 26 host functions (`bn254.g1_msm`, `bn254.pairing_check`).

Key functions: `initialize`, `set_verification_key`, `verify_deposit`, `verify_borrow_repay`, `verify_liquidation`

### `commitment-tree`

Implements the Poseidon Merkle commitment tree and the core lending logic. Accepts ZK proofs for deposits, borrows, repays, and liquidations. Calls `bitcoin-spv` and `zk-verifier` as dependencies.

Key functions: `deposit`, `insert_commitment`, `borrow`, `repay`, `liquidate`

### `private-lend`

Orchestration contract. Entry point for the PrivateLend product. Composes `commitment-tree` with pool supply management.

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
