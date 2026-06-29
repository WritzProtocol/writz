# SPV Verification

**How Writz proves a Bitcoin transaction happened — without trusting anyone.**

SPV stands for Simplified Payment Verification. It is a technique — described in the original Bitcoin whitepaper by Satoshi Nakamoto — that allows a lightweight client to verify that a transaction is included in the Bitcoin blockchain without downloading the entire chain.

Writz implements SPV inside a Soroban smart contract. This means the Stellar blockchain itself can verify Bitcoin transactions cryptographically. No oracle. No bridge operator. No committee. Just math.

---

## Why SPV Works

Bitcoin's blockchain is a chain of blocks. Each block has a header that contains:

- The hash of the previous block (linking the chain)
- A Merkle root — a single hash that commits to every transaction in the block
- A nonce and target — proof that miners did computational work to produce this block

To prove a transaction is in a block, you need:

1. **The block header** — to verify it has valid proof-of-work
2. **A Merkle proof** — a set of sibling hashes that, combined with your transaction's hash, reproduce the Merkle root in the header
3. **The raw transaction** — to verify the transaction data matches the hash

If these three things are consistent — the header has valid PoW, the Merkle proof reconstructs the correct root, and the raw transaction matches — then the transaction is in that block. No full Bitcoin node required.

---

## The Writz Approach: Stateless SPV

Most SPV implementations maintain state: they store a chain of Bitcoin block headers on-chain, and new headers are submitted by a relayer service. This creates a hard dependency on the relayer — if the relayer goes down, the system breaks.

Writz uses **stateless SPV**: the caller provides all necessary headers at the time of verification. The contract validates them in a single transaction and does not store any headers.

This has important implications:

- **No relayer dependency for core security:** The SPV contract can be called by anyone with the right data. Writz runs a relayer service as a convenience, but it is not a critical path component.
- **No growing on-chain state:** A stateful header chain would grow indefinitely. Stateless SPV has zero persistent storage for headers.
- **Simpler audit surface:** The verification logic is a pure function — given inputs, it returns a result. No state transitions to reason about.

---

## What the Contract Verifies

The `bitcoin-spv` contract's `verify_transaction` function takes:

```rust
pub fn verify_transaction(
    env: Env,
    headers: Vec<BitcoinBlockHeader>,  // The block headers (starting from anchor)
    merkle_proof: Vec<Bytes32>,        // Sibling hashes from tx to block root
    tx_index: u32,                     // Transaction's index in the block
    raw_tx: Bytes,                     // The raw Bitcoin transaction
    min_confirmations: u32,            // Minimum depth required (default: 6)
) -> VerificationResult
```

For each call, the contract:

**Step 1 — Validate each block header:**
- Parse the 80-byte header into its fields (version, prev_block, merkle_root, time, bits, nonce)
- Compute `SHA256d(header)` — Bitcoin's double-SHA256 block hash
- Verify the hash meets the difficulty target encoded in `bits`
- Verify the chain is continuous: `headers[i].prev_block == SHA256d(headers[i-1])`

**Step 2 — Verify Merkle inclusion:**
- Compute `txid = SHA256d(SHA256d(raw_tx))`
- Walk the Merkle proof: repeatedly hash `txid` with each sibling in the proof, alternating left/right based on `tx_index`
- The final hash must equal `headers[0].merkle_root`

**Step 3 — Check confirmations:**
- `len(headers) >= min_confirmations`
- Each header must extend the previous (Step 1 ensures this)

**Step 4 — Extract outputs:**
- Parse the raw transaction's outputs
- Return `VerificationResult { txid, block_hash, confirmations, outputs }`

---

## SHA256d: Bitcoin's Hash Function

Bitcoin uses double-SHA256 (SHA256 applied twice) for all cryptographic operations: block hashes, transaction IDs, and Merkle tree nodes.

```
SHA256d(x) = SHA256(SHA256(x))
```

Soroban does not natively provide SHA256 as a host function — the `bitcoin-spv` contract implements it in Wasm. This was the primary concern about feasibility: would the compute cost be acceptable?

**Benchmarked instruction counts:**

| Operation | Instructions |
|---|---|
| Single SHA256d | ~500,000 |
| Header PoW check (1 header) | ~600,000 |
| Merkle proof (20 levels) | ~10,000,000 |
| Full SPV verify (6 headers + proof) | ~37,000,000 |
| Soroban transaction limit | ~100,000,000 |

A full SPV verification uses ~37–55M instructions — comfortably within Soroban's 100M instruction budget, with room for the ZK verification that follows in the same transaction.

---

## The Relayer Service

While stateless SPV means the relayer is not a critical security component, someone needs to assemble the proof bundle for users. The Writz relayer handles this.

**What the relayer does:**
1. Watches a Bitcoin Esplora API for transactions to monitored addresses
2. Fetches the raw transaction, the block header it was included in, and sufficient ancestor headers to meet `min_confirmations`
3. Computes the Merkle proof from the block's transaction list
4. Packages everything into a `sorobanArgs` bundle ready to submit to the SPV contract

**REST API:**
```
GET /spv-proof/{txid}

Response:
{
  "txid": "11932100...",
  "block_hash": "00000000...",
  "confirmations": 6,
  "sorobanArgs": {
    "headers": [...],
    "merkleProof": [...],
    "txIndex": 42,
    "rawTx": "0200000001..."
  }
}
```

**Fallback:** If the Writz relayer is unavailable, users can assemble the proof bundle themselves from any Bitcoin Esplora instance (Blockstream, mempool.space, or a self-hosted node). The SPV contract accepts any valid proof from any caller.

---

## Security Guarantees

**6-confirmation requirement:** Writz requires 6 Bitcoin block confirmations before accepting a deposit. A 6-block reorganization has never occurred in Bitcoin's history. This provides practical certainty that a transaction will not be reversed.

**PoW validation:** Each header's proof-of-work is checked independently. A forged header chain would require generating valid PoW — computationally infeasible against Bitcoin's current hash rate.

**Merkle proof soundness:** The Merkle proof check is collision-resistant under SHA256. A fabricated proof would require a SHA256 preimage attack — computationally infeasible.

**What SPV does NOT protect against:**
- A user sending BTC to the wrong P2WSH address (user error)
- A deep reorg affecting more than 6 blocks (extraordinarily unlikely, but theoretically possible on a heavily attacked network)
- Bugs in the SPV contract itself (mitigated by audits and extensive testing)

---

## Tested on Real Bitcoin Transactions

The SPV contract has been tested against:
- Real Bitcoin mainnet transactions (correct `txid` and `block_hash` verified against Python-computed SHA256d)
- Multiple block depths (1, 3, 6, 12 confirmations)
- Multi-transaction blocks with varying Merkle proof sizes
- Edge cases: single-transaction blocks, maximum-size transactions

28/28 tests pass. The contract is deployed on Soroban testnet at `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ`.

---

**Next:** [The ZK Privacy Layer →](zk-privacy-layer.md)
