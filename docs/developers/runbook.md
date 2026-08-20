# Testnet Runbook

**Reproduce the full Writz flow from a clean checkout.**

This is the operational companion to [Quick Start](quick-start.md). Quick Start
gets the test suites green; this runbook gets the protocol *running* against
Soroban testnet and Bitcoin Signet.

---

## What this covers, and what it cannot

The flow splits into two halves with very different reproducibility:

| Half | Covered how | Automated? |
|---|---|---|
| Soroban + ZK: deploy → supply → deposit → insert commitment → borrow → repay | `scripts/deploy/e2e_zkflow.js`, real Groth16 proofs | Yes - scripted end to end |
| Bitcoin: fund a P2WSH address → confirmations → real SPV proof → co-signed release | Manual, through the frontend | No - needs Signet coins and two browser wallets |

Be aware of what the scripted half does **not** prove: `e2e_zkflow.js` builds a
**fabricated** Bitcoin transaction (`RAW_TX_HEX = '010000000000000000'`) and a
synthetic single-transaction block header. The `bitcoin-spv` contract genuinely
verifies that header chain and Merkle inclusion, but no real Bitcoin
transaction, and therefore no real deposit, is involved. It also passes an empty
`enc_note`, so the sealed recovery-note round trip (#18) is untested there.

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

The deployed `zk-verifier` (`CDV45GLX…`) holds the verification keys from the
**original** setup, whose `.zkey` files are not in git. So:

- **To test against the shared testnet contracts:** you need the original
  `.zkey` files. Ask a maintainer - regenerating will not reproduce them.
- **To work fully from a clean checkout:** regenerate the setup, deploy your own
  `zk-verifier`, push your keys to it, and point the flow at it:

  ```bash
  cd circuits && bash scripts/setup_dev.sh    # fresh keys (vkeys change!)
  cd ../scripts/deploy && node set_vkeys.js   # push to your own verifier
  ZK_VERIFIER_ID=<your-verifier> WRITZ_DEV_SECRET=<key> node e2e_zkflow.js
  ```

Proofs from a regenerated setup submitted to the shared verifier fail with
`InvalidZkProof` - that is a key mismatch, not a bug in your proof.

---

## 4. Run the scripted ZK flow

Get a funded testnet account:

```bash
# Any Stellar testnet key works; Friendbot funds it with 10,000 XLM
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
```

```bash
cd scripts/deploy
npm install
WRITZ_DEV_SECRET=<your-testnet-secret> node e2e_zkflow.js
```

The script deploys a **fresh** commitment-tree per run - it never touches the
production instance - then walks deposit → borrow → repay with real Groth16
proofs, printing a `stellar.expert` link per transaction.

Overridable via environment:

| Variable | Default | Use |
|---|---|---|
| `WRITZ_DEV_SECRET` | *(required)* | Funded testnet secret key |
| `ZK_VERIFIER_ID` | `CDV45GLX…` | Point at your own verifier after regenerating keys |
| `BITCOIN_SPV_ID` | `CAE5L7BO…` | Point at your own SPV contract |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Alternative RPC |
| `SEED_ONLY` | unset | Stop after `insert_commitment` and print the `NEXT_PUBLIC_*` values for `frontend/.env.local` - how you seed a funded pool plus one position for a frontend demo |

### Last verified run

2026-07-30, instance `CBM5OUBYBICB3QB4T5PAGYUWWLZOIVWQCUHKV3HCSNZGB72GYM5Q5ID4`,
six transactions, whole run about a minute:

```
initialize          aed32de63bcb4888defb564f703e01eb50907732ee10f2b966a9b286b675a034
supply_usdc         512b91d750d39bdcc196b2ec38266b6e9ffc5f0ebda4573bd1a4ac1c76936ffa
deposit      (ZK)   c3320d79f955ad35ad32ebae2d849024d6d69d597a0b355d8ec2ebb5e22f7e29
insert_commitment   9fbed23db3b91e2520cf54ab54f715284d700fb011c16d2b64d5e9fade2635bb
borrow       (ZK)   b7b83f750128df68b1cd2f91a375b6e5393d7daac764bba1fa87cf3484a6541a
repay        (ZK)   261d8b14ab83414b712a0ba8a817ccbc0a6b36de2ef03896ea986beecdb82f14
```

Full log in [`contracts/deployments/testnet.md`](../../contracts/deployments/testnet.md).
If your run diverges from these steps, § 7 lists the failures we hit getting here.

---

## 5. Testnet assumptions

The scripted flow is **not** a faithful mainnet rehearsal. What differs:

| Assumption | Value on testnet | Why |
|---|---|---|
| USDC | **XLM native SAC** (`CDLZFC3S…`) | Avoids needing Circle USDC faucet access. The production instance uses the real testnet USDC SAC (`CBIELTK6…`). |
| BTC price | Stubbed at **$60,000** (`600_000_000_000` stroops) | No live oracle wired on testnet; the oracle address is accepted but ignored. |
| Bitcoin transaction | **Fabricated** raw tx + synthetic header | Removes the ~10-minute Signet confirmation wait from the loop. |
| `min_confirmations` | `1` | Same reason. Production default is 6. |
| `min_deposit_satoshis` | `10_000` (0.0001 BTC) | Lowered so Signet faucet amounts are usable. **Hardcoded in `initialize`** - the deposit circuit binds it into a public signal, so the script's constant must match or deposit fails with `ProtocolParamMismatch`. |
| Lending pool | Pre-funded with 500 XLM by the script | No external suppliers on testnet. |
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
   Hosted alternative: `https://writz-relayer-production.up.railway.app`.

2. Start the frontend:
   ```bash
   cd frontend && cp .env.example .env.local
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

**Next:** [Contribution Guide →](contribution-guide.md) · [Contract Reference →](contract-reference.md)
