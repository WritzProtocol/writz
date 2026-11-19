# verify-bitcoin-tx

Proves a Bitcoin signet transaction against the Writz `bitcoin-spv` contract on Stellar testnet. Read-only: it simulates the calls, so it needs no keys, no account and no fees.

```bash
bun install
bun run start                      # default signet transaction, 6 confirmations
bun run start <signet txid> [n]    # your own transaction
```

What it does:

1. Reads the light client's best Bitcoin tip (`get_best_tip`).
2. Fetches a proof from `GET https://api.testnet.writz.xyz/spv-proof/:txid`.
3. Simulates `verify_transaction` with the proof's `sorobanArgs` and prints the result.

Expected output (heights and confirmations grow over time):

```text
bitcoin-spv best tip: { "chainwork": "1227834744", "hash": "3634ab59...14000000", "height": 331482 }
proof for 2936c058...59914b91: block 331477, index 1, 4 siblings
verify_transaction: {
  "block_hash": "ae4c51dcb8fc5e5210eade6cdb20cf8bcc3cd0c20d408ce2a98b0cbd05000000",
  "block_height": 331477,
  "confirmations": 6,
  "txid": "914b91598cd948d08f571dd5feb7e93efb9f17f56f545d6e92cf077b58c03629"
}
```

`txid` and `block_hash` come back in internal byte order, reversed from what explorers show.

Errors are printed as one line, for example `error: relayer 409: insufficient_confirmations ...` for a block that is too recent, `error: relayer 409: light_client_behind ...` for a block the light client has not synced yet (retry after about a minute), or `error: HostError: Error(Contract, #22)` for a block older than the light client's checkpoint at signet height 331,476. The full error table is in [Build on Writz](https://docs.writz.xyz/developers/integrate#common-errors).
