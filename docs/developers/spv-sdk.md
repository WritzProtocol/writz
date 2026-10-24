---
title: "Bitcoin SPV SDK"
description: "Reference for verify_transaction on the Writz bitcoin-spv contract: real signature, return type, errors, the relayer proof route, and what is not available yet."
---

**Verify Bitcoin transactions from any Stellar smart contract.**

`bitcoin-spv` is a Bitcoin light client that runs as a Soroban contract. It stores Bitcoin block headers that descend from a fixed checkpoint, checks each header's proof-of-work and difficulty, and follows the most-work chain. Any Soroban contract can then ask it whether a Bitcoin transaction is in a block of that chain, with a given number of confirmations. Writz Lend uses it to verify BTC deposits; you can use it for anything that should react to a Bitcoin transaction.

The SDK is the deployed contract, the relayer proof route, and two packages whose first release is pending: [`@writz/sdk`](https://github.com/WritzProtocol/writz/tree/main/packages/sdk) for TypeScript and [`writz-spv-client`](https://github.com/WritzProtocol/writz/tree/main/contracts/contracts/writz-spv-client) for Soroban contracts (see [Packages](#packages)). Until they are published, the snippets below need only `soroban-sdk` or `@stellar/stellar-sdk`. For a step-by-step walkthrough with commands that were run against testnet, start with [Build on Writz](/developers/integrate).

---

## Deployment

| | Value |
|---|---|
| Contract ID (Stellar testnet) | `CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP` |
| Bitcoin network tracked | Signet |
| Checkpoint | Signet block 325,554 (only later blocks can be proven) |
| Header submission | Restricted to one designated Writz account on signet, because signet blocks are authorised by a signature the contract does not verify |
| Max headers per `submit_headers` call | 16 |
| Max reorg depth per call | 20 blocks |

Source: [`contracts/contracts/bitcoin-spv/src/lib.rs`](https://github.com/WritzProtocol/writz/blob/main/contracts/contracts/bitcoin-spv/src/lib.rs). Deployment record: [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md).

---

## `verify_transaction`

```rust
pub fn verify_transaction(
    env: Env,
    block_hash: BytesN<32>,
    merkle_proof: Vec<BytesN<32>>,
    tx_index: u32,
    raw_tx: Bytes,
    min_confirmations: u32,
) -> Result<SpvVerificationResult, SPVError>
```

| Parameter | Meaning |
|---|---|
| `block_hash` | Hash of the block that contains the transaction, **internal byte order** (the reverse of what explorers show). The header must already be stored and on the most-work chain |
| `merkle_proof` | Sibling hashes from the leaf level up to just below the Merkle root, each in internal byte order. Empty for a block with a single transaction |
| `tx_index` | 0-based position of the transaction in the block |
| `raw_tx` | The transaction **without witness data** (legacy serialization). Its SHA256d is the txid. Exactly 64 bytes is rejected |
| `min_confirmations` | Minimum depth of the block below the light client's tip, where the tip itself counts as 1. Must be at least 1 |

It is a read: it changes no state, needs no authorisation, and can be simulated for free.

### Return type

`SpvVerificationResult`, defined in the shared crate [`spv-types`](https://github.com/WritzProtocol/writz/blob/main/contracts/contracts/spv-types/src/lib.rs):

```rust
#[contracttype]
pub struct SpvVerificationResult {
    pub txid: BytesN<32>,       // SHA256d(raw_tx), internal byte order
    pub block_hash: BytesN<32>, // internal byte order
    pub block_height: u32,      // Bitcoin height of that block
    pub confirmations: u32,     // the block's actual depth below the tip (tip = 1)
}
```

That is the complete result. It says nothing about the transaction's outputs: if you need to know what the transaction paid and to whom, parse `raw_tx` yourself (see [Checking outputs](#checking-outputs)).

### Errors

`SPVError` codes are stable. The ones a caller of `verify_transaction` can hit:

| Code | Name | Meaning |
|---|---|---|
| 2 | `InsufficientConfirmations` | The block is shallower than `min_confirmations` |
| 3 | `ZeroMinConfirmations` | `min_confirmations` is 0 |
| 5 | `MerkleProofInvalid` | The proof does not reproduce the block's Merkle root |
| 7 | `EmptyTransaction` | `raw_tx` is empty |
| 10 | `NotInitialized` | The contract has no configuration |
| 13 | `CheckpointNotSet` | No checkpoint yet |
| 15 | `AmbiguousTransactionLength` | `raw_tx` is exactly 64 bytes |
| 22 | `HeaderNotFound` | `block_hash` is not stored |
| 23 | `NotOnBestChain` | The block is stored but not on the most-work chain |
| 24 | `BlockNotAfterCheckpoint` | The block is the checkpoint or older |

The full list, including the codes of `submit_headers` and the admin functions, is in [`error.rs`](https://github.com/WritzProtocol/writz/blob/main/contracts/contracts/bitcoin-spv/src/error.rs).

### Other reads

| Function | Returns |
|---|---|
| `get_best_tip()` | `Option<BestTip>`: `hash`, `height`, `chainwork` of the most-work chain |
| `get_header(block_hash)` | `Option<HeaderEntry>`: `prev`, `merkle_root`, `height`, `bits`, `time`, `period_start_time`, `chainwork` |
| `get_canonical_hash(height)` | `Option<BytesN<32>>`: the most-work chain's block hash at that height |
| `get_checkpoint()` | `Option<Checkpoint>`: the trust root |
| `is_deposit_consumed(txid)` | `bool`: whether a Writz lending contract has already used this deposit |

`consume_deposit` and `set_consumer` are for the Writz lending contracts only; registering a consumer is admin-gated. Keep your own record of the txids you accept.

---

## Packages

| Package | Registry | For | Status |
|---|---|---|---|
| [`@writz/sdk`](https://github.com/WritzProtocol/writz/tree/main/packages/sdk) | npm | TypeScript in the browser, Node or Bun: testnet preset, relayer client with typed errors and `Retry-After`, `bitcoin-spv` and `writz-lend` clients, Earn vault routes | Release pending: not on npm yet |
| [`writz-spv-client`](https://github.com/WritzProtocol/writz/tree/main/contracts/contracts/writz-spv-client) | crates.io | Soroban contracts: `BitcoinSpvClient`, the result and error types, the on-chain output parser `find_output_value` | Release pending: not on crates.io yet |

With `writz-spv-client` the contract below shrinks to the call itself:

```toml
[dependencies]
soroban-sdk = "26"
writz-spv-client = "0.1"
```

```rust
use writz_spv_client::{find_output_value, BitcoinSpvClient, SPVError};

let proof = match BitcoinSpvClient::new(&env, &spv)
    .try_verify_transaction(&block_hash, &merkle_proof, &tx_index, &raw_tx, &6)
{
    Ok(Ok(result)) => result,
    Err(Ok(SPVError::InsufficientConfirmations)) => return Err(Error::TooRecent),
    _ => return Err(Error::ProofRejected),
};
let sats = find_output_value(&raw_tx, &expected_spk).ok_or(Error::NotPaid)?;
```

Its tests check every type, error code and the parser against the `bitcoin-spv` and `spv-types` source.

## Calling it from a Soroban contract

```rust
use soroban_sdk::{contractclient, contracttype, Bytes, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    pub txid: BytesN<32>,
    pub block_hash: BytesN<32>,
    pub block_height: u32,
    pub confirmations: u32,
}

#[contractclient(name = "BitcoinSpvClient")]
pub trait BitcoinSpv {
    fn verify_transaction(
        env: Env,
        block_hash: BytesN<32>,
        merkle_proof: Vec<BytesN<32>>,
        tx_index: u32,
        raw_tx: Bytes,
        min_confirmations: u32,
    ) -> SpvVerificationResult;
}

// In your contract. `spv` is the bitcoin-spv contract ID, stored at construction.
// `try_` returns the callee's error as a value instead of aborting your call.
let proof = match BitcoinSpvClient::new(&env, &spv)
    .try_verify_transaction(&block_hash, &merkle_proof, &tx_index, &raw_tx, &6)
{
    Ok(Ok(result)) => result,
    _ => return Err(Error::ProofRejected),
};
```

Without `writz-spv-client`, declare the struct locally as above; the call decodes the result by field name, so the names and types must match exactly.

A complete, tested contract built this way is [`examples/spv-payment-check`](https://github.com/WritzProtocol/writz/tree/main/examples/spv-payment-check).

### Checking outputs

`spv-types` includes the parser Writz Lend uses on chain. Add it as a git dependency pinned to a commit:

```toml
[dependencies]
soroban-sdk = "26"
spv-types = { git = "https://github.com/WritzProtocol/writz", rev = "0a1065991ee0498ad2c54367e0ffa69ca4a59a9a" }
```

```rust
// Satoshi value of the first output whose scriptPubKey equals `expected_spk`,
// or None. Despite the name, it compares raw scriptPubKey bytes, so it works
// for P2WPKH, P2WSH, P2TR and any other script type.
let sats = spv_types::btc_parser::find_p2wsh_output(&raw_tx, &expected_spk);
```

Pass the scriptPubKey as bytes (for example `0014...` for P2WPKH; mempool.space shows it as `scriptpubkey` for each output).

---

## Getting the proof: the relayer

```
GET https://api.testnet.writz.xyz/spv-proof/:txid?confirmations=6
```

`txid` is in display byte order (as explorers show it). `confirmations` is optional, 1 to 20, default 6. Response (200), shortened:

```json
{
  "txid": "1fef7b54...ccb718b1",
  "rawTxNoWitness": "0200000001b537...",
  "blockHash": "9e4d5092...0f000000",
  "txIndex": 1,
  "merkleProof": ["f3e0901f...", "..."],
  "headers": ["...", "..."],
  "blockHeight": 327600,
  "confirmations": 6,
  "sorobanArgs": {
    "block_hash": "9e4d5092...0f000000",
    "merkle_proof": ["f3e0901f...", "..."],
    "tx_index": 1,
    "raw_tx": "0200000001b537...",
    "min_confirmations": 6
  }
}
```

`sorobanArgs` maps one to one onto the parameters of `verify_transaction`, already in internal byte order. `confirmations` and `min_confirmations` echo what you asked for; the block's real depth is what the contract returns. `headers` are the raw 80-byte headers from the block onwards, one per requested confirmation, for callers that want to inspect them; `verify_transaction` does not take them.

Error responses: `400 invalid_txid`, `400 invalid_confirmations`, `404 unconfirmed`, `404 tx_not_found` (a txid that is not on signet), `409 insufficient_confirmations` (with `requested` and `available`), `409 light_client_behind` (the block is not yet in `bitcoin-spv`), `429 rate_limited`, `502 upstream_error`, `503 upstream_unavailable`. The 409, 429 and 503 responses carry `retryAfterSeconds` and a `Retry-After` header.

### Building the proof yourself

The relayer only reads public Bitcoin data, so you can do the same from any Esplora API (for example `https://mempool.space/signet/api`):

1. `GET /tx/:txid` for `status.block_height`, then `GET /block-height/:height` for the block hash.
2. `GET /tx/:txid/merkle-proof` for `pos` (the `tx_index`) and `merkle` (the siblings).
3. `GET /tx/:txid/raw`, then strip the witness to get the legacy serialization.
4. Reverse the block hash and each sibling to internal byte order.

The reference implementation is `buildSPVProof` in [`relayer/src/bitcoin/spv.ts`](https://github.com/WritzProtocol/writz/blob/main/relayer/src/bitcoin/spv.ts).

---

## Use cases

- **Bitcoin payment checks.** Release a token, an NFT or access on Stellar once a Bitcoin payment confirms, without a bridge or a custodian.
- **Bitcoin-collateralised lending.** What Writz Lend does: prove a deposit to a time-locked script before lending against it.
- **Escrow.** Unlock funds on Stellar when the counterparty's Bitcoin payment is buried under N blocks.
- **Bitcoin-gated actions.** Votes, mints or roles for anyone who proves a specific Bitcoin payment.

## Security notes for integrators

- **Check the outputs.** Inclusion proves the transaction exists, not that it paid you. Parse `raw_tx`.
- **Replay protection.** `verify_transaction` will verify the same transaction for anyone, any number of times. Store the txids you accept.
- **Choose confirmations deliberately.** 6 is the usual choice and what Writz Lend uses.
- **Testnet only.** The deployed light client tracks signet, with header submission restricted to Writz, and none of the contracts are audited.

---

## Not yet available

These appeared in earlier versions of this page and do not exist today:

- Output extraction in the result (an `outputs` field or address matching). The result has only the four fields above; use the parser in `spv-types`.
- A `headers` argument to `verify_transaction`. Headers are submitted separately with `submit_headers`, and the call takes a stored `block_hash`.
- A published npm package or crates.io crate, until the first release of `@writz/sdk` and `writz-spv-client` (see [Packages](#packages)). Until then use the deployed contract, the relayer route, `stellar contract bindings typescript`, and the `spv-types` git dependency.
- A light client tracking Bitcoin mainnet on Stellar, and any per-call fee. Neither exists.

---

**Next:** [Build on Writz](/developers/integrate) for a runnable walkthrough, or [Contract Reference](/developers/contract-reference) for every function of every contract.
