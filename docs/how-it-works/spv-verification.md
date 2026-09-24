# SPV Verification

**How Writz proves a Bitcoin transaction happened - without trusting anyone.**

SPV stands for Simplified Payment Verification. It is a technique - described in the original Bitcoin whitepaper by Satoshi Nakamoto - that allows a lightweight client to verify that a transaction is included in the Bitcoin blockchain without downloading the entire chain.

Writz implements SPV inside a Soroban smart contract. This means the Stellar blockchain itself can verify Bitcoin transactions cryptographically. No oracle. No bridge operator. No committee. Just math.

---

## Why SPV Works

Bitcoin's blockchain is a chain of blocks. Each block has a header that contains:

- The hash of the previous block (linking the chain)
- A Merkle root - a single hash that commits to every transaction in the block
- A nonce and target - proof that miners did computational work to produce this block

To prove a transaction is in a block, you need:

1. **The block header** - to verify it has valid proof-of-work
2. **A Merkle proof** - a set of sibling hashes that, combined with your transaction's hash, reproduce the Merkle root in the header
3. **The raw transaction** - to verify the transaction data matches the hash

If these three things are consistent - the header has valid PoW, the Merkle proof reconstructs the correct root, and the raw transaction matches - then the transaction is in that block. No full Bitcoin node required.

---

## The Writz Approach: an On-Chain Header Light Client

`bitcoin-spv` keeps a compact record of Bitcoin block headers on Stellar, and proves transactions against that record. A caller can no longer hand the contract a header chain it built itself - the earlier "stateless" design accepted exactly that, which is what allowed a privately mined chain to pass as real.

How it works:

- **One trusted anchor.** The admin sets a checkpoint - a recent real Bitcoin block - exactly once. Every stored header must descend from it.
- **Anyone can extend the chain.** `submit_headers` accepts a run of contiguous headers, checks each one (proof-of-work, link to a stored parent, the exact difficulty Bitcoin requires at that height, sane timestamp) and keeps the chain with the most cumulative work. The Writz relayer does this routinely, but any party can.
- **Proofs are cheap.** `verify_transaction` names a stored block and checks a Merkle proof against its root. It no longer re-validates a header chain on every call.

The trade-offs are honest ones: the contract now holds state that grows with each submitted header, and someone has to keep submitting headers (permissionless, so the system does not depend on a single relayer, but a deposit can only be proven once its block and the blocks above it have been submitted). In exchange, forging a deposit requires real Bitcoin proof-of-work rather than an internally consistent private chain.

On signet, where blocks are authenticated by a signature the contract does not verify, header submission is restricted to a configured submitter. See `docs/security/security-model.md` for the full trust model.

---

## What the Contract Verifies

`verify_transaction` takes:

```rust
pub fn verify_transaction(
    env: Env,
    block_hash: BytesN<32>,         // Hash of the (already stored) block holding the tx
    merkle_proof: Vec<BytesN<32>>,  // Sibling hashes from tx to block root
    tx_index: u32,                  // Transaction's index in the block
    raw_tx: Bytes,                  // The raw Bitcoin transaction (non-witness)
    min_confirmations: u32,         // Minimum depth required (default: 6)
) -> SpvVerificationResult
```

(`SpvVerificationResult` is defined once, in the shared `spv-types` crate, and reused by every contract that calls into `bitcoin-spv` - not redefined per contract.)

**Header ingestion - `submit_headers(headers)`:**
- Each header's `prev_block_hash` must be a header the contract already stores (ultimately the checkpoint)
- `SHA256d(header)` must meet the target encoded in `bits`
- `bits` must equal what Bitcoin's difficulty rules require at that height: unchanged inside a 2016-block period, the exact retarget at each boundary
- The timestamp may not be more than two hours ahead of ledger time
- The chain with the most cumulative work becomes the best chain; a heavier fork replaces it

**Verification - `verify_transaction`:**
- The block must be stored, after the checkpoint, and on the best chain
- Its depth below the best tip must be at least `min_confirmations`
- `raw_tx` must not be exactly 64 bytes (the size of a Merkle inner-node preimage)
- Compute `txid = SHA256d(raw_tx)`, walk the Merkle proof (alternating left/right by `tx_index`), and the result must equal the stored block's `merkle_root`
- Return `SpvVerificationResult { txid, block_hash, confirmations }`, where `confirmations` is the block's real depth

There is no output-parsing step - the contract does not extract or return the transaction's outputs. A caller that needs to know which output paid a given address parses `raw_tx` itself; see the accuracy note in `docs/developers/spv-sdk.md` for the same point.

---

## SHA256d: Bitcoin's Hash Function

Bitcoin uses double-SHA256 (SHA256 applied twice) for all cryptographic operations: block hashes, transaction IDs, and Merkle tree nodes.

```
SHA256d(x) = SHA256(SHA256(x))
```

Soroban does not natively provide SHA256 as a host function - the `bitcoin-spv` contract implements it in Wasm. This was the primary concern about feasibility: would the compute cost be acceptable?

**Benchmarked instruction counts:**

| Operation | Instructions |
|---|---|
| Single SHA256d | ~500,000 |
| Header PoW check (1 header) | ~600,000 |
| Merkle proof (20 levels) | ~10,000,000 |
| Full SPV verify (6 headers + proof) | ~37,000,000 |
| Soroban transaction limit | ~100,000,000 |

These figures were measured for the earlier design, which validated a header chain inside every verification. With the light client, headers are validated once in `submit_headers` and `verify_transaction` only checks a Merkle proof, so the per-deposit cost is lower; the header-submission costs are being re-measured.

---

## The Relayer Service

Header submission is permissionless, so the relayer is not a trust component, but someone has to keep the contract's header chain current and assemble proof bundles for users. The Writz relayer handles both.

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

**PoW validation:** Each header's proof-of-work is checked independently. A forged header chain would require generating valid PoW - computationally infeasible against Bitcoin's current hash rate.

**Merkle proof soundness:** The Merkle proof check is collision-resistant under SHA256. A fabricated proof would require a SHA256 preimage attack - computationally infeasible.

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

49/49 tests pass. The contract is deployed on Stellar testnet at `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA`.

---

**Next:** [The ZK Privacy Layer →](zk-privacy-layer.md)
