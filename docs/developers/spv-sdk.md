# Bitcoin SPV SDK

**Verify Bitcoin transactions from any Stellar smart contract — for free.**

Writz is not just a lending protocol. It is Bitcoin verification infrastructure for the Stellar ecosystem. The Bitcoin SPV SDK is a free, open-source library that lets any Soroban developer verify Bitcoin transactions on Stellar in a single function call.

If you are building anything on Stellar that needs to know whether a specific Bitcoin transaction happened — an exchange, a payment processor, a cross-chain bridge, a Bitcoin-collateral protocol — the Writz SPV SDK gives you that capability without building it yourself.

---

## Why Use the SDK Instead of Building Your Own?

Building a Bitcoin SPV verifier on Soroban from scratch requires:
- Implementing SHA256d (double-SHA256) in Soroban Wasm
- Implementing Bitcoin's Merkle tree verification
- Implementing Bitcoin block header parsing and PoW verification
- Handling edge cases: 80-byte header format, little-endian encoding, target computation
- Extensive testing against real Bitcoin transactions
- A security audit of the cryptographic implementation

The Writz SPV contract has done all of this. It has 28 passing tests, is deployed on Soroban testnet, and has been verified against real Bitcoin mainnet transactions. Use it instead.

---

## Integration: Cross-Contract Call

The simplest integration is a cross-contract call from your Soroban contract to the Writz `bitcoin-spv` contract.

### Calling the Deployed Contract

```rust
use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env, Vec};

#[contractclient(name = "BitcoinSpvClient")]
pub trait BitcoinSpv {
    fn verify_transaction(
        env: Env,
        headers: Vec<Bytes>,        // Raw 80-byte Bitcoin block headers
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> VerificationResult;
}

// In your contract:
let spv_client = BitcoinSpvClient::new(
    &env,
    &Address::from_str(&env, WRITZ_SPV_CONTRACT_ADDRESS),
);

let result = spv_client.verify_transaction(
    &env,
    &headers,
    &merkle_proof,
    &tx_index,
    &raw_tx,
    &6_u32,  // require 6 confirmations
);

// result.outputs contains the transaction outputs
// Check that the expected address received the expected amount
let deposit_output = result.outputs.iter().find(|o| o.address == expected_address);
match deposit_output {
    Some(output) => {
        let satoshis = output.value;
        // proceed with deposit logic
    }
    None => panic!("expected output not found"),
}
```

**Testnet contract address:** `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ`

### Return Type

```rust
pub struct VerificationResult {
    pub txid: BytesN<32>,
    pub block_hash: BytesN<32>,
    pub confirmations: u32,
    pub outputs: Vec<TxOutput>,
}

pub struct TxOutput {
    pub value: u64,       // satoshis
    pub address: String,  // Bitcoin address (P2PKH, P2SH, P2WPKH, P2WSH, P2TR)
}
```

---

## Integration: SPV Proof Bundle Assembly

Your contract needs the SPV proof data as input. Use the Writz Relayer API to assemble it:

### Writz Relayer API

```bash
GET https://relayer.writz.io/spv-proof/{txid}
```

**Response:**
```json
{
  "txid": "b594441f89e2437b1e14c4a7e5c1797139cd76461a3d7594eda379eaa672ec28",
  "block_hash": "00000000000000000003...",
  "confirmations": 12,
  "sorobanArgs": {
    "headers": ["0100000020...","0100000020...","..."],
    "merkleProof": ["a1b2c3...","d4e5f6...","..."],
    "txIndex": 42,
    "rawTx": "0200000001..."
  }
}
```

The `sorobanArgs` fields map directly to the `verify_transaction` parameters. Pass them through from your frontend to your contract call.

### Self-Hosted Proof Assembly

If you prefer not to rely on the Writz relayer, you can assemble proof bundles from any Bitcoin Esplora instance:

```typescript
import { buildSpvProof } from 'writz-sdk';  // npm package — coming Q4 2026

const proof = await buildSpvProof(
  txid,
  { esploraUrl: 'https://blockstream.info/api' },
  { minConfirmations: 6 }
);
```

The `writz-sdk` npm package (planned Q4 2026) will wrap this logic for easy integration.

---

## Pricing

**The Writz SPV SDK is free for all Stellar protocols.**

Writz charges a small fee per verification call in Phase 3 (after TVL and adoption milestones), but early integrators and protocols that contribute to the ecosystem will be whitelisted for free access.

If you are building on Stellar and want to integrate Bitcoin SPV, [reach out directly](mailto:team@writz.io) — we will work with you.

---

## Use Cases

**Bitcoin-collateralized lending:** Exactly what Writz does. Any protocol wanting to use BTC as collateral can use the SPV client to verify deposits without running a Bitcoin node.

**Cross-chain payment verification:** A merchant on Stellar can verify that a customer paid in BTC on Bitcoin mainnet before releasing a product or service.

**Bitcoin-gated access:** A Soroban contract can grant permissions (DAO governance votes, NFT mints, access tokens) to anyone who proves they burned BTC or made a specific Bitcoin payment.

**Escrow and atomic swaps:** Build trust-minimized escrow systems that unlock on Stellar when a Bitcoin payment is confirmed, without a bridge or custodian.

**ZK Proof of Reserve:** Verify that a claimed BTC reserve actually exists on Bitcoin, at a specific block, as part of a ZK attestation flow.

---

## What the SDK Does NOT Cover

The Writz SPV SDK verifies that a **transaction exists in the Bitcoin blockchain** and extracts its outputs. It does not:

- Validate that the transaction is "to" a specific P2WSH address (your contract must check `output.address == expected_address`)
- Validate the internal logic of Bitcoin scripts beyond output parsing
- Provide real-time Bitcoin price data (use an oracle for this)
- Track the full UTXO set (stateless — no chain state is maintained)

---

## Security Considerations for SDK Users

**6-confirmation default:** The SDK defaults to 6 confirmations. This provides strong protection against reorgs. Do not lower this below 3 for production use cases.

**Verify the output address:** Always check that the `output.address` in the `VerificationResult` matches the expected P2WSH address. The SPV contract verifies the transaction's inclusion in the blockchain — your contract must verify the transaction sent funds to the right place.

**Replay protection:** If your contract grants something of value when a specific Bitcoin transaction is verified, implement your own replay protection (e.g., store verified txids) to prevent the same transaction from being used twice.

---

## Roadmap

**Q4 2026:** `writz-sdk` npm package published to npm. TypeScript types, proof assembly utilities, relayer client.

**Q1 2027:** Rust crate published to crates.io. Direct integration without the relayer API.

**Q2 2027:** Formal Soroban interface standard (SEP proposal) for Bitcoin SPV verification on Stellar.

---

**Next:** [Contract Reference →](contract-reference.md)
