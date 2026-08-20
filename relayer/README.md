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

Returns `{"status":"ok",...}` - used by load balancers.

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port |
| `BITCOIN_NETWORK` | `mainnet` | `mainnet` or `signet` |
| `ESPLORA_URL` | Blockstream public endpoint | Override for a self-hosted node |
| `CORS_ORIGIN` | `*` | Allowed origin(s) - comma-separated or `*` |
| `DEFAULT_CONFIRMATIONS` | `6` | Used when caller omits the query param |
| `MAX_CONFIRMATIONS` | `20` | Hard cap on the confirmations param |
| `REQUEST_TIMEOUT_MS` | `10000` | Esplora request timeout in ms |

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

## Docker

Build from the **repo root** (the image needs `packages/commitment-tree/`
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
- **Base URL:** `https://writz-relayer-production.up.railway.app`
- **Health Check Endpoint:** `https://writz-relayer-production.up.railway.app/health`

### Connecting to the Relayer

To verify a Bitcoin transaction and submit the SPV proof to the Soroban contract, follow these steps in your frontend or client application:

#### 1. Fetch the SPV Proof from the Relayer

Send a `GET` request to the relayer with the transaction ID (`txid`) and the desired number of confirmations.

```typescript
const txid = "a107055a66ed43c7a0dfae05c061c88bb07e91d589db43e78de017deb409254f"; // your signet txid
const confirmations = 6;

const response = await fetch(`https://writz-relayer-production.up.railway.app/spv-proof/${txid}?confirmations=${confirmations}`);

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
const contractId = "CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP";
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

