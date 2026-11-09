---
title: "SPV Verification"
---

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

`bitcoin-spv` keeps a compact record of Bitcoin block headers on Stellar, and proves transactions against that record. A caller cannot hand the contract a header chain it built itself: a proof only counts against headers the contract already stored and validated.

How it works:

- **One trusted anchor.** The admin sets a checkpoint - a recent real Bitcoin block - exactly once. Every stored header must descend from it.
- **Headers are submitted in runs.** `submit_headers` accepts up to 16 contiguous headers per call, checks each one (proof-of-work, link to a stored parent, the exact difficulty Bitcoin requires at that height, sane timestamp) and keeps the chain with the most cumulative work. The Writz relayer does this routinely. Submission is permissionless unless the admin names a submitter with `set_submitter`; on testnet it is restricted to the relayer account (see below).
- **Proofs are cheap.** `verify_transaction` names a stored block and checks a Merkle proof against its root. It no longer re-validates a header chain on every call.

The trade-offs are honest ones: the contract holds state that grows with each submitted header, and someone has to keep submitting headers. A deposit can only be proven once its block and the blocks above it have been submitted. With open submission on mainnet, as designed, the system does not depend on a single relayer. In exchange, forging a deposit requires real Bitcoin proof-of-work rather than an internally consistent private chain.

On signet, where blocks are authenticated by a signature the contract does not verify, header submission is restricted to a configured submitter, and that submitter is trusted for header validity. See the [Security Model](/security/security-model) for the full trust model.

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
    min_confirmations: u32,         // Minimum depth required; writz-lend passes its configured value (6 on mainnet, 1 on testnet)
) -> Result<SpvVerificationResult, SPVError>
```

(`SpvVerificationResult` is defined once, in the shared `spv-types` crate, and reused by every contract that calls into `bitcoin-spv` - not redefined per contract.)

**Header ingestion - `submit_headers(headers)`:**
- Each header's `prev_block_hash` must be a header the contract already stores (ultimately the checkpoint)
- `SHA256d(header)` must meet the target encoded in `bits`
- `bits` must equal what Bitcoin's difficulty rules require at that height: unchanged inside a 2016-block period, the exact retarget at each boundary
- The timestamp may not be more than two hours ahead of ledger time
- The chain with the most cumulative work becomes the best chain; a heavier fork replaces it, re-pointing at most 20 blocks in one call (`ReorgTooDeep` beyond that)

**Verification - `verify_transaction`:**
- The block must be stored, after the checkpoint, and on the best chain
- Its depth below the best tip must be at least `min_confirmations`
- `raw_tx` must not be exactly 64 bytes (the size of a Merkle inner-node preimage)
- Compute `txid = SHA256d(raw_tx)`, walk the Merkle proof (alternating left/right by `tx_index`), and the result must equal the stored block's `merkle_root`
- Return `SpvVerificationResult { txid, block_hash, block_height, confirmations }`, where `confirmations` is the block's real depth

There is no output-parsing step - the contract does not extract or return the transaction's outputs. A caller that needs to know which output paid a given address parses `raw_tx` itself, as `writz-lend::deposit` does; see the [SPV SDK](/developers/spv-sdk).

---

## SHA256d: Bitcoin's Hash Function

Bitcoin uses double-SHA256 (SHA256 applied twice) for all cryptographic operations: block hashes, transaction IDs, and Merkle tree nodes.

```
SHA256d(x) = SHA256(SHA256(x))
```

Soroban provides SHA-256 as a host function (`env.crypto().sha256`), and `bitcoin-spv` computes SHA256d as two calls to it. Headers are validated once, in `submit_headers`; `verify_transaction` only hashes the transaction and walks its Merkle proof, one SHA256d per level.

---

## The Relayer Service

Someone has to keep the contract's header chain current and assemble proof bundles for users. The Writz relayer handles both. A proof it serves is checked by the contracts, so it cannot fake one; on testnet, as the only header submitter, it is trusted for the headers themselves.

**What the relayer does:**
1. Submits new Bitcoin headers from an Esplora API to `bitcoin-spv`, in batches of up to 16
2. On request, fetches the raw transaction from Esplora, strips its witness data and computes the Merkle proof from the block's transaction list
3. Checks that the light client already holds enough blocks above the transaction's block for the requested confirmations, and answers `409 light_client_behind` with a retry time if not
4. Packages everything into a `sorobanArgs` bundle that maps to the contract arguments

**REST API:**
```
GET /spv-proof/{txid}?confirmations=6

Response:
{
  "txid": "eac0f95c...",
  "rawTxNoWitness": "02000000...",
  "blockHash": "fe324a44...",
  "blockHeight": 327928,
  "txIndex": 842,
  "merkleProof": [...],
  "headers": [...],
  "confirmations": 6,
  "sorobanArgs": {
    "block_hash": "fe324a44...",
    "merkle_proof": [...],
    "tx_index": 842,
    "raw_tx": "02000000...",
    "min_confirmations": 6
  }
}
```

The testnet relayer is at `https://api.testnet.writz.xyz`. `confirmations` is optional (1 to 20, default 6).

**Fallback:** If the Writz relayer is unavailable, users can assemble the proof bundle themselves from any Bitcoin Esplora instance (Blockstream, mempool.space, or a self-hosted node); see [Manual Proof Submission](/how-it-works/manual-proof-submission). The SPV contract accepts a valid proof from any caller, but only against headers it already stores: while header submission is restricted to the relayer, as on testnet, a block the relayer has not submitted cannot be proven.

---

## Security Guarantees

**Confirmation requirement:** `writz-lend` is deployed with the number of confirmations a deposit needs: 6 on mainnet, 1 on testnet. Reorganizations six blocks deep are very rare: the deepest on mainnet are the 2010 value-overflow fix and the 2013 BIP-50 fork. Six confirmations make reversal of an accepted deposit negligible at launch exposure caps.

**PoW validation:** Each header's proof-of-work and difficulty are checked when it is submitted. A forged mainnet header chain would require generating valid PoW, which is computationally infeasible against Bitcoin's current hash rate. Signet proof of work is cheap, which is why testnet relies on a trusted submitter.

**Merkle proof soundness:** The Merkle proof check is collision-resistant under SHA256. A fabricated proof would require a SHA256 preimage attack - computationally infeasible.

**What SPV does NOT protect against:**
- A user sending BTC to the wrong P2WSH address (user error)
- A deep reorg affecting more than 6 blocks (extraordinarily unlikely, but theoretically possible on a heavily attacked network)
- Bugs in the SPV contract itself (mitigated by testing; an external audit is planned before mainnet)

For how this trust model compares with wrapped Bitcoin and bridges, including the risks a light client does share with them, see [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped).

---

## Tested on Real Bitcoin Transactions

The SPV contract's tests cover:
- The real Bitcoin mainnet genesis header: its hash and its proof of work
- Difficulty retargeting at period boundaries, including the 4x clamps and the proof-of-work limit
- Heavier forks replacing the best chain and orphaning the old block
- Multi-transaction blocks with varying Merkle proof sizes, odd transaction counts and single-transaction blocks
- Confirmation depth, blocks at or before the checkpoint, and the consumed-deposit registry

All 83 tests pass, and the light client follows Bitcoin signet on testnet. The contract is deployed on Stellar testnet at `CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO`.

---

**Next:** [The Stellar Side →](/how-it-works/stellar-side)
