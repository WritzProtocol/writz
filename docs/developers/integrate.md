---
title: "Build on Writz"
description: "Integrate Writz in 15 minutes: prove a Bitcoin transaction from your Soroban contract or your app, with live testnet contract IDs and copy-paste snippets that were run against testnet."
---

**Prove a Bitcoin transaction on Stellar in 15 minutes.**

This page is for builders who want to use Writz from their own project. If you want to build and test this repository instead, see [Quick Start](/developers/quick-start), the contributor guide. If you are an AI coding agent, [For AI Agents](/developers/for-ai-agents) has the same facts in a compact form.

Every command and response on this page was run against Stellar testnet and Bitcoin signet on 2026-10-23. Values that change over time (the Bitcoin tip, confirmation counts) will differ when you run them.

---

## What you can build on today

| Surface | What it gives you | Status |
|---|---|---|
| `bitcoin-spv` contract, `verify_transaction` | Proof, inside Soroban, that a Bitcoin signet transaction is in a block of the most-work chain with at least N confirmations | Live on testnet, verified below |
| Relayer `GET /spv-proof/:txid` | A ready-made proof for any confirmed signet transaction, already in the argument format `verify_transaction` takes | Live, verified below |
| `bitcoin-spv` reads (`get_best_tip`, `get_header`, `get_canonical_hash`, `get_checkpoint`) | The light client's view of Bitcoin: tip height, block hashes, header timestamps | Live, verified below |
| `writz-lend` reads (`get_protocol_state`, rates, `get_position`, `get_supply_balance`) | Pool size, rates and positions of the Writz lending pool | Live on testnet, reads verified below |
| `writz-lend` lender side (`supply_usdc`, `withdraw_supply`, `get_supply_balance`, `get_supply_rate_bp`) | Yield on USDC from the interest Bitcoin borrowers pay, without a contract of your own | Live on testnet, see [section 7](#7-earn-yield-on-usdc-as-a-lender) |
| The testnet app, [testnet.writz.xyz](https://testnet.writz.xyz) | Deposit signet BTC, borrow test USDC | Link to it; there is no embed or widget API |

Ideas that fit in a weekend: a Soroban contract that releases something (an NFT, access, an escrowed token) once a Bitcoin payment confirms; a Bitcoin payment checker for a store or invoice app; a dashboard of the Writz pool; a bot that watches a Bitcoin address and proves its payments on Stellar.

**Not available yet:** Bitcoin mainnet or testnet3/testnet4 verification on Stellar (the testnet light client tracks **signet** only), and any Writz contract on Stellar mainnet. See [Bitcoin SPV SDK](/developers/spv-sdk#not-yet-available).

---

## Packages

| Package | Registry | For | Status |
|---|---|---|---|
| [`@writz/sdk`](https://github.com/WritzProtocol/writz/tree/main/packages/sdk) | npm | TypeScript in the browser, Node or Bun: testnet preset, relayer client with typed errors and `Retry-After`, `bitcoin-spv` and `writz-lend` clients | Published: [`npm install @writz/sdk`](https://www.npmjs.com/package/@writz/sdk) |
| [`writz-spv-client`](https://github.com/WritzProtocol/writz/tree/main/contracts/contracts/writz-spv-client) | crates.io | Soroban contracts: `BitcoinSpvClient`, the result and error types, the on-chain output parser `find_output_value` | Release pending: not on crates.io yet |

`npm install @writz/sdk` works today. Until `writz-spv-client` is on crates.io, `cargo add writz-spv-client` fails: use the snippets on this page, which need only `soroban-sdk`, or depend on the source in this repository. The package code and its tests are in the repository either way.

---

## Network and contract IDs

| | Value |
|---|---|
| Stellar network | Testnet |
| Network passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Bitcoin network | Signet |
| Writz relayer | `https://api.testnet.writz.xyz` |
| `bitcoin-spv` | `CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP` |
| `writz-lend` | `CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK` |
| Test USDC (Stellar Asset Contract for `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| BTC price oracle read by `writz-lend` (Reflector) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |

The source of truth for every ID, with deploy transactions and wasm hashes, is [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md). The same values, machine-readable, are in [`contracts/deployments/testnet.json`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.json) and in the `@writz/sdk` network preset, both generated from that file. Writz contracts are never upgraded in place: a new version gets a new ID, recorded there.

The `bitcoin-spv` checkpoint is signet block **325,554**. Only blocks after it can be proven.

---

## 1. Check the light client (1 minute)

Install the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (`brew install stellar-cli`). Read calls are simulated, never submitted, so the source account only has to be a valid address; it is not charged and does not sign.

```bash
SPV=CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP
READER=GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT   # any G... address

stellar contract invoke --id $SPV --network testnet --source-account $READER --send=no -- get_best_tip
```

```json
{"chainwork":"431431256653","hash":"6c7bc7661e68f4d5861afacc620f192a3a79b78ff7e5a553c78e252a0b000000","height":327669}
```

`height` should be at or near the signet tip on [mempool.space/signet](https://mempool.space/signet). The Writz relayer submits new signet headers to the contract as they are mined.

## 2. Get a proof from the relayer

Pick any confirmed signet transaction (here one in block 327,600) and ask the relayer for its proof:

```bash
TXID=1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1
curl -s "https://api.testnet.writz.xyz/spv-proof/$TXID?confirmations=6" > proof.json
jq '.sorobanArgs | {block_hash, tx_index, proof_len: (.merkle_proof|length), min_confirmations}' proof.json
```

```json
{
  "block_hash": "9e4d5092aeb95f259afd73c770b9238bee9f300237de7a026150858e0f000000",
  "tx_index": 1,
  "proof_len": 9,
  "min_confirmations": 6
}
```

The full response has `txid`, `rawTxNoWitness`, `blockHash`, `txIndex`, `merkleProof`, `headers`, `blockHeight`, `confirmations` and `sorobanArgs`. Use `sorobanArgs`: its five fields are exactly the five arguments of `verify_transaction`, as hex strings and integers, already in the byte order the contract expects. `confirmations` (query parameter, 1 to 20, default 6) is the minimum you ask for, not the block's actual depth.

The relayer builds proofs from public signet data (mempool.space). It holds no keys for you and you do not have to trust it: a wrong proof simply fails on chain.

## 3. Verify it on Stellar

```bash
stellar contract invoke --id $SPV --network testnet --source-account $READER --send=no -- \
  verify_transaction \
  --block_hash "$(jq -r .sorobanArgs.block_hash proof.json)" \
  --merkle_proof "$(jq -c .sorobanArgs.merkle_proof proof.json)" \
  --tx_index "$(jq -r .sorobanArgs.tx_index proof.json)" \
  --raw_tx "$(jq -r .sorobanArgs.raw_tx proof.json)" \
  --min_confirmations 6
```

```json
{"block_hash":"9e4d5092aeb95f259afd73c770b9238bee9f300237de7a026150858e0f000000","block_height":327600,"confirmations":70,"txid":"b118b7cc60c2bb03b3898f9bfb2605882251ff45ec9d71cce89a81a1547bef1f"}
```

That is the whole primitive. `confirmations` is the block's real depth below the light client's tip. Note that `txid` comes back reversed compared to the `TXID` you passed in: see [Byte order](#byte-order).

## 4. From TypeScript

Runnable example: [`examples/verify-bitcoin-tx`](https://github.com/WritzProtocol/writz/tree/main/examples/verify-bitcoin-tx) (Bun and `@stellar/stellar-sdk`, read-only, no keys).

```bash
cd examples/verify-bitcoin-tx && bun install && bun run start
```

With `@writz/sdk` (`npm install @writz/sdk`) the whole flow is three lines, and relayer errors arrive typed, with the `Retry-After` wait already honoured:

```ts
import { createWritzClient } from "@writz/sdk";

const writz = createWritzClient(); // testnet preset
const { result } = await writz.verifyBitcoinTx("1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1");
// { txid, txidDisplay, blockHash, blockHeight: 327600, confirmations }
```

Without it, the quickest typed client is generated from the deployed contract:

```bash
stellar contract bindings typescript --network testnet \
  --contract-id CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP \
  --output-dir bitcoin-spv-client
cd bitcoin-spv-client && bun install && bun run build
```

```ts
import { Client, networks } from "./bitcoin-spv-client/dist/index.js";

const spv = new Client({ ...networks.testnet, rpcUrl: "https://soroban-testnet.stellar.org" });
const hex = (s: string) => Buffer.from(s, "hex");

const txid = "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1";
const { sorobanArgs: a } = await (
  await fetch(`https://api.testnet.writz.xyz/spv-proof/${txid}`)
).json();

const { result } = await spv.verify_transaction({
  block_hash: hex(a.block_hash),
  merkle_proof: a.merkle_proof.map(hex),
  tx_index: a.tx_index,
  raw_tx: hex(a.raw_tx),
  min_confirmations: 6,
});
console.log(result.isOk() ? result.unwrap() : result.unwrapErr());
// { block_hash: <Buffer 9e 4d ...>, block_height: 327600, confirmations: 71, txid: <Buffer b1 18 ...> }
```

The same command generates a client for `writz-lend` (`--contract-id CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK`). Generate bindings from the deployed contract ID, not from the source on `main`: the source can be ahead of what is deployed.

## 5. From your Soroban contract

Your contract calls `bitcoin-spv` with a cross-contract client. The crate `writz-spv-client` (release pending, see [Packages](#packages)) contains the client, the types and the output parser, so this becomes `writz-spv-client = "0.1"` in `Cargo.toml` and `use writz_spv_client::{find_output_value, BitcoinSpvClient};`. Until it is on crates.io, declare the result type yourself with these exact field names (they are decoded by name):

```rust
use soroban_sdk::{contractclient, contracttype, Bytes, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult {
    pub txid: BytesN<32>,       // SHA256d(raw_tx), internal byte order
    pub block_hash: BytesN<32>, // internal byte order
    pub block_height: u32,
    pub confirmations: u32,     // depth below the light client's tip, tip = 1
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

// Inside a contract function (spv: Address is the bitcoin-spv contract ID):
let proof = match BitcoinSpvClient::new(&env, &spv)
    .try_verify_transaction(&block_hash, &merkle_proof, &tx_index, &raw_tx, &6)
{
    Ok(Ok(result)) => result,
    _ => return Err(Error::ProofRejected), // your own contract error
};
```

`verify_transaction` proves **inclusion and depth only**. It does not tell you what the transaction paid or to whom. To check that, parse `raw_tx` in your contract. The shared Writz crate `spv-types` has an on-chain parser you can use as a git dependency:

```toml
[dependencies]
soroban-sdk = "26"
spv-types = { git = "https://github.com/WritzProtocol/writz", rev = "0a1065991ee0498ad2c54367e0ffa69ca4a59a9a" }
```

```rust
// Value in sats of the first output whose scriptPubKey equals `expected_spk`
// (works for any script type: P2WPKH, P2WSH, P2TR, ...). None if there is none.
let sats: Option<u64> = spv_types::btc_parser::find_p2wsh_output(&raw_tx, &expected_spk);
```

And store the txids you accept: `verify_transaction` is a pure check and will verify the same transaction again for anyone, so replay protection is yours.

The complete contract, with tests, is [`examples/spv-payment-check`](https://github.com/WritzProtocol/writz/tree/main/examples/spv-payment-check): it accepts a Bitcoin payment of at least N sats to a given scriptPubKey, once per txid. It was deployed to testnet and run against the real `bitcoin-spv` with the proof above; its README has the commands.

## 6. Read the Writz lending pool

```bash
LEND=CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK
stellar contract invoke --id $LEND --network testnet --source-account $READER --send=no -- get_protocol_state
stellar contract invoke --id $LEND --network testnet --source-account $READER --send=no -- get_borrow_rate_bp
stellar contract invoke --id $LEND --network testnet --source-account $READER --send=no -- get_supply_balance --lender $READER
```

```json
{"borrow_index":"1000000000000000000","index_ledger":5352956,"last_keeper_heartbeat":1792788367,"reserve_usdc":"0","supply_index":"1000000000000000000","total_borrowed":"0","total_scaled_supply":"10000000000"}
"0"
"10000000000"
```

USDC amounts are in stroops (7 decimals: `10000000000` is 1,000 USDC). Rates are annual basis points (`800` is 8%). Indexes are scaled by 10^18. `get_position` and `get_health_ratio_bp` take a deposit txid in internal byte order; `get_health_ratio_bp` returns basis points (`15000` is 150%, liquidation at `12000`). Full interface: [Contract Reference](/developers/contract-reference).

`supply_usdc` and `withdraw_supply` are permissionless writes signed by the supplier; [section 7](#7-earn-yield-on-usdc-as-a-lender) covers them. Borrowing needs a real signet deposit to the Writz script, which is what the [testnet app](https://testnet.writz.xyz) does for you.

## 7. Earn yield on USDC as a lender

Yield on Writz is the lender side of `writz-lend`. Lenders supply USDC to the pool that Bitcoin borrowers draw from, and the interest those borrowers pay is the lenders' yield. You need no contract of your own: the user's wallet signs `supply_usdc` and `withdraw_supply`, and your app reads the balance and the rate by simulation. The asset is the same test USDC as the rest of this page (`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`), and the user's account needs a trustline to it.

```bash
LEND=CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK
stellar contract invoke --id $LEND --network testnet --source-account me --send=no -- get_supply_rate_bp
stellar contract invoke --id $LEND --network testnet --source-account me -- supply_usdc --supplier $(stellar keys address me) --amount 100000000
stellar contract invoke --id $LEND --network testnet --source-account me --send=no -- get_supply_balance --lender $(stellar keys address me)
stellar contract invoke --id $LEND --network testnet --source-account me -- withdraw_supply --supplier $(stellar keys address me) --amount 100000000
```

`100000000` is 10 USDC. `get_supply_balance` includes the interest earned so far. `withdraw_supply` fails with `#13` (`InsufficientSupply`) above the lender's balance and with `#11` (`InsufficientLiquidity`) above the USDC that is not lent out at that moment.

The supply rate is variable and is zero while nothing is borrowed; with very little borrowed it still reads `0`, because it is counted in whole basis points (`500` is 5% a year). Read it live and label it as variable. Never show a fixed APY.

With `@writz/sdk` these are `lend.getSupplyRateBp`, `lend.getSupplyBalance`, `lend.buildSupplyUsdc` and `lend.buildWithdrawSupply`; the builders return unsigned transactions for the wallet and never sign. A browser flow with `@stellar/stellar-sdk` and product ideas built on it are in [What to build on Writz](/developers/request-for-startups#no-soroban-needed-build-on-writz-yield).

---

## Byte order

Bitcoin explorers show txids and block hashes **reversed** (display order). `bitcoin-spv` works in **internal** order, the raw SHA256d output.

- The relayer route takes the txid in **display** order (as on mempool.space) and returns `sorobanArgs` already in internal order. Pass them through unchanged.
- `verify_transaction` returns `txid` and `block_hash` in internal order. To compare with an explorer, reverse the bytes: `b118b7cc...547bef1f` is `1fef7b54...ccb718b1`.
- If you build proofs yourself from an Esplora API, reverse the block hash and every Merkle sibling before calling the contract.

## Common errors

From the relayer (`GET /spv-proof/:txid`):

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `invalid_txid` | Not 64 hex characters |
| 400 | `invalid_confirmations` | `confirmations` not between 1 and 20 |
| 404 | `unconfirmed` | The transaction is in the mempool, not in a block yet |
| 409 | `insufficient_confirmations` | Fewer confirmations than requested; the body has `requested` and `available`. Signet mines a block about every 10 minutes |
| 404 | `tx_not_found` | The signet indexer does not know this txid. Mainnet and testnet3/4 txids are not found |
| 409 | `light_client_behind` | The block is not yet in `bitcoin-spv`, or not deep enough there. Calling the contract now would fail with `#22` or `#2`. Wait `retryAfterSeconds` (about 60 s, one header-sync cycle) |
| 429 | `rate_limited` | More than 60 requests per minute from your IP. Wait `retryAfterSeconds` |
| 502 | `upstream_error` | An unexpected answer from the Bitcoin indexer |
| 503 | `upstream_unavailable` | The Bitcoin indexer and its fallback are both failing. Wait `retryAfterSeconds` |

Every 409, 429 and 503 carries `retryAfterSeconds` in the body and a `Retry-After` header. Honour it instead of retrying in a loop. Proofs for deeply confirmed transactions are cached, so asking again for the same txid is cheap.

From `bitcoin-spv` (simulation fails with `Error(Contract, #N)`):

| Code | Name | Usual cause |
|---|---|---|
| 2 | `InsufficientConfirmations` | The block is shallower than `min_confirmations` |
| 3 | `ZeroMinConfirmations` | `min_confirmations` is 0 |
| 5 | `MerkleProofInvalid` | Wrong `tx_index`, siblings in display order, or a `raw_tx` with witness data |
| 7 | `EmptyTransaction` | `raw_tx` is empty |
| 15 | `AmbiguousTransactionLength` | `raw_tx` is exactly 64 bytes, never accepted |
| 22 | `HeaderNotFound` | The block is not in the light client: before the checkpoint (325,554), not a signet block, `block_hash` in display order, or mined in the last minutes and not submitted yet (check `get_best_tip`) |
| 23 | `NotOnBestChain` | The block was orphaned |
| 24 | `BlockNotAfterCheckpoint` | The block is the checkpoint or older |

Other frequent mistakes:

- **Witness data in `raw_tx`.** The contract hashes `raw_tx` to get the txid, so it must be the legacy (non-witness) serialization. The relayer's `raw_tx` already is.
- **Sending instead of simulating.** Reads need `--send=no` on the CLI (or `simulateTransaction` in the SDK); there is nothing to sign.
- **Generating bindings from source.** Use the deployed contract ID so the client matches what is on chain.

## Faucets and wallets

- **Stellar testnet XLM:** `stellar keys generate me --network testnet --fund`, or Friendbot in [Stellar Lab](https://lab.stellar.org) or in the Freighter wallet on testnet.
- **Test USDC:** add a trustline to `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, then swap testnet XLM for it in Freighter, or use [faucet.circle.com](https://faucet.circle.com) (Stellar Testnet). This is the USDC the Writz pool uses.
- **Bitcoin signet coins:** a signet wallet (Xverse and Sparrow support signet) and its `tb1q...` or `tb1p...` address, then the Writz faucet, no captcha:

  ```bash
  curl -X POST https://api.testnet.writz.xyz/faucet/signet \
    -H 'Content-Type: application/json' -d '{"address":"tb1q..."}'
  # {"txid":"...","address":"tb1q...","amountSats":20000,"feeSats":282,"explorerUrl":"https://mempool.space/signet/tx/..."}
  ```

  It pays a fixed 20,000 sats, enough for one deposit at the testnet minimum plus fees. One claim per address every 24 hours, up to 20 claims per IP per hour (so a workshop or a classroom on one network can onboard everyone in one session), and a daily cap of 300 claims across everyone. `GET /faucet/signet` shows whether it is on, the amount, the per-IP allowance and the claims left today. If it answers `faucet_empty` or `faucet_disabled`, use a public faucet such as [signetfaucet.com](https://signetfaucet.com) (captcha and per-address limit). The coins are unconfirmed when the call returns; wait for a block (about 10 minutes) before building a proof.
- **Explorers:** [mempool.space/signet](https://mempool.space/signet) for Bitcoin, [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet) for Stellar.

## Limits to know

- **Testnet and signet only.** Nothing here is on mainnet, and the contracts are not audited. Do not use real funds.
- **Signet trust.** Signet blocks are authorised by a signature the contract does not check, so on signet only one designated Writz account may submit headers. Proof-of-work and difficulty are still checked per header.
- **Shared relayer.** `api.testnet.writz.xyz` is one instance with no uptime guarantee. If it is down, build the proof yourself from any signet Esplora API (see `relayer/src/bitcoin/spv.ts` for the exact steps) and call the contract directly.

---

**Next:** [Bitcoin SPV SDK](/developers/spv-sdk) for the full `verify_transaction` reference, or [For AI Agents](/developers/for-ai-agents) to hand this to your coding agent.
