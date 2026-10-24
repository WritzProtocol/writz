# @writz/sdk

Prove Bitcoin transactions on Stellar and read the Writz lending pool, from the browser, Node or Bun.

- Network preset for Stellar testnet (contract IDs, RPC, passphrase, relayer), generated from the Writz deployment record
- Relayer client: `getSpvProof` with typed errors that honours `Retry-After`, and the Earn vault routes
- `bitcoin-spv` client: `verifyTransaction`, `getBestTip`, `getCheckpoint`, `getHeader`, `getCanonicalHash`
- `writz-lend` client: pool reads, and unsigned `supply_usdc` / `withdraw_supply` transactions for a wallet to sign

Testnet only (Bitcoin signet). The contracts are not audited. Do not use real funds.

## Quick start

```bash
npm install @writz/sdk     # or: bun add @writz/sdk
```

```ts
import { createWritzClient } from "@writz/sdk";

const writz = createWritzClient(); // Stellar testnet, Bitcoin signet

// Prove a signet transaction (txid as explorers show it). Read-only: no keys, no fees.
const { result } = await writz.verifyBitcoinTx(
  "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1",
);
console.log(result.blockHeight, result.confirmations);

// Read the lending pool.
const state = await writz.lend.getProtocolState();
console.log(state.totalBorrowed, await writz.lend.getSupplyRateBp());
```

## Proofs and errors

```ts
import { createWritzClient, ContractError, RelayerError } from "@writz/sdk";

const writz = createWritzClient();
try {
  const proof = await writz.relayer.getSpvProof(txid, { confirmations: 6 });
  const result = await writz.spv.verifyTransaction(proof.sorobanArgs);
  // result.txid and result.blockHash are internal byte order; result.txidDisplay is the explorer form.
} catch (err) {
  if (err instanceof RelayerError) err.code;      // "tx_not_found", "light_client_behind", "rate_limited", ...
  if (err instanceof ContractError) err.errorName; // "HeaderNotFound", "InsufficientConfirmations", ...
}
```

The relayer client retries a 409 `light_client_behind`, a 429 and a 503 after the wait the relayer asks for (`retryAfterSeconds` or `Retry-After`), up to `maxRetries` times (default 2, `0` turns it off), and never waits longer than `maxRetryWaitSeconds` (default 120). Every other error is thrown at once.

`verifyTransaction` proves inclusion and depth only. What the transaction paid, and to whom, is your check: parse `proof.rawTxNoWitness`, or do it on chain with the Rust crate `writz-spv-client`. Store the txids you accept; the contract verifies the same transaction for anyone.

## Lending pool writes

The SDK never signs. Writes come back as unsigned, simulated and assembled transactions (base64 XDR) for the user's wallet:

```ts
const xdr = await writz.lend.buildSupplyUsdc(address, 10_000_000n); // 1 USDC, 7 decimals
const signed = await wallet.signTransaction(xdr);                   // Freighter, Stellar Wallets Kit, ...
await writz.submit(signed);
```

`buildWithdrawSupply` works the same way. The Earn vault routes build their transactions on the relayer: `writz.relayer.buildEarnDeposit(address, amount)`, `buildEarnWithdraw`, `getEarnApy`, `getEarnPosition`.

## Configuration

```ts
import { BitcoinSpvClient, RelayerClient, testnet } from "@writz/sdk";

const spv = new BitcoinSpvClient({ network: testnet, rpcUrl: "https://your-rpc.example" });
const relayer = new RelayerClient({ network: testnet, maxRetries: 0 });
```

`testnet` holds the contract IDs of record. Writz contracts are never upgraded in place: a redeploy gets a new ID and a new release of this package. The record is [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md), also as [`testnet.json`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.json).

Docs: [Build on Writz](https://docs.writz.xyz/developers/integrate). License: Apache-2.0.
