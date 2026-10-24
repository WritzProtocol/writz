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
bitcoin-spv best tip: { "chainwork": "431632794618", "hash": "2568d269...0f000000", "height": 327670 }
proof for 1fef7b54...ccb718b1: block 327600, index 1, 9 siblings
verify_transaction: {
  "block_hash": "9e4d5092aeb95f259afd73c770b9238bee9f300237de7a026150858e0f000000",
  "block_height": 327600,
  "confirmations": 71,
  "txid": "b118b7cc60c2bb03b3898f9bfb2605882251ff45ec9d71cce89a81a1547bef1f"
}
```

`txid` and `block_hash` come back in internal byte order, reversed from what explorers show.

Errors are printed as one line, for example `error: relayer 409: insufficient_confirmations ...` for a block that is too recent, `error: relayer 409: light_client_behind ...` for a block the light client has not synced yet (retry after about a minute), or `error: HostError: Error(Contract, #22)` for a block older than the light client's checkpoint at signet height 325,554. The full error table is in [Build on Writz](https://docs.writz.xyz/developers/integrate#common-errors).
