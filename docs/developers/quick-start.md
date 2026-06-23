# Quick Start

Everything in this repository is working code. There are no placeholders, no "coming soon" sections, no hand-waving. The contracts are deployed on Soroban testnet. The tests pass. Start here and have something running in under 5 minutes.

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

# circom (for ZK circuit tests only)
npm install -g circom
npm install -g snarkjs
```

---

## Clone the Repository

```bash
git clone https://github.com/writz-protocol/writz.git
cd writz
```

---

## Run All Tests

### Soroban contracts (Rust)

```bash
cd contracts
cargo test
```

Expected output: 146 tests pass across `bitcoin-spv`, `zk-verifier`, `commitment-tree`, and `private-lend`.

### Relayer service (TypeScript)

```bash
cd relayer
npm install
npm test
```

Expected output: 35 tests pass.

### Bitcoin script toolkit (TypeScript)

```bash
cd bitcoin-script
npm install
npm test
```

Expected output: 48 tests pass.

### ZK circuits (Circom + snarkjs)

```bash
cd circuits
npm install
npm test
```

Expected output: 45 tests pass (proof generation, commitment correctness, ratio enforcement, nullifiers).

### All together: 268 tests, all passing.

---

## Build the Contracts

```bash
cd contracts
stellar contract build
```

This produces Wasm artifacts in `contracts/target/wasm32v1-none/release/`:
- `bitcoin_spv.wasm` — 28.4 KB
- `zk_verifier.wasm` — 11.8 KB
- `commitment_tree.wasm` — ~38 KB
- `private_lend.wasm` — 23.7 KB

---

## Use the Testnet Deployments

All four contracts are live on Soroban testnet. You can call them directly without deploying:

```bash
# Check the SPV contract is alive
stellar contract invoke \
  --id CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ \
  --network testnet \
  -- get_version

# Check the Merkle root
stellar contract invoke \
  --id CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7 \
  --network testnet \
  -- get_merkle_root
# Returns: 0x2134e76ac74b4b8765b6e37992aa15f0... (Poseidon-2 empty tree root)
```

---

## Run the Full ZK End-to-End Flow

This script runs the complete deposit → borrow → repay cycle on Soroban testnet using the deployed contracts. It generates real ZK proofs and submits them on-chain.

```bash
# You need a Stellar testnet key with XLM and USDC
# Get testnet XLM: https://laboratory.stellar.org/#account-creator?network=test

WRITZ_DEV_SECRET=<your-testnet-secret-key> node scripts/deploy/e2e_zkflow.js
```

This script:
1. Initializes the commitment-tree contract with a USDC pool
2. Supplies 1,000 USDC to the pool
3. Generates a Groth16 deposit proof (circom WASM)
4. Submits the SPV proof + ZK proof → commitment created on-chain
5. Inserts the commitment into the Merkle tree (Poseidon root updated)
6. Generates a Groth16 borrow proof (150% collateral ratio enforced)
7. Submits the borrow → 200 XLM transferred from pool
8. Generates a Groth16 repay proof (field-negation amount recovery)
9. Submits the repay → debt cleared

All 6 transactions land on testnet. You can verify them on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

---

## Run the Bitcoin P2WSH End-to-End

This script tests the Bitcoin locking and release flow on Bitcoin testnet3. No funds required for a dry run.

```bash
cd bitcoin-script
npm run build

# Dry run — builds and inspects the P2WSH transaction without broadcasting
node scripts/e2e_testnet.mjs --dry-run

# Live broadcast (requires testnet BTC — get from a testnet faucet)
node scripts/e2e_testnet.mjs
```

The live broadcast will:
1. Generate a unique P2WSH address
2. Send testnet BTC to the address
3. Build the Path A co-signed release transaction
4. Sign with both user and protocol keys (PSBT round-trip)
5. Broadcast to Bitcoin testnet3

Reference transactions (already executed):
- Funding: [`39836e7c`](https://blockstream.info/testnet/tx/39836e7c83e4b17313406e649ca3ec9d6e6ab64256321318864837ba2df4c80c)
- Release: [`b594441f`](https://blockstream.info/testnet/tx/b594441f89e2437b1e14c4a7e5c1797139cd76461a3d7594eda379eaa672ec28)

---

## Deploy Your Own Contracts

If you want to deploy fresh contract instances to testnet:

```bash
cd contracts

# Build
stellar contract build

# Deploy bitcoin-spv
stellar contract deploy \
  --wasm target/wasm32v1-none/release/bitcoin_spv.wasm \
  --source <your-account> \
  --network testnet

# Deploy zk-verifier
stellar contract deploy \
  --wasm target/wasm32v1-none/release/zk_verifier.wasm \
  --source <your-account> \
  --network testnet

# Initialize the zk-verifier with verification keys
node scripts/deploy/set_vkeys.js \
  --verifier <zk-verifier-contract-id> \
  --network testnet \
  --secret <your-secret>

# Deploy commitment-tree
stellar contract deploy \
  --wasm target/wasm32v1-none/release/commitment_tree.wasm \
  --source <your-account> \
  --network testnet
```

See [`contracts/deployments/testnet.md`](../../contracts/deployments/testnet.md) for the full init sequence and verified transaction hashes.

---

## Repository Layout for Developers

```
contracts/
  contracts/
    bitcoin-spv/src/
      lib.rs        — public contract interface
      header.rs     — Bitcoin block header parsing + PoW verification
      merkle.rs     — Merkle proof verification
      crypto.rs     — SHA256d implementation in Soroban Wasm
      types.rs      — BitcoinBlockHeader, VerificationResult
    zk-verifier/src/
      lib.rs        — verify_groth16(), set_vkey()
    commitment-tree/src/
      lib.rs        — deposit(), borrow(), repay(), liquidate()
      oracle.rs     — SEP-40 oracle interface
    private-lend/src/
      lib.rs        — non-ZK lending skeleton
      rates.rs      — kinked interest rate model

circuits/
  src/
    deposit.circom      — Deposit ZK circuit
    borrow_repay.circom — Borrow/Repay ZK circuit
    liquidation.circom  — Liquidation ZK circuit
    merkle.circom       — Shared Poseidon Merkle components
  keys/
    deposit.vkey.json       — Deposit verification key
    borrow_repay.vkey.json  — Borrow/Repay verification key
    liquidation.vkey.json   — Liquidation verification key

relayer/src/
  index.ts      — Express API: GET /spv-proof/:txid
  spv.ts        — SPV proof assembly (Esplora + Merkle computation)
  bitcoin.ts    — Bitcoin types and parsing

bitcoin-script/src/
  script.ts     — P2WSH redeem script builder
  address.ts    — Deposit address derivation
  spend.ts      — Path A/B PSBT signing
  keys.ts       — Key management utilities
```

---

**Next:** [Bitcoin SPV SDK →](spv-sdk.md)
