# Examples

Small, runnable integrations against the Writz contracts on Stellar testnet. Each one was run against testnet before it was committed. CI typechecks `verify-bitcoin-tx` and tests and builds `spv-payment-check` on every change; a daily workflow runs `verify-bitcoin-tx` against testnet. Their READMEs say how to run them.

| Example | Stack | What it shows |
|---|---|---|
| [`verify-bitcoin-tx`](verify-bitcoin-tx) | Bun, TypeScript, `@stellar/stellar-sdk` | Fetch a proof for a signet transaction from the relayer and verify it with `bitcoin-spv`, read-only |
| [`spv-payment-check`](spv-payment-check) | Rust, `soroban-sdk` 26 | A Soroban contract that accepts a Bitcoin payment (amount and scriptPubKey) once per txid, by calling `bitcoin-spv` |

Walkthrough: [Build on Writz](https://docs.writz.xyz/developers/integrate).
