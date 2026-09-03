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
| `DEFINDEX_API_KEY` | *(none)* | DeFindex API key (`sk_...`) from console.defindex.io |
| `DEFINDEX_API_URL` | `https://api.defindex.io` | DeFindex API base URL |
| `DEFINDEX_VAULT_ID` | *(none)* | Writz's own DeFindex vault contract ID - see `contracts/deployments/defindex-vault-testnet.md` |

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

