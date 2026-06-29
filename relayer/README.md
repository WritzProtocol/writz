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

| Status | Meaning |
|---|---|
| `200` | Proof bundle returned |
| `400` | Invalid `txid` format or `confirmations` value |
| `404` | Transaction not yet confirmed |
| `409` | Not enough confirmations yet (`available` field shows current count) |
| `502` | Upstream Esplora error |

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

### `GET /health`

Returns `{"status":"ok",...}` — used by load balancers.

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port |
| `BITCOIN_NETWORK` | `mainnet` | `mainnet` or `signet` |
| `ESPLORA_URL` | Blockstream public endpoint | Override for a self-hosted node |
| `CORS_ORIGIN` | `*` | Allowed origin(s) — comma-separated or `*` |
| `DEFAULT_CONFIRMATIONS` | `6` | Used when caller omits the query param |
| `MAX_CONFIRMATIONS` | `20` | Hard cap on the confirmations param |
| `REQUEST_TIMEOUT_MS` | `10000` | Esplora request timeout in ms |

## Running locally

```bash
cp .env.example .env
# edit .env — set BITCOIN_NETWORK=signet for development
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

## Docker

Build and run:

```bash
docker build -t writz-relayer .
docker run --rm -p 3000:3000 \
  -e BITCOIN_NETWORK=signet \
  -e CORS_ORIGIN=https://app.writz.io \
  writz-relayer
```

Or with an env file:

```bash
docker run --rm -p 3000:3000 --env-file .env writz-relayer
```

## Deployment

The container listens on `PORT` (default `3000`). Set `CORS_ORIGIN` to your frontend URL in production:

```
CORS_ORIGIN=https://app.writz.io
```

For a public demo on signet:

```
BITCOIN_NETWORK=signet
CORS_ORIGIN=https://your-frontend.vercel.app
```
