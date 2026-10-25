# Writz Relayer

Bitcoin SPV proof relayer for the Writz Protocol. Fetches transaction data from Esplora and assembles an SPV proof bundle ready for submission to the `bitcoin-spv` Soroban contract.

## API

### `GET /spv-proof/:txid`

Returns an SPV proof bundle for the given Bitcoin transaction ID.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `confirmations` | integer (1–20) | `6` | Minimum confirmations required |

**Responses**

| Status | `error` | Meaning |
|---|---|---|
| `200` | | Proof bundle returned |
| `400` | `invalid_txid`, `invalid_confirmations` | Invalid `txid` format or `confirmations` value |
| `404` | `unconfirmed` | Transaction is known but not in a block yet |
| `404` | `tx_not_found` | The Esplora indexer does not know this txid (typo, wrong network, or not broadcast yet) |
| `409` | `insufficient_confirmations` | Not enough Bitcoin confirmations yet (`requested`, `available`) |
| `409` | `light_client_behind` | The block is on Bitcoin, but `bitcoin-spv` does not hold it yet or not deep enough, so `verify_transaction` would fail with `HeaderNotFound` (#22) or `InsufficientConfirmations`. Body: `requested`, `available` (depth the light client can attest), `blockHeight`, `lightClientTipHeight`, `retryAfterSeconds`; also a `Retry-After` header. Retry after the next header-sync pass |
| `429` | `rate_limited` | Per-IP budget spent (`SPV_PROOF_RATE_LIMIT` per `SPV_PROOF_RATE_WINDOW_MS`). `retryAfterSeconds` and `Retry-After` say when to retry |
| `502` | `upstream_error` | Unexpected Esplora answer |
| `503` | `upstream_unavailable` | Esplora rate limited or unavailable after retries (and after the fallback host, when one is set). `retryAfterSeconds` and `Retry-After` say when to retry |

**Caching.** Proofs are cached in memory per `txid` and `confirmations`. A proof whose block is at least 6 deep below the Bitcoin tip is kept for `SPV_PROOF_CACHE_TTL_MS` (default 1 hour); a shallower proof, and the `unconfirmed`, `tx_not_found` and `insufficient_confirmations` answers, for 15 seconds. Upstream failures are never cached. Identical requests that arrive while a proof is being built share that one build. The light-client check runs on every request, cached or not, against the `bitcoin-spv` tip read at most every 5 seconds; it is skipped when `BITCOIN_SPV_ID` is unset or the read fails.

**200 body**

```json
{
  "txid": "...",
  "rawTxNoWitness": "...",
  "txIndex": 42,
  "merkleProof": ["..."],
  "headers": ["..."],
  "blockHeight": 800000,
  "confirmations": 6,
  "sorobanArgs": {
    "headers": ["..."],
    "merkle_proof": ["..."],
    "tx_index": 42,
    "raw_tx": "...",
    "min_confirmations": 6
  }
}
```

`sorobanArgs` is pre-formatted for direct use with the Stellar SDK / Soroban CLI.

### `GET /deposit-status/:txid`

Where a `writz-lend` deposit is, from the Bitcoin transaction to its registration on Stellar, for a deposit card to poll. `txid` is in display byte order, as explorers and wallets show it. Served only where lending is enabled, like `/spv-proof`.

**200 body**

```json
{
  "txid": "b7b74d273e9f5f210f97fec7374884e4800ea5f93aad64d5f86946867c2b8b6e",
  "stage": "verified",
  "confirmations": 155,
  "required": 1,
  "blockHeight": 327757,
  "proofReady": true,
  "lightClientTipHeight": 327911,
  "stellarTxHash": "020bdab6b5f8a576964b97b68c328e54ed5d0c0e572885ce8695fe8b18c6a6e6",
  "ledger": 5364245,
  "verifiedAt": "2026-10-24T12:26:52Z"
}
```

| `stage` | Meaning |
|---|---|
| `unseen` | The Esplora indexer does not know the txid: not broadcast yet, not propagated to it yet, or the wrong network |
| `mempool` | Broadcast, not in a block. `confirmations` is 0 |
| `confirming` | In a block, and either `confirmations < required`, or the confirmations are there but `bitcoin-spv` does not hold the confirming headers yet (`proofReady: false`; the header sync submits them every `SPV_SYNC_INTERVAL_MS`) |
| `ready` | `GET /spv-proof/:txid?confirmations=<required>` will serve a proof that `bitcoin-spv` can verify now. Nothing on Stellar has registered the deposit yet |
| `verified` | `writz-lend` registered the deposit. `stellarTxHash`, `ledger` and `verifiedAt` come from its `deposit` event |

- `required` is the deployment's minimum, `Config::min_confirmations` read from the `writz-lend` contract's storage (1 on the testnet deployment, 6 on mainnet), never a value configured in the relayer.
- `verified` comes only from Stellar: a `deposit` event for this txid, or the contract's `Position` entry for it. The confirmation count alone never makes a deposit verified. A deposit registered before Stellar RPC's event retention (about 7 days on testnet) is `verified` with `stellarTxHash`, `ledger` and `verifiedAt` null.
- There is no "submitted" stage. The deposit transaction is signed and submitted by the user's wallet, not by the relayer, and a failed call emits no event, so a pending or failed submission is not observable here.
- When the Bitcoin read fails for a deposit that is already verified, the answer is still `200 verified`, with `confirmations`, `blockHeight` and `proofReady` null.
- `lightClientTipHeight` is read only once Bitcoin has enough confirmations, and is null before that or when the read fails. When it cannot be read, `proofReady` follows the Bitcoin depth, as the proof route does.

**Errors**

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_txid` | `txid` is not 64 hex characters |
| `429` | `rate_limited` | Per-IP budget spent (`DEPOSIT_STATUS_RATE_LIMIT` per `DEPOSIT_STATUS_RATE_WINDOW_MS`) |
| `502` | `upstream_error` | Unexpected Esplora answer |
| `503` | `upstream_unavailable` | Esplora rate limited or unavailable, for a deposit not verified on Stellar |
| `503` | `stellar_unavailable` | Stellar RPC could not be read, so neither `required` nor the registration is known; no stage is guessed |
| `503` | `lending_not_configured` | `WRITZ_LEND_ID` is not set on this relayer |

`429` and the `503` answers carry `retryAfterSeconds` and a `Retry-After` header, except `lending_not_configured`.

**Caching.** One answer per txid is shared for 5 seconds; failures are never kept. The Stellar transaction is found through an in-memory index of `writz-lend` `deposit` events: it is built from the oldest ledger Stellar RPC retains when the relayer starts, then follows the tip from its cursor at most once every 5 seconds.

### `GET /defindex/apy`

Returns the Writz DeFindex vault's current APY, read live through `@defindex/sdk`.

**Responses**

| Status | Meaning |
|---|---|
| `200` | APY returned |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**200 body**

```json
{ "apy": 0.0721 }
```

`apy` is a fraction (`0.0721` = 7.21%), not a percentage - DeFindex's own API returns a percentage number, so this route converts it.

### `GET /defindex/position`

Returns a wallet's share of the Writz DeFindex vault.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `address` | Stellar `G...` public key | Required |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Position returned |
| `400` | Missing or malformed `address` |
| `404` | Vault or position not found upstream |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**200 body**

```json
{ "dfTokens": "12500000", "underlyingStroops": "12734512" }
```

Both fields are decimal strings of USDC stroops (7 decimals), never JSON numbers - a stroop amount above 2^53 loses precision as a double.

### `POST /defindex/deposit`

Builds an unsigned deposit transaction for the Writz DeFindex vault. The relayer never signs or
submits it - the connected wallet signs the returned XDR and the caller submits it to Soroban RPC
(non-custodial custody model, epic #101).

**Body**

| Field | Type | Description |
|---|---|---|
| `caller` | Stellar `G...` public key | Required. The depositor - also the transaction's source account. |
| `amountStroops` | decimal string | Required. USDC stroops (7 decimals) to deposit, as a positive integer string. |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Unsigned deposit XDR returned |
| `400` | Missing or malformed `caller` or `amountStroops` |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error, or DeFindex resolved without an XDR to sign (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**Example**

```bash
curl -X POST http://localhost:3000/defindex/deposit \
  -H 'Content-Type: application/json' \
  -d '{"caller":"GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT","amountStroops":"10000000"}'
```

**200 body**

```json
{ "xdr": "AAAAAgAAAAA..." }
```

The deposit is invested into the vault's strategies immediately (`invest: true`), matching
DeFindex's own documented deposit flow - it doesn't sit idle waiting on a manual rebalance.

### `POST /defindex/withdraw`

Builds an unsigned withdraw transaction for the Writz DeFindex vault. The relayer never signs or
submits it - the connected wallet signs the returned XDR and the caller submits it to Soroban RPC
(non-custodial custody model, epic #101).

**Body**

| Field | Type | Description |
|---|---|---|
| `caller` | Stellar `G...` public key | Required. The withdrawer - also the transaction's source account. |
| `amountStroops` | decimal string | Required. USDC stroops (7 decimals) to withdraw, as a positive integer string. A full withdrawal is simply an amount equal to the caller's current position (see `GET /defindex/position`); there is no separate "withdraw all" flag. |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Unsigned withdraw XDR returned |
| `400` | Missing or malformed `caller` or `amountStroops` |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error, or DeFindex resolved without an XDR to sign (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**Example**

```bash
curl -X POST http://localhost:3000/defindex/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"caller":"GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT","amountStroops":"5000000"}'
```

**200 body**

```json
{ "xdr": "AAAAAgAAAAA..." }
```

### `GET /metrics/tvl`

Returns the Writz DeFindex vault's total value locked and its unique depositor count. Backs the vault figures on the app's public `/protocol` page.

**Responses**

| Status | Meaning |
|---|---|
| `200` | Metrics returned |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error while reading the on-chain figure |

**200 body**

```json
{ "tvlStroops": "300199987", "onChainTvlStroops": "300310339", "uniqueDepositors": 4 }
```

- `tvlStroops` is net deposits minus withdrawals, summed from the vault events the relayer indexes. It needs no network call.
- `onChainTvlStroops` is the vault's live managed funds, read through `@defindex/sdk`. It includes the yield the strategy has accrued, so it is expected to sit slightly above `tvlStroops`. A gap larger than 20% of `tvlStroops` is logged as a warning rather than failing the request.
- `uniqueDepositors` counts distinct accounts that have ever deposited.

Both stroop fields are decimal strings (7 decimals), never JSON numbers.

### `GET /metrics/retention`

Returns 30-day retention cohorts for the vault, computed from the indexed events.

**200 body**

```json
{ "cohorts": [{ "cohort": "2026-09-02", "depositors": 1, "eligible": 0, "retained": 0 }] }
```

| Field | Meaning |
|---|---|
| `cohort` | UTC day of the depositors' first-ever deposit |
| `depositors` | Accounts whose first deposit fell on that day |
| `eligible` | Of those, how many have reached their 30-day mark. Younger depositors are too early to count as retained or churned, so they are left out |
| `retained` | Of the eligible, how many still held a positive net balance at their 30-day mark |

### `POST /faucet/signet`

Writz's own Bitcoin Signet faucet: pays a fixed amount of Signet test BTC (default 20,000 sats, enough for one deposit at the testnet minimum plus fees and a retry) from a relayer-held P2WPKH wallet. Mounted only on a Signet relayer that is not the mainnet target. Signet coins have no value.

**Request body:** `{ "address": "tb1q..." }`. Native SegWit Signet addresses only: `tb1q...` (P2WPKH, P2WSH) or `tb1p...` (Taproot). Mainnet (`bc1`), regtest (`bcrt1`), legacy and P2SH addresses are refused.

**200 body**

```json
{ "txid": "9a12...", "address": "tb1q...", "amountSats": 20000, "feeSats": 282, "explorerUrl": "https://mempool.space/signet/tx/9a12..." }
```

The transaction is unconfirmed when the call returns; Signet blocks come about every 10 minutes.

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_address` | Not a Signet native SegWit address |
| `400` | `faucet_address` | The faucet's own address |
| `429` | `address_cooldown` | This address already claimed within the cooldown (default 24 h) |
| `429` | `ip_cooldown` | This client IP used its allowance (default 20 claims per hour, sliding window); `retryAfterSeconds` is the time until its oldest claim leaves the window |
| `429` | `daily_cap_reached` | The faucet paid its daily maximum (default 300 claims); resets 00:00 UTC |
| `429` | `rate_limited` | Too many attempts from this IP (default 30 per 10 minutes) |
| `502` | `broadcast_rejected` | The Signet node refused the transaction |
| `503` | `faucet_disabled` | No faucet key configured, or switched off with `FAUCET_ENABLED=false` |
| `503` | `faucet_empty` | The faucet wallet cannot cover the amount plus fee |
| `503` | `upstream_unavailable` | Esplora unavailable (after retries and the fallback host) |

`429` and `503` answers carry `retryAfterSeconds` and a `Retry-After` header when a wait is known. `faucet_disabled`, `faucet_empty` and `upstream_unavailable` also list public Signet faucets in `publicFaucets`.

How it works: one send at a time (coin selection, signing and broadcast are serialized, and the outpoints a send spent are kept out of the next selection, so the faucet never double-spends its own coins); confirmed UTXOs first, largest first, then its own unconfirmed change; fee rate from Esplora's `/fee-estimates` for `FAUCET_FEE_TARGET_BLOCKS`, clamped to `[FAUCET_MIN_FEE_RATE, FAUCET_MAX_FEE_RATE]`; change back to the faucet address; broadcast through Esplora (`ESPLORA_URL`, then `ESPLORA_FALLBACK_URL`). Claims are stored in `data/faucet.db` (address, SHA-256 of the client IP, txid, amount, time), so the cooldown, the per-IP allowance and the daily count survive restarts when `/app/data` is a volume. The client IP is the one `TRUST_PROXY_HOPS` resolves (right-most `X-Forwarded-For` entry on Railway), so a caller cannot pick a new IP bucket by sending the header. The per-IP allowance is a count per window rather than one claim per day so that many people behind one IP (an event venue, a classroom) can be onboarded in one session; each of their addresses is still held to the 24 hour cooldown, and the daily cap bounds the total. A log warning `faucet_low_balance` fires when the balance covers fewer than 20 claims.

### `GET /faucet/signet`

Faucet status, for apps and for whoever refills it.

```json
{ "enabled": true, "network": "signet", "address": "tb1q...", "amountSats": 20000, "dailyCap": 300, "claimsToday": 3,
  "remainingToday": 297, "resetsAt": "2026-10-25T00:00:00.000Z", "cooldownHours": 24, "ipClaimsPerWindow": 20,
  "ipWindowHours": 1, "balanceSats": 1250000, "claimsLeftAtBalance": 61 }
```

`address` is the faucet wallet: send Signet coins there to refill it. `balanceSats` counts confirmed and unconfirmed coins and is `null` when Esplora is unavailable. Without a key the route answers `{ "enabled": false, "reason": "...", "publicFaucets": [...] }`.

#### Setting up the faucet key

The key is a dedicated Signet hot wallet, separate from `PROTOCOL_SIGNING_KEY` (the relayer refuses to start the faucet with the protocol key, refuses `FAUCET_SIGNET_WIF` unless `BITCOIN_NETWORK=signet`, and the mainnet target refuses to boot with it set). Generate it straight into the deployment's secrets so it is never printed or written to disk:

```bash
cd relayer
railway variables --service writz --set "FAUCET_SIGNET_WIF=$(bun scripts/faucet-keygen.ts --wif-only)"
```

After the redeploy, `GET /faucet/signet` shows the address to fund. Signet blocks are signed, so coins cannot be mined: fund the address from the public Signet faucets (claimed by hand, never by a script that defeats their captchas) or by a transfer from another Signet wallet. `bun run faucet:keygen` prints a key and its address instead, for local development.

### `GET /health`

Returns `{"status":"ok",...}` - used by load balancers.

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port |
| `BITCOIN_NETWORK` | `mainnet` | `mainnet` or `signet` |
| `ESPLORA_URL` | mempool.space for the network | Override for a self-hosted node |
| `ESPLORA_FALLBACK_URL` | *(unset)* | Second Esplora base URL for `/spv-proof`, used when the primary answers 429/5xx or is unreachable. Must serve the same Esplora API for the same network, e.g. `https://blockstream.info/signet/api` |
| `ESPLORA_RETRIES` | `2` | Retries per Esplora host on 429, 5xx and network errors for `/spv-proof` (backoff 250 ms, then doubling) |
| `TRUST_PROXY_HOPS` | `1` | Reverse-proxy hops trusted for the client IP (Express `trust proxy`). `1` matches Railway's edge; `0` disables |
| `SPV_PROOF_RATE_LIMIT` | `60` | Requests per client IP per window on `/spv-proof` |
| `SPV_PROOF_RATE_WINDOW_MS` | `60000` | Rate-limit window for `/spv-proof` |
| `SPV_PROOF_CACHE_MAX_ENTRIES` | `1000` | Proof cache size; least recently used entries are evicted first |
| `SPV_PROOF_CACHE_TTL_MS` | `3600000` | Lifetime of a cached proof whose block is at least 6 deep |
| `DEPOSIT_STATUS_RATE_LIMIT` | `120` | Requests per client IP per window on `/deposit-status` |
| `DEPOSIT_STATUS_RATE_WINDOW_MS` | `60000` | Rate-limit window for `/deposit-status` |
| `CORS_ORIGIN` | `*` | Allowed origin(s) - comma-separated or `*` |
| `DEFAULT_CONFIRMATIONS` | `6` | Used when caller omits the query param |
| `MAX_CONFIRMATIONS` | `20` | Hard cap on the confirmations param |
| `REQUEST_TIMEOUT_MS` | `10000` | Esplora request timeout in ms |
| `FAUCET_SIGNET_WIF` | *(unset)* | WIF of the Signet faucet's hot wallet. Unset: `/faucet/signet` answers `503 faucet_disabled`. Signet only, never the protocol key |
| `FAUCET_ENABLED` | `true` | `false` switches the faucet off without removing the key |
| `FAUCET_AMOUNT_SATS` | `20000` | Sats per claim; must be between 1,000 and 50,000 |
| `FAUCET_DAILY_CAP` | `300` | Claims per UTC day across all callers |
| `FAUCET_COOLDOWN_HOURS` | `24` | One claim per recipient address within this many hours |
| `FAUCET_IP_CLAIMS_PER_WINDOW` | `20` | Claims per client IP within `FAUCET_IP_WINDOW_HOURS` (sliding window) |
| `FAUCET_IP_WINDOW_HOURS` | `1` | Window for `FAUCET_IP_CLAIMS_PER_WINDOW` |
| `FAUCET_MIN_FEE_RATE` | `2` | Fee floor, sat/vbyte |
| `FAUCET_MAX_FEE_RATE` | `25` | Fee ceiling, sat/vbyte |
| `FAUCET_FEE_TARGET_BLOCKS` | `3` | Esplora fee-estimate target |
| `FAUCET_RATE_LIMIT` | `30` | POST attempts per client IP per window, successful or not |
| `FAUCET_RATE_WINDOW_MS` | `600000` | Window for `FAUCET_RATE_LIMIT` |
| `FAUCET_SQLITE_PATH` | `data/faucet.db` | Claim records (address cooldown, per-IP allowance, daily count) |
| `DEFINDEX_API_KEY` | *(none)* | DeFindex API key (`sk_...`) from console.defindex.io |
| `DEFINDEX_API_URL` | `https://api.defindex.io` | DeFindex API base URL |
| `DEFINDEX_VAULT_ID` | *(none)* | Writz's own DeFindex vault contract ID - see `contracts/deployments/defindex-vault-testnet.md` |
| `VAULT_WATCHER_POLL_INTERVAL_MS` | `30000` | How often the vault watcher polls for deposit/withdraw events |
| `EARN_E2E_SIGNER_SECRET` | *(none)* | Testnet `S...` key signing the Earn e2e cycle - see below |
| `EARN_E2E_AMOUNT_STROOPS` | `1000000` | Amount the Earn e2e cycle deposits then withdraws (0.1 USDC) |
| `EARN_E2E_REQUIRED` | *(unset)* | `1` makes the Earn e2e suite fail rather than skip when unconfigured |

## Running locally

```bash
cp .env.example .env
# edit .env - set BITCOIN_NETWORK=signet for development
bun install
bun run dev       # tsx watch (hot reload)
# or
bun run build && bun start
```

Test with a known signet txid:

```bash
curl http://localhost:3000/spv-proof/<txid>?confirmations=1
curl http://localhost:3000/health
```

## Testing

```bash
bun run test
```

Most of the suite is fast and deterministic - it mocks any external service
(Esplora, `@defindex/sdk`, etc.), so it runs the same everywhere with no
credentials required.

`test/defindex.integration.test.ts` is the one exception: it makes no mocks
and calls the real DeFindex API against the real deployed testnet vault (see
`contracts/deployments/defindex-vault-testnet.md` for its address) to prove
the reads
(`/apy`, `/position`) and both tx-building routes (`/deposit`, `/withdraw`,
including a real over-withdrawal rejection) actually work end to end, not
just that the Express layer is wired correctly. It requires
`DEFINDEX_API_KEY` and `DEFINDEX_VAULT_ID` to be set (e.g. a local `.env`);
if either is missing - as in CI today - every test in that file logs a
warning and passes trivially instead of failing, so `bun run test` stays
fast and network-independent unless you deliberately configure real
credentials.

### The Earn end-to-end cycle

`test/earn-cycle.e2e.test.ts` goes one step further than any other suite: it
**submits** transactions. The integration tests above prove the relayer builds
a well-formed envelope, but a well-formed envelope the network rejects still
passes them. The cycle test signs the built transaction with a test keypair,
submits it to Soroban RPC, polls it to `SUCCESS`, and then checks the position
the vault actually reports - deposit, balance and APY read back, withdraw.

It walks the same three-party split the browser does (`frontend/src/lib/flows/earn.ts`),
with a keypair standing in for the connected wallet. The relayer still never
signs anything; it only builds.

```bash
# Needs DEFINDEX_API_KEY, DEFINDEX_VAULT_ID and EARN_E2E_SIGNER_SECRET.
bun run test:e2e
```

The signer must be a **throwaway testnet account** holding XLM for fees and a
balance of the vault's underlying asset. Every run really spends
`EARN_E2E_AMOUNT_STROOPS` (0.1 USDC by default) and withdraws most of it back.

Unconfigured, it warns and returns like the integration suite, so `bun run test`
stays green anywhere and CI is unaffected. The cost of that default is that a
run which was *meant* to exercise the cycle can pass by silently skipping, so
`EARN_E2E_REQUIRED=1` turns missing configuration into a failure:

```bash
EARN_E2E_REQUIRED=1 bun run test:e2e
```

This suite is not wired into CI. It submits real transactions and spends a real
testnet balance, and it needs credentials that CI does not hold - so it is run
deliberately, by a person, not on every push.

## Docker

Build from the **repo root** (the image needs `privacy/packages/commitment-tree/`
and `bitcoin-script/`, which live outside `relayer/`):

```bash
docker build -f Dockerfile -t writz-relayer .
docker run --rm -p 3000:3000 \
  -e BITCOIN_NETWORK=signet \
  -e CORS_ORIGIN=https://writz.xyz \
  writz-relayer
```

Or with an env file:

```bash
docker run --rm -p 3000:3000 --env-file .env writz-relayer
```

## Deployment

The container listens on `PORT` (default `3000`). Set `CORS_ORIGIN` to your frontend URL in production:

```
CORS_ORIGIN=https://writz.xyz
```

For a public demo on signet:

```
BITCOIN_NETWORK=signet
CORS_ORIGIN=https://your-frontend.vercel.app
```

---

## Deployed Relayer Instance

The Writz SPV Proof Relayer is deployed on Railway for the **Bitcoin signet** network:
- **Base URL:** `https://api.testnet.writz.xyz`

  A domain this project controls, deliberately, rather than the hosting
  provider's own hostname. The origin is compiled into the frontend bundle at
  build time via `NEXT_PUBLIC_RELAYER_URL`, so a provider migration behind a
  provider-issued hostname would mean editing this repo and rebuilding the
  frontend; behind this one it is a DNS change. The subdomain is scoped to the
  deploy target for the same reason `WRITZ_ENV` exists: a mainnet relayer gets
  its own host and cannot inherit this one by omission.
- **Health Check Endpoint:** `https://api.testnet.writz.xyz/health`

### Connecting to the Relayer

To verify a Bitcoin transaction and submit the SPV proof to the Soroban contract, follow these steps in your frontend or client application:

#### 1. Fetch the SPV Proof from the Relayer

Send a `GET` request to the relayer with the transaction ID (`txid`) and the desired number of confirmations.

```typescript
const txid = "a107055a66ed43c7a0dfae05c061c88bb07e91d589db43e78de017deb409254f"; // your signet txid
const confirmations = 6;

const response = await fetch(`https://api.testnet.writz.xyz/spv-proof/${txid}?confirmations=${confirmations}`);

if (!response.ok) {
  const errorData = await response.json();
  console.error("Failed to fetch proof:", errorData.message);
  return;
}

const proofBundle = await response.json();
const { sorobanArgs } = proofBundle;
```

#### 2. Submit the SPV Proof to the Soroban Contract

Using the `@stellar/stellar-sdk`, format the values from `sorobanArgs` into Stellar/Soroban SCVals and submit them to your contract call (like the `deposit` function on the `CommitmentTree` contract or `verify_transaction` on the `BitcoinSPV` contract):

```typescript
import { Contract, xdr, Address, nativeToScVal } from "@stellar/stellar-sdk";

// Initialize contract instance
const contractId = "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM";
const commitmentTreeContract = new Contract(contractId);

// Format the arguments retrieved from the relayer
const headersScVal = xdr.ScVal.scvVec(
  sorobanArgs.headers.map((h: string) => xdr.ScVal.scvBytes(Buffer.from(h, "hex")))
);
const merkleProofScVal = xdr.ScVal.scvVec(
  sorobanArgs.merkle_proof.map((p: string) => xdr.ScVal.scvBytes(Buffer.from(p, "hex")))
);
const txIndexScVal = nativeToScVal(sorobanArgs.tx_index, { type: "u32" });
const rawTxScVal = xdr.ScVal.scvBytes(Buffer.from(sorobanArgs.raw_tx, "hex"));

// Prepare other parameters needed for Writz deposit (ZK Proof and Public Signals)
const zkProofScVal = ...; // Your generated ZK Proof ScVal
const publicSignalsScVal = ...; // Your public signals ScVal
const depositorScVal = nativeToScVal(Address.fromString(depositorAddress));

// Call the deposit function
const tx = await commitmentTreeContract.call(
  "deposit",
  depositorScVal,
  headersScVal,
  merkleProofScVal,
  txIndexScVal,
  rawTxScVal,
  zkProofScVal,
  publicSignalsScVal
);

// Sign and submit transaction to Soroban network...
```

