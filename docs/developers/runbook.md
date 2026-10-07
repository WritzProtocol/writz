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
| Soroban + ZK: deploy → supply → deposit → insert commitment → borrow → repay → release | `scripts/deploy/e2e_local.mjs` on a local Stellar network, real Groth16 proofs | Yes - scripted end to end, and run in CI |
| Bitcoin: fund a P2WSH address → confirmations → real SPV proof → co-signed release | Manual, through the frontend | No - needs Signet coins and two browser wallets |

Be aware of what the scripted half does **not** prove: `e2e_local.mjs` builds a
**fabricated** Bitcoin transaction paying the depositor's Writz script and mines
easy-difficulty headers on top of a local checkpoint. The `bitcoin-spv`
contract genuinely verifies that header chain and Merkle inclusion, but no real
Bitcoin transaction, and therefore no real deposit, is involved. It also passes
an empty `enc_note`, so the sealed recovery-note round trip (#18) is untested
there.

Treat the scripted run as proof that the **Soroban and ZK layers** work.
The Bitcoin custody path needs the manual walkthrough at the end.

---

## 1. Prerequisites

Versions below are the ones CI pins; anything older is untested.

```bash
rustup target add wasm32v1-none
cargo install stellar-cli --locked --version 27   # >= 27: needs crypto::bn254
node --version   # >= 20
bun --version    # >= 1.1  (CI pins 1.3.14)
```

`circom` **2.x is a Rust binary**. Do not `npm install -g circom` - that
installs the legacy 1.x package, which cannot compile `pragma circom 2.0.0`:

```bash
curl -fL -o ~/.local/bin/circom \
  https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64
chmod +x ~/.local/bin/circom     # macOS: circom-macos-amd64
circom --version                 # expect: circom compiler 2.2.3
```

`snarkjs` needs no global install - it is a dependency of `circuits/`.

---

## 2. Build the artifacts a clean checkout lacks

Four directories the scripts depend on are **gitignored**, so a fresh clone does
not have them:

| Path | In git? | Produced by |
|---|---|---|
| `circuits/build/` (r1cs + prover wasm) | No | `npm run compile` |
| `circuits/ptau/` (Powers of Tau) | No | `bash scripts/setup_dev.sh` |
| `circuits/keys/*.zkey` (proving keys) | No | `bash scripts/setup_dev.sh` |
| `circuits/keys/*_vkey.json` (verification keys) | **Yes** | committed; pushed on-chain by `set_vkeys.js` |
| `contracts/target/wasm32v1-none/release/*.wasm` | No | `stellar contract build` |

```bash
# ZK circuits
cd circuits
npm install
npm run compile          # → build/*.r1cs, build/*_js/*.wasm

# Soroban contracts → wasm
cd ../contracts/contracts/commitment-tree && make build
# → contracts/target/wasm32v1-none/release/commitment_tree.wasm
```

---

## 3. Trusted setup - read before running `setup_dev.sh`

`circuits/scripts/setup_dev.sh` generates the proving keys. It seeds its
entropy with `$(date)`:

```bash
snarkjs powersoftau contribute ... -e="writz dev entropy $(date)"
snarkjs zkey contribute        ... -e="writz dev $name entropy $(date)"
```

Two consequences that will otherwise cost you an afternoon:

1. **The setup is not reproducible.** Running it produces a *different*
   proving/verification key pair every time.
2. **It overwrites the committed `keys/*_vkey.json`.** Your working tree will
   show those four files as modified. Do not commit them unless you also intend
   to push the new keys on-chain.

The shared testnet `zk-verifier` holds the verification keys from the
**original** setup, whose `.zkey` files are not in git. Proofs from a
regenerated setup submitted to it fail with `InvalidZkProof` - that is a key
mismatch, not a bug in your proof. The scripted flow below avoids this by
deploying its own `zk-verifier` and registering whatever keys are in
`circuits/keys/`.

---

## 4. Run the scripted ZK flow

```bash
docker run -d --rm --name writz-local-stellar -p 8000:8000 \
  stellar/quickstart:latest --local --enable rpc
(cd scripts/deploy && bun install)
node scripts/deploy/e2e_local.mjs
```

It refuses to run against anything but the local standalone network. Each run
deploys fresh instances of all four contracts through their constructors, then
walks deposit → borrow → repay → release and replays the closed attacks:

| Attack | Expected error |
|---|---|
| Deposit claiming an output locked to another Bitcoin key | `VaultOutputNotFound` (#17) |
| Deposit whose timelock opens under 1,008 blocks after confirmation | `InvalidTimelock` (#21) |
| Deposit into a lender `bitcoin-spv` has not registered | `NotAConsumer` (#27) |
| The same txid deposited into the second lender | `TxidAlreadyConsumed` (#26) |
| A borrow proof resubmitted by another account | `RecipientMismatch` (#19) |
| Borrowing against a released zero-debt leaf | `NullifierAlreadySpent` (#6) |
| The admin inserting a root other than the proven one | `InvalidZkProof` (#4) |

To rehearse the real deployment against the same local network, run
`scripts/deploy/deploy_stack.mjs` with `STELLAR_NETWORK=local` (inputs in
`scripts/deploy/.env.example`).

---

## 5. Testnet assumptions

The scripted flow is **not** a faithful mainnet rehearsal. What differs:

| Assumption | Value on testnet | Why |
|---|---|---|
| USDC | **Native asset SAC** | Avoids needing Circle USDC faucet access. The production instance uses the real testnet USDC SAC (`CBIELTK6…`). |
| BTC price | Stubbed at **$60,000** (`600_000_000_000` stroops) | No live oracle wired on testnet; the oracle address is accepted but ignored. |
| Bitcoin transaction | **Fabricated** raw tx + synthetic header | Removes the ~10-minute Signet confirmation wait from the loop. |
| `min_confirmations` | `6`, against six locally mined headers | The headers are mined at a trivial difficulty, so confirmations cost nothing. |
| `min_deposit_satoshis` | `10_000` (0.0001 BTC) | Lowered so Signet faucet amounts are usable. **Hardcoded in the constructor** - the deposit circuit binds it into a public signal, so the script's constant must match or deposit fails with `ProtocolParamMismatch`. |
| Lending pool | Pre-funded by the script | No external suppliers on a local network. |
| Trusted setup | `pot15` dev ceremony, single contributor | A real multi-party ceremony is a mainnet gate. Never use these keys in production. |
| `enc_note` | Empty | The script exercises the interface, not the encryption round trip. |

---

## 6. The Bitcoin half (manual)

This part cannot be scripted - it needs Signet coins and two browser wallets.

**You need:** [Xverse](https://www.xverse.app/) on Signet with ≥ 0.0001 sBTC
(from a [Signet faucet](https://signetfaucet.com/)), and
[Freighter](https://freighter.app/) on Stellar testnet, funded via Friendbot.

1. Start the relayer, or point at the hosted one:
   ```bash
   cd relayer && cp .env.example .env   # set COMMITMENT_TREE_ID, ADMIN_SECRET
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
| `Error(Contract, #6)` - `InvalidZkProof` | Usually a trusted-setup mismatch: your `.zkey` does not correspond to the verifier's on-chain vkey. See § 3. |
| `jest.resetModules is not a function` in relayer tests | Ran `bun test` (Bun's runner). The relayer suite is Jest - use `bun run test`. |
| `circom` errors on `pragma circom 2.0.0` | circom 1.x from npm. Install the 2.x release binary - see § 1. |
| `keys/*_vkey.json` show as modified | `setup_dev.sh` regenerated them. Expected; see § 3. |

---

**Next:** [Contribution Guide →](/developers/contribution-guide) · [Contract Reference →](/developers/contract-reference)
