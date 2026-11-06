---
title: "Testnet Runbook"
---

**Reproduce the Writz flow from a clean checkout.**

This is the operational companion to [Quick Start](/developers/quick-start). Quick Start
gets the test suites green; this runbook runs the protocol: the contracts on a local
Stellar network, and a full loan against Stellar testnet and Bitcoin Signet.

---

## What this covers, and what it cannot

The flow splits into two halves with very different reproducibility:

| Half | Covered how | Automated? |
|---|---|---|
| Soroban: deploy, register the lender as a `bitcoin-spv` consumer, supply, deposit, withdraw, and the attacks the contracts must refuse | `scripts/deploy/e2e_local.mjs` on a local Stellar network | Yes, scripted end to end and run in CI |
| Bitcoin and the rest of the loan: fund a P2WSH address, confirmations, real SPV proof, borrow, repay, co-signed release | Manual, through the testnet app | No, needs Signet coins and two browser wallets |

Be aware of what the scripted half does **not** prove: `e2e_local.mjs` builds a
**fabricated** Bitcoin transaction paying the depositor's Writz script and mines
easy-difficulty headers on top of a local checkpoint. The `bitcoin-spv`
contract genuinely verifies that header chain and Merkle inclusion, but no real
Bitcoin transaction is involved. It does not call `borrow`, `repay` or
`liquidate`, because those read the oracle; `writz-lend`'s unit tests cover them
against a mock oracle.

Treat the scripted run as proof that the **Soroban layer** works.
The Bitcoin custody path needs the manual walkthrough below.

---

## 1. Prerequisites

Versions below are the ones CI pins.

```bash
rustup target add wasm32v1-none
# stellar-cli 28.1.0 (brew install stellar-cli, or cargo install --locked stellar-cli)
node --version   # 22
bun --version    # 1.3.14
docker --version # for the local Stellar network
```

---

## 2. The Soroban half (scripted)

The contract Wasm files are gitignored, so a fresh clone has to build them first.

```bash
docker run -d --rm --name writz-local-stellar -p 8000:8000 \
  stellar/quickstart:latest --local --enable rpc
(cd contracts && cargo build --release --target wasm32v1-none --locked -p bitcoin-spv -p writz-lend)
(cd scripts/deploy && bun install --frozen-lockfile)
node scripts/deploy/e2e_local.mjs
```

The script refuses to run against anything but the local standalone network. Its settings differ from testnet on purpose:

| Setting | In `e2e_local.mjs` | Why |
|---|---|---|
| USDC | The native asset's contract stands in for USDC | No USDC issuer on a local network |
| Oracle | The admin address, never read | Only `borrow` and `liquidate` read it, and the script calls neither |
| Bitcoin transaction | **Fabricated** raw transaction in a locally mined header | No Signet wait |
| `min_confirmations` | `6`, against locally mined headers | The headers are mined at a trivial difficulty |
| `min_deposit_satoshis` | `100_000`, the mainnet value | The deposit is 1,000,000 sats |
| Lending pool | Supplied by the script | No other lenders on a local network |

---

## 3. The Bitcoin half (manual)

This part cannot be scripted: it needs Signet coins and two browser wallets. The
[Guides](/guides/start-here) walk through every screen; this section is the
short version for developers.

**You need:** [Xverse](https://www.xverse.app/) on Signet with at least 5,000 sats
(the testnet minimum deposit) from a public Signet faucet such as
[bitcoinsignetfaucet.com](https://bitcoinsignetfaucet.com), and
[Freighter](https://freighter.app/) on Stellar testnet, funded with Friendbot.

1. Use the hosted app at [testnet.writz.xyz](https://testnet.writz.xyz), or run it locally:
   ```bash
   cd frontend/app && cp .env.example .env.local
   # .env.example already carries the live testnet contract IDs.
   # Set NEXT_PUBLIC_RELAYER_URL=https://api.testnet.writz.xyz
   bun install && bun dev
   ```
   Use the hosted relayer. On Signet only the designated Writz account may submit
   headers to `bitcoin-spv`, and only the relayer holding the protocol key can
   co-sign releases, so a relayer you run yourself cannot complete a loan
   against the shared testnet contracts.

2. Open **Borrow** (`/borrow/new`), choose an amount, connect both wallets, and
   send the BTC to the deposit address the app shows. **Budget about 10 minutes
   per Signet confirmation**; testnet requires 1.

3. The app fetches the SPV proof from the relayer and registers the deposit on
   `writz-lend`, where `bitcoin-spv` verifies inclusion on chain. Then borrow.

4. Repay in full on the loan page. The relayer co-signs the release and
   publishes it on `writz-lend`; sign it in Xverse and the BTC returns to your
   wallet.

Watch both explorers: [mempool.space/signet](https://mempool.space/signet) and
[stellar.expert testnet](https://stellar.expert/explorer/testnet).

---

## 4. Troubleshooting

| Symptom | Cause |
|---|---|
| `jest.resetModules is not a function` in relayer tests | Ran `bun test` (Bun's runner). The relayer suite is Jest: use `bun run test`. |
| `Cannot find module` when the relayer starts or tests run | The local packages are not installed. Run `bun install && bun run build` in `bitcoin-script` and `bun install` in `packages/writz-lend` first. |
| `e2e_local.mjs` fails to fund accounts right after `docker run` | The quickstart image's Friendbot starts after RPC reports healthy. The script retries; if it still fails, wait and run it again. |
| `ENOENT` on a `.wasm` file | The contracts were not built. Run the `cargo build` line above. |

---

**Next:** [Contribution Guide](/developers/contribution-guide), [Contract Reference](/developers/contract-reference)
