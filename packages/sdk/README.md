# @writz/sdk

Verify Bitcoin transactions on Stellar and lend in the Writz pool, from the browser, Node or Bun.

- **Bitcoin verification.** Fetch an SPV proof for any signet transaction from the Writz relayer and check it against `bitcoin-spv`, the Bitcoin light client on Stellar: `verifyBitcoinTx`, `getSpvProof`, `verifyTransaction`, `getBestTip`, `getCheckpoint`, `getHeader`, `getCanonicalHash`.
- **Writz Lend.** Lend USDC to the pool and earn the supply rate paid by BTC-backed borrowers: unsigned `supply_usdc` and `withdraw_supply` transactions for a wallet to sign, the lender's balance with accrued interest, the supply and borrow rates, pool state, positions and health ratios.
- **Network preset.** Stellar testnet contract IDs, RPC, passphrase and relayer URL, generated from the Writz deployment record.
- Typed errors: relayer error codes with `Retry-After` handling, and contract error codes by name.

Testnet only (Bitcoin signet). The contracts are not audited. Do not use real funds.

## Install

```bash
npm install @writz/sdk     # or: bun add @writz/sdk
```

ESM only, with TypeScript types. Node 20 or later, Bun, and modern browsers.

## Verify a Bitcoin transaction

```ts
import { createWritzClient } from "@writz/sdk";

const writz = createWritzClient(); // Stellar testnet, Bitcoin signet

// A signet txid as explorers show it. Read-only: no keys, no fees.
const { proof, result } = await writz.verifyBitcoinTx(
  "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1",
);
console.log(result.blockHeight, result.confirmations);
```

`verifyBitcoinTx` asks the relayer for the proof (`GET /spv-proof/:txid`) and simulates `bitcoin-spv.verify_transaction` with it. The same two steps by hand, with error handling:

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

`verifyTransaction` proves inclusion and depth only. What the transaction paid, and to whom, is your check: parse `proof.rawTxNoWitness`, or do it on chain with the Rust crate [`writz-spv-client`](https://crates.io/crates/writz-spv-client). Store the txids you accept; the contract verifies the same transaction for anyone.

## Lend in Writz Lend

Lenders supply USDC to the `writz-lend` pool. Borrowers lock BTC on Bitcoin and borrow that USDC against it; the interest they pay accrues to lenders at the supply rate.

```ts
const rateBp = await writz.lend.getSupplyRateBp(); // annual, in basis points (500 is 5%)

const supply = await writz.lend.buildSupplyUsdc(address, 10_000_000n); // 1 USDC, 7 decimals
const signed = await wallet.signTransaction(supply);                   // Freighter, Stellar Wallets Kit, ...
await writz.submit(signed);

const balance = await writz.lend.getSupplyBalance(address); // supplied USDC plus accrued interest, in stroops
const withdraw = await writz.lend.buildWithdrawSupply(address, 5_000_000n); // 0.5 USDC back
```

The SDK never signs. Writes come back as simulated and assembled transactions (base64 XDR) for the user's wallet, and `writz.submit` sends the signed one and waits for it to land. The supplier needs a USDC trustline and the balance.

Pool and borrower reads:

| Method | Returns |
|---|---|
| `getProtocolState()` | Total supply (scaled) and supply index, total borrowed, reserve, borrow index |
| `getSupplyRateBp()`, `getBorrowRateBp()` | Annual rates in basis points |
| `getSupplyBalance(lender)` | A lender's USDC including accrued interest |
| `getPosition(txid)` | A loan by its BTC deposit txid (internal byte order), or `null` |
| `getHealthRatioBp(txid)` | Collateral to debt in basis points (liquidation at 12000) |

A failed call throws `ContractError` with the contract's code and name, from `WRITZ_LEND_ERRORS` and `SPV_ERRORS`.

## Configuration

```ts
import { BitcoinSpvClient, RelayerClient, WritzLendClient, testnet } from "@writz/sdk";

const spv = new BitcoinSpvClient({ network: testnet, rpcUrl: "https://your-rpc.example" });
const lend = new WritzLendClient({ network: testnet });
const relayer = new RelayerClient({ network: testnet, maxRetries: 0 });
```

`testnet` holds the contract IDs of record. Writz contracts are never upgraded in place: a redeploy gets a new ID and a new release of this package. The record is [`contracts/deployments/testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.md), also as [`testnet.json`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/testnet.json).

## Links

- Docs: [Build on Writz](https://docs.writz.xyz/developers/integrate)
- Source: [`packages/sdk`](https://github.com/WritzProtocol/writz/tree/main/packages/sdk)
- Issues: [github.com/WritzProtocol/writz/issues](https://github.com/WritzProtocol/writz/issues)

License: Apache-2.0.
