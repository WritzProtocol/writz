---
title: "For AI Agents"
description: "Compact, exact integration facts for AI coding agents: Writz testnet contract IDs, network passphrase, RPC URL, function signatures, the relayer proof route, verified examples, and what does not exist."
---

This page is written for AI coding agents (and the people who prompt them). Everything here is exact and was checked against Stellar testnet on 2026-10-23. If something you need is not on this page or in [Build on Writz](/developers/integrate), it probably does not exist: do not invent it.

Machine-readable entry points: [docs.writz.xyz/llms.txt](https://docs.writz.xyz/llms.txt) (index), [docs.writz.xyz/llms-full.txt](https://docs.writz.xyz/llms-full.txt) (all pages), and any page as Markdown by adding `.md` to its URL, for example [docs.writz.xyz/developers/for-ai-agents.md](https://docs.writz.xyz/developers/for-ai-agents.md).

**Prompt to give your agent:**

```text
Integrate Writz on Stellar testnet. Read https://docs.writz.xyz/developers/for-ai-agents.md
first and use only the contract IDs, signatures and endpoints it lists. The packages
@writz/sdk (npm) and writz-spv-client (crates.io) are release pending: do not install them
until they are published. The Bitcoin network is signet. Simulate reads, never sign them.
```

---

## Facts

```text
STELLAR_NETWORK        testnet
NETWORK_PASSPHRASE     Test SDF Network ; September 2015
SOROBAN_RPC_URL        https://soroban-testnet.stellar.org
BITCOIN_NETWORK        signet
RELAYER_URL            https://api.testnet.writz.xyz
BITCOIN_SPV_ID         CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP
WRITZ_LEND_ID          CAVAD3NGIJPDTFLBLJQ5FMLT6UNFE3UFOI3RTQVOVS5RWAD5EDVI5EX4
TEST_USDC_SAC          CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA   (USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, 7 decimals)
SPV_CHECKPOINT_HEIGHT  325554   (signet; only later blocks can be proven)
SOROBAN_SDK            soroban-sdk = "26"
```

Source of truth for IDs: [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md), machine-readable in [`contracts/deployments/testnet.json`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.json). The contracts are immutable; a new version gets a new ID there.

## Packages (release pending)

```text
NPM_PACKAGE     @writz/sdk         source packages/sdk                         NOT YET ON NPM
CRATE           writz-spv-client   source contracts/contracts/writz-spv-client NOT YET ON CRATES.IO
```

Until a package is on its registry, `npm install @writz/sdk` and `cargo add writz-spv-client` fail: generate code from the snippets on this page instead. Once published:

- `@writz/sdk`: `createWritzClient()` (testnet preset), `writz.verifyBitcoinTx(txid)`, `writz.relayer.getSpvProof(txid)` (throws `RelayerError` with `code`, `status`, `retryAfterSeconds`; retries 409 `light_client_behind`, 429 and 503 after `Retry-After`), `writz.spv.verifyTransaction(sorobanArgs)` (throws `ContractError` with `code`, `errorName`), `writz.lend.getProtocolState()`, `writz.lend.buildSupplyUsdc(address, stroops)` (unsigned XDR, the SDK never signs).
- `writz-spv-client`: `BitcoinSpvClient`, `SpvVerificationResult`, `SPVError`, `find_output_value(&raw_tx, &script_pubkey) -> Option<u64>`, `txid(&env, &raw_tx)`.

## Does not exist (do not generate code for it)

- No published npm package or crates.io crate yet: `@writz/sdk` and `writz-spv-client` are release pending (above). There is no `writz-sdk` and no other `@writz/...` package. Use `@stellar/stellar-sdk`, `stellar contract bindings typescript`, or the git dependency below.
- `verify_transaction` has **no** `headers` argument and its result has **no** `outputs` field.
- No Bitcoin mainnet, testnet3 or testnet4 verification. Signet only.
- No Writz contract on Stellar mainnet.
- No relayer route other than those listed below; no API keys; no webhooks.
- External contracts cannot call `bitcoin-spv.consume_deposit` (admin-registered consumers only).

---

## `bitcoin-spv` interface

```rust
// Main primitive. Read-only, no auth.
fn verify_transaction(block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32,
                      raw_tx: Bytes, min_confirmations: u32) -> Result<SpvVerificationResult, SPVError>;

fn get_best_tip() -> Option<BestTip>;                       // { hash: BytesN<32>, height: u32, chainwork: U256 }
fn get_header(block_hash: BytesN<32>) -> Option<HeaderEntry>;
    // { prev: BytesN<32>, merkle_root: BytesN<32>, height: u32, bits: u32, time: u32, period_start_time: u32, chainwork: U256 }
fn get_canonical_hash(height: u32) -> Option<BytesN<32>>;
fn get_checkpoint() -> Option<Checkpoint>;
fn is_deposit_consumed(txid: BytesN<32>) -> bool;

pub struct SpvVerificationResult {
    pub txid: BytesN<32>,       // SHA256d(raw_tx), INTERNAL byte order
    pub block_hash: BytesN<32>, // INTERNAL byte order
    pub block_height: u32,
    pub confirmations: u32,     // depth below the light client's tip, tip = 1
}
```

Rules: `block_hash` and every `merkle_proof` item in internal byte order (reverse of explorers); `raw_tx` without witness data, never exactly 64 bytes; `min_confirmations >= 1`. Inclusion only: to check amount and recipient, parse `raw_tx`. Store accepted txids yourself (replay protection).

Errors (`Error(Contract, #N)`): 2 InsufficientConfirmations, 3 ZeroMinConfirmations, 5 MerkleProofInvalid, 7 EmptyTransaction, 15 AmbiguousTransactionLength, 22 HeaderNotFound, 23 NotOnBestChain, 24 BlockNotAfterCheckpoint.

## `writz-lend` reads

```rust
fn get_protocol_state() -> ProtocolState;
    // { total_scaled_supply: i128, total_borrowed: i128, reserve_usdc: i128, supply_index: i128,
    //   borrow_index: i128, index_ledger: u32, last_keeper_heartbeat: u64 }
fn get_borrow_rate_bp() -> i128;                         // annual, basis points
fn get_supply_rate_bp() -> i128;                         // annual, basis points
fn get_supply_balance(lender: Address) -> i128;          // USDC stroops (7 decimals)
fn get_position(txid: BytesN<32>) -> Option<Position>;   // txid of the BTC deposit, internal order
fn get_health_ratio_bp(txid: BytesN<32>) -> Result<i128, WritzLendError>; // 15000 = 150%, liquidation at 12000
```

Indexes are scaled by 10^18. Generate a typed client from the deployed ID for anything else; the full list is in [Contract Reference](/developers/contract-reference).

## Relayer

```text
GET  /                                  service index (JSON)
GET  /health                            status
GET  /spv-proof/:txid?confirmations=N   proof for a confirmed signet tx; txid in DISPLAY order; N in 1..20, default 6
GET  /faucet/signet                     faucet status: enabled, amountSats, remainingToday, address
POST /faucet/signet  {"address":"tb1..."}   pays signet test BTC to a tb1q/tb1p address; returns { txid, amountSats, feeSats, explorerUrl }
```

`/spv-proof` 200 body: `{ txid, rawTxNoWitness, blockHash, txIndex, merkleProof[], headers[], blockHeight, confirmations, sorobanArgs: { block_hash, merkle_proof[], tx_index, raw_tx, min_confirmations } }`. Hex strings. `sorobanArgs` is already in internal byte order and maps one to one onto `verify_transaction`. Errors: 400 `invalid_txid` or `invalid_confirmations`, 404 `unconfirmed`, 404 `tx_not_found` (txid not on signet), 409 `insufficient_confirmations` (`requested`, `available`), 409 `light_client_behind` (block not yet in `bitcoin-spv`; calling the contract now fails with #22 or #2), 429 `rate_limited` (60 per minute per IP), 502 `upstream_error`, 503 `upstream_unavailable`. On 409, 429 and 503, wait `retryAfterSeconds` (body) or `Retry-After` (header) before retrying; never retry in a tight loop. CORS is open.

`/faucet/signet` is the way to get signet coins without a captcha: a fixed 20,000 sats per claim (one testnet deposit at the testnet minimum, plus fees), one claim per address and per IP every 24 hours, a daily cap across all callers. Only `tb1q...` and `tb1p...` addresses; `bc1` is refused. Errors: 400 `invalid_address`, 429 `address_cooldown`, `ip_cooldown`, `daily_cap_reached` or `rate_limited` (wait `retryAfterSeconds`; do not retry with another address or IP to get around it), 502 `broadcast_rejected`, 503 `faucet_disabled`, `faucet_empty` or `upstream_unavailable` (body lists `publicFaucets`). The payout is unconfirmed when the call returns; wait for confirmations before calling `/spv-proof`.

Earn vault (DeFindex; it holds Blend's test USDC, not `TEST_USDC_SAC`; rate limits 60 reads and 10 builds per minute per IP; errors are `{ error: "<message>" }`):

```text
GET  /defindex/apy                       { apy }  fraction, 0.0731 = 7.31%
GET  /defindex/position?address=G...     { dfTokens, underlyingStroops }  decimal strings
POST /defindex/deposit   { caller, amountStroops }   { xdr }  unsigned; the caller's wallet signs and submits
POST /defindex/withdraw  { caller, amountStroops }   { xdr }
```

The other routes the index lists (`/merkle-path`, `/notes`, `/insert-commitment`, `/update-leaf`, `/metrics/*`) serve the Writz app and are not an integration surface.

---

## Verified examples

**CLI** (simulation; the source account is any valid G address and is not charged):

```bash
SPV=CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP
READER=GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT
TXID=1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1
curl -s "https://api.testnet.writz.xyz/spv-proof/$TXID" > proof.json
stellar contract invoke --id $SPV --network testnet --source-account $READER --send=no -- \
  verify_transaction \
  --block_hash "$(jq -r .sorobanArgs.block_hash proof.json)" \
  --merkle_proof "$(jq -c .sorobanArgs.merkle_proof proof.json)" \
  --tx_index "$(jq -r .sorobanArgs.tx_index proof.json)" \
  --raw_tx "$(jq -r .sorobanArgs.raw_tx proof.json)" \
  --min_confirmations 6
# {"block_hash":"9e4d5092...0f000000","block_height":327600,"confirmations":70,"txid":"b118b7cc...547bef1f"}
```

**TypeScript** (`@stellar/stellar-sdk` 16.x, read-only):

```ts
import { Account, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const spv = new Contract("CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP");
const hex = (s: string) => Buffer.from(s, "hex");

const txid = "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1";
const a = (await (await fetch(`https://api.testnet.writz.xyz/spv-proof/${txid}`)).json()).sorobanArgs;

const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), {
  fee: BASE_FEE,
  networkPassphrase: "Test SDF Network ; September 2015",
})
  .addOperation(spv.call("verify_transaction",
    nativeToScVal(hex(a.block_hash)),
    xdr.ScVal.scvVec(a.merkle_proof.map((h: string) => nativeToScVal(hex(h)))),
    nativeToScVal(a.tx_index, { type: "u32" }),
    nativeToScVal(hex(a.raw_tx)),
    nativeToScVal(6, { type: "u32" })))
  .setTimeout(30)
  .build();

const sim = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error); // "...Error(Contract, #N)..."
console.log(scValToNative(sim.result!.retval)); // { txid, block_hash, block_height, confirmations }
```

Runnable: [`examples/verify-bitcoin-tx`](https://github.com/WritzProtocol/writz/tree/main/examples/verify-bitcoin-tx).

**Rust, cross-contract** (soroban-sdk 26):

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpvVerificationResult { pub txid: BytesN<32>, pub block_hash: BytesN<32>, pub block_height: u32, pub confirmations: u32 }

#[contractclient(name = "BitcoinSpvClient")]
pub trait BitcoinSpv {
    fn verify_transaction(env: Env, block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>,
                          tx_index: u32, raw_tx: Bytes, min_confirmations: u32) -> SpvVerificationResult;
}

let proof = match BitcoinSpvClient::new(&env, &spv_id)
    .try_verify_transaction(&block_hash, &merkle_proof, &tx_index, &raw_tx, &6)
{ Ok(Ok(r)) => r, _ => return Err(Error::ProofRejected) };

// Output check, with spv-types as a git dependency:
// spv-types = { git = "https://github.com/WritzProtocol/writz", rev = "0a1065991ee0498ad2c54367e0ffa69ca4a59a9a" }
let sats: Option<u64> = spv_types::btc_parser::find_p2wsh_output(&raw_tx, &expected_script_pubkey); // any script type
```

Complete contract with tests, deployed and run against testnet: [`examples/spv-payment-check`](https://github.com/WritzProtocol/writz/tree/main/examples/spv-payment-check).

---

## Checklist before you answer "it works"

1. `get_best_tip` returns a height near the signet tip on mempool.space.
2. The txid is a **signet** transaction with enough confirmations, in a block above 325,554.
3. You passed `sorobanArgs` through unchanged (no extra byte reversal).
4. You simulated reads (`--send=no`, `simulateTransaction`) and only signed real writes.
5. Your contract checks the output (amount and scriptPubKey) and stores the txid.
