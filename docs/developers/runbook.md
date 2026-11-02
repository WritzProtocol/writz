---
title: "Testnet Runbook"
---

**Reproduce the full Writz flow from a clean checkout.**

This is the operational companion to [Quick Start](/developers/quick-start). Quick Start
gets the test suites green; this runbook gets the protocol *running* against
Stellar testnet and Bitcoin Signet.

---

## What this covers, and what it cannot

The flow splits into two halves with very different reproducibility:

| Half | Covered how | Automated? |
|---|---|---|
| Soroban: deploy → supply → deposit → borrow → repay → release | `scripts/deploy/e2e_local.mjs` on a local Stellar network | Yes - scripted end to end, and run in CI |
| Bitcoin: fund a P2WSH address → confirmations → real SPV proof → co-signed release | Manual, through the frontend | No - needs Signet coins and two browser wallets |

Be aware of what the scripted half does **not** prove: `e2e_local.mjs` builds a
**fabricated** Bitcoin transaction paying the depositor's Writz script and mines
easy-difficulty headers on top of a local checkpoint. The `bitcoin-spv`
contract genuinely verifies that header chain and Merkle inclusion, but no real
Bitcoin transaction, and therefore no real deposit, is involved. It also passes
an empty `enc_note`, so the sealed recovery-note round trip (#18) is untested
there.

Treat the scripted run as proof that the **Soroban layer** works.
The Bitcoin custody path needs the manual walkthrough at the end.

---

## 1. Prerequisites

Versions below are the ones CI pins; anything older is untested.

```bash
rustup target add wasm32v1-none
cargo install stellar-cli --locked --version 27   
node --version   # >= 20
bun --version    # >= 1.1  (CI pins 1.3.14)
```

---

## 2. Build the artifacts a clean checkout lacks

These paths the scripts depend on are **gitignored**, so a fresh clone does
not have them:

| Path | In git? | Produced by |
|---|---|---|
| `contracts/target/wasm32v1-none/release/*.wasm` | No | `stellar contract build` |

```bash
cd contracts && stellar contract build
# → contracts/target/wasm32v1-none/release/writz_lend.wasm
```

---

## 3. Testnet assumptions

The scripted flow is **not** a faithful mainnet rehearsal. What differs:

| Assumption | Value on testnet | Why |
|---|---|---|
| USDC | **Native asset SAC** | Avoids needing Circle USDC faucet access. The production instance uses the real testnet USDC SAC (`CBIELTK6…`). |
| BTC price | Stubbed at **$60,000** (`600_000_000_000` stroops) | No live oracle wired on testnet; the oracle address is accepted but ignored. |
| Bitcoin transaction | **Fabricated** raw tx + synthetic header | Removes the ~10-minute Signet confirmation wait from the loop. |
| `min_confirmations` | `6`, against six locally mined headers | The headers are mined at a trivial difficulty, so confirmations cost nothing. |
| `min_deposit_satoshis` | `10_000` (0.0001 BTC) | Lowered so Signet faucet amounts are usable. |
| Lending pool | Pre-funded by the script | No external suppliers on a local network. |

---

## 4. The Bitcoin half (manual)

This part cannot be scripted - it needs Signet coins and two browser wallets.

**You need:** [Xverse](https://www.xverse.app/) on Signet with ≥ 0.0001 sBTC
(from a [Signet faucet](https://signetfaucet.com/)), and
[Freighter](https://freighter.app/) on Stellar testnet, funded via Friendbot.

1. Start the relayer, or point at the hosted one:
   ```bash
   cd relayer && cp .env.example .env   # set WRITZ_LEND_ID, ADMIN_SECRET
   bun install && bun start             # → http://localhost:3000
   ```
   Hosted alternative: `https://api.testnet.writz.xyz`.

2. Start the frontend:
   ```bash
   cd frontend/app && cp .env.example .env.local
   # .env.example already carries the live testnet contract IDs.
   # Set NEXT_PUBLIC_RELAYER_URL to your relayer (local or hosted).
   bun install && bun dev              # → http://localhost:3000
   ```

3. In the browser: connect Xverse + Freighter, derive the deposit P2WSH
   address, send sBTC to it, and wait for confirmations. **Budget ~10 minutes
   per Signet confirmation** - this is the slow step, and the reason the demo
   script pre-stages deposits.

4. Click **Deposit**. The relayer assembles the SPV bundle, `bitcoin-spv`
   verifies inclusion on-chain, and the browser generates the deposit proof
   locally.

5. Borrow, then repay in full. On full repayment the protocol co-signs the
   release PSBT; countersign in Xverse and broadcast. BTC returns to your
   wallet.

Watch both explorers: [mempool.space/signet](https://mempool.space/signet) and
[stellar.expert testnet](https://stellar.expert/explorer/testnet).

---

## 7. Troubleshooting

Errors seen while validating this runbook, and what they actually mean:

| Symptom | Cause |
|---|---|
| `Func(MismatchingParameterLen)` on `deposit` | Caller passes the pre-#18 argument list. `deposit`/`borrow`/`repay` all take a trailing `enc_note: Bytes`. |
| `Error(Contract, #11)` - `ProtocolParamMismatch` | The proof's `min_deposit_satoshis` public signal ≠ the contract's config (`10_000`). |
| `jest.resetModules is not a function` in relayer tests | Ran `bun test` (Bun's runner). The relayer suite is Jest - use `bun run test`. |
| `keys/*_vkey.json` show as modified | `setup_dev.sh` regenerated them. Expected; see § 3. |

---

**Next:** [Contribution Guide →](/developers/contribution-guide) · [Contract Reference →](/developers/contract-reference)
