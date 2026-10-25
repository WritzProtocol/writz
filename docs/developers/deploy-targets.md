# Deploy Targets

**Audience:** whoever operates the Writz deployments. **When to use:** provisioning, changing, or auditing a deploy target's configuration.

Writz runs the same two applications - the Next.js app in `frontend/app` and the relayer - once per network. A *deploy target* is one such pairing plus the domain it answers on. The targets never share configuration, and this page is the contract that says so.

| Target | Frontend origin | Stellar network | Bitcoin network | Status |
|---|---|---|---|---|
| `local` | `http://localhost:3000` | Testnet | Signet | Developer machines. Validates nothing. |
| `testnet` | `testnet.writz.xyz` | Testnet | Signet | Live. Earn plus the existing dashboard. |
| `mainnet` | `app.writz.xyz` | Public | Mainnet | Earn only (#122). Lending stays off until the audit. |

The apex `writz.xyz` serves the marketing site and press page from a separate Next.js app, `frontend/landing`. It is not a deploy target in this sense: it has no chain configuration and never reads `NEXT_PUBLIC_WRITZ_ENV`. Its only link to a target is `NEXT_PUBLIC_APP_URL`, where its "Launch App" buttons point.

---

## Why targets are declared rather than inferred

Both applications read flat, independently-set environment variables. Nothing in that shape prevents a mainnet deployment from running with testnet contract addresses, the testnet Soroban RPC, the testnet vault, or the Earn mock left switched on - and none of those mistakes announce themselves. The realistic failure is not a typo; it is a **copy**: cloning the testnet service to create the mainnet one and changing nine of the twelve variables.

So each target declares itself, and the declaration is checked against everything around it:

- **Frontend** - `NEXT_PUBLIC_WRITZ_ENV`, validated at build time in [`frontend/app/src/config/target.ts`](https://github.com/WritzProtocol/writz/blob/main/frontend/app/src/config/target.ts). A contradiction fails the build.
- **Relayer** - `WRITZ_ENV`, validated at startup in [`relayer/src/deploy-target.ts`](https://github.com/WritzProtocol/writz/blob/main/relayer/src/deploy-target.ts). A contradiction refuses to boot, before anything binds a port.

Both report every conflict at once rather than one per failed attempt, because these values are edited on a hosting dashboard where a one-variable-per-build loop is miserable.

Leaving the variable unset means `local` and validates nothing. That is deliberate: a developer running `bun run dev` against a scratch env file is not who this protects.

### What each target enforces

| Rule | `testnet` | `mainnet` |
|---|---|---|
| Stellar network passphrase must match the target | yes | yes |
| Bitcoin network must match the target (relayer) | signet | mainnet |
| `DEFINDEX_VAULT_ID` must be set (relayer) | yes | yes |
| Soroban RPC must not be a test endpoint | - | yes |
| Earn settings set: `NEXT_PUBLIC_EARN_ASSET_ISSUER`, `NEXT_PUBLIC_EARN_VAULT_ID` (frontend) | - | yes |
| Lending settings unset: lending contract ids, `NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY` (frontend) | - | yes |
| `NEXT_PUBLIC_HORIZON_URL` set and not a test network (frontend) | - | yes |
| `NEXT_PUBLIC_RELAYER_URL` set, https, and not a test deployment (frontend) | - | yes |
| Earn mock forbidden (frontend) | - | yes |
| No signing key or lending setting: `KMS_KEY_ID`, `PROTOCOL_SIGNING_KEY`, `ADMIN_SECRET`, `RELAYER_SECRET`, `COMMITMENT_TREE_ID`, `WRITZ_LEND_ID`, `BITCOIN_SPV_ID`, `FAUCET_SIGNET_WIF`, `CCTP_RELAY_EVM_KEY`, `POLLAR_SECRET_KEY` all unset (relayer) | - | yes |
| `CORS_ORIGIN` must name explicit origins, not `*` (relayer) | - | yes |

Testnet is deliberately looser. It is allowed to run with the Earn mock and with pieces still missing while the epic is being built out; mainnet is allowed to inherit nothing by omission.

---

## Provisioning `testnet.writz.xyz`

Steps 1 and 2 are dashboard and registrar actions - they cannot be done from this repository.

### 1. Frontend (Vercel)

1. Create a Vercel project from this repository, separate from the one serving the apex domain. Root directory `frontend/app`; framework preset Next.js. The Ignored Build Step lives in `frontend/app/vercel.json` and takes precedence over the dashboard setting, so a push that only touches the landing does not rebuild this project. It is `git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- . 2>/dev/null && exit 0 || exit 1`. The `|| exit 1` matters: Vercel only understands exit 0 (skip) and exit 1 (build), and `VERCEL_GIT_PREVIOUS_SHA` is the last commit this project deployed, which a shallow clone may not contain. Without it, `git diff` fails with `bad object` (exit 128) and the deployment errors instead of building.
2. Under **Settings → Domains**, add `testnet.writz.xyz`.
3. Under **Settings → Environment Variables**, set the target's variables for the Production environment. At minimum:

   ```
   NEXT_PUBLIC_WRITZ_ENV=testnet
   NEXT_PUBLIC_SITE_URL=https://testnet.writz.xyz
   NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
   NEXT_PUBLIC_RELAYER_URL=<the testnet relayer's origin>
   ```

   plus the contract addresses from [`frontend/app/.env.example`](https://github.com/WritzProtocol/writz/blob/main/frontend/app/.env.example), which tracks the current testnet deployment. Never copy these into the mainnet project.

   The app holds no signing key: the protocol's co-signature on a release comes from the relayer (section 3). `NEXT_PUBLIC_POLLAR_API_KEY` enables email, Google and GitHub sign-in through Pollar; add `https://testnet.writz.xyz` to the app's allowed domains in the Pollar dashboard, or login fails on this domain.

4. Set the production branch to `main`. Pushes to `main` then deploy to `testnet.writz.xyz`; pull requests get preview URLs, which build with the same `testnet` target.

Builds outside `mainnet` serve a `robots.txt` that disallows everything and a `noindex` meta tag, so the testnet app never competes with the landing in search results.

### 2. DNS

At the registrar for `writz.xyz`, add one record per service. Vercel and the
relayer's host each show their own CNAME target:

| Type | Name | Value |
|---|---|---|
| CNAME | `testnet` | `cname.vercel-dns.com` |
| CNAME | `api.testnet` | the target the relayer's host shows for its custom domain |

The relayer gets a domain this project controls rather than being addressed at
its hosting provider's hostname. `NEXT_PUBLIC_RELAYER_URL` is compiled into the
frontend bundle at build time, so behind a provider-issued hostname a migration
means editing the repo and rebuilding the frontend, while behind this one it is
a DNS change. This is not hypothetical: the previously advertised
`*.up.railway.app` origin went dead when the account paying for it lapsed, and
every reference to it in the repo had to be rewritten.

The subdomain is scoped to the deploy target on purpose, for the same reason
`WRITZ_ENV` exists. A single `relayer.writz.xyz` would invite a mainnet relayer
to inherit the testnet host by omission, which is the exact class of mistake
target validation was added to prevent.

Leave the apex `writz.xyz` records untouched - they serve the marketing site. Do not create `app.writz.xyz` yet; it is reserved for Milestone 2 and an unconfigured host answering on it is worse than one that does not resolve.

Verify:

```bash
dig +short testnet.writz.xyz
curl -sI https://testnet.writz.xyz | head -1
```

### 3. Relayer (Railway)

The relayer's own service for this target needs, in addition to what [`relayer/.env.example`](https://github.com/WritzProtocol/writz/blob/main/relayer/.env.example) documents:

```
WRITZ_ENV=testnet
BITCOIN_NETWORK=signet
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CORS_ORIGIN=https://testnet.writz.xyz
DEFINDEX_VAULT_ID=<the testnet vault, from contracts/deployments/defindex-vault-testnet.md>
DEFINDEX_API_KEY=<from console.defindex.io>
WRITZ_LEND_ID=<the current writz-lend, from contracts/deployments/testnet.md>
RELAYER_SECRET=<the account writz-lend names as its relayer>
KMS_KEY_ID=<the protocol co-signing key> plus AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION
FAUCET_SIGNET_WIF=<the Signet faucet's own key, see relayer/README.md>
POLLAR_SECRET_KEY=<a sec_testnet_ secret key of the testnet app, Pollar dashboard, Build > API Keys>
POLLAR_APPLICATION_ID=<the same app's App ID, Pollar dashboard, Settings>
```

The last three run the Signet faucet, which funds only accounts created through the testnet app's social login (one claim per Pollar account, Stellar address and Signet address). The relayer checks each claim's Pollar access token with Pollar's Server API, so without `POLLAR_SECRET_KEY` and `POLLAR_APPLICATION_ID` the faucet stays off (`503 faucet_disabled`); it never falls back to paying any address. The relayer refuses to start with a `sec_mainnet_` key, and the mainnet target refuses `POLLAR_SECRET_KEY` altogether.

`RELAYER_SECRET`, `KMS_KEY_ID` and the AWS credentials run the repay watcher, which co-signs every release after a full repayment and publishes it on `writz-lend`. Without them the relayer logs `auto-cosign watcher disabled` at startup and no testnet position can release its BTC. On testnet `PROTOCOL_SIGNING_KEY` (a WIF) can stand in for `KMS_KEY_ID`; the mainnet target refuses both while it serves Earn only. The key must be the one whose public key `writz-lend` was deployed with. The watcher starts from the latest ledger the first time it runs, so a position repaid before it was configured needs a manual backfill (`relayer-backfill-runbook.md`).

`DEFINDEX_VAULT_ID` is the piece this issue is really about: it is per-network, has no safe default, and a relayer without it serves errors from every `/defindex` route. The testnet vault address lives in [`contracts/deployments/defindex-vault-testnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/defindex-vault-testnet.md) rather than being repeated here, so there is one place to change when it is redeployed.

#### Persistence: mount a volume, or the metrics history is lost on every deploy

The relayer keeps eight SQLite databases on local disk:

| File | Written by | What is lost without it |
|---|---|---|
| `data/merkle.db` | `leaf-store.ts` | Merkle leaves |
| `data/watcher.db` | `repay-watcher/cursor-store.ts` | The repay watcher's cursor |
| `data/vault-events.db` | `vault-watcher/event-store.ts` | **Every indexed vault deposit and withdrawal** |
| `data/vault-watcher.db` | `vault-watcher/cursor-store.ts` | The vault watcher's cursor |
| `data/tree-watcher.db` | `tree-watcher/cursor-store.ts` | The tree watcher's cursor |
| `data/tree-events.db` | `tree-watcher/event-archive.ts` | **Every `insert_leaf`, `borrow` and `repay` the commitment tree emitted** |
| `data/faucet.db` | `faucet/sqlite-store.ts` | Signet faucet claims: the one-claim-per-account rule and the daily count reset, so every social-login account could claim again (testnet only) |
| `data/cctp-relay.db` | `cctp/sqlite-store.ts` | CCTP relay records: past transfers and their Base Sepolia mint hashes; the daily mint count resets (testnet only) |

The container image declares no `VOLUME`, so on a fresh service that directory is ephemeral and every redeploy starts empty.

Most of these are recoverable. `vault-events.db` and `tree-events.db` are not. Soroban RPC retains events for days, not indefinitely (see `relayer-backfill-runbook.md`), and this database is the only durable record beyond that window. The metrics deliverable reports 30-day retention cohorts, which is longer than RPC will serve. Lose the file after the window closes and the history cannot be rebuilt from chain at all. `tree-events.db` is the same for the commitment tree: it is the only record that lets a fresh relayer replay the tree's history and check each step against its root once RPC has dropped the events (#264). It only covers history from the moment it was first created, and the tree watcher logs a warning at startup when it is empty but the leaf store is not. `bun run check:tree-archive` in `relayer/` compares it with RPC while its first ledger is still in retention.

If `merkle.db` is lost or wrong, `bun run rebuild-tree` in `relayer/` rebuilds the leaves and notes from the tree's events (#265). It replays them from an empty tree with the same root check the tree watcher applies, then requires the result to match the contract's `MerkleRoot` and `NextLeafIndex` at the ledger the replay ended on. Only after that does it swap the result in and point the tree watcher's cursor just after the last event it applied. Any failure exits non-zero, names the event that broke the replay, and leaves the live store as it was.

- `--source rpc` (the default) replays RPC events from `--from-ledger`, or from `COMMITMENT_TREE_DEPLOY_LEDGER`, or else from the oldest ledger RPC still has. It refuses a start ledger outside RPC's event retention.
- `--source archive --archive-db <file>` replays a `tree-events.db`, then RPC for what came after it.
- `--dry-run` runs every check and swaps nothing.

Stop the relayer before a swap: the command takes the tree lock of its own process only, so a tree watcher running in another process could write back the store it read before the swap.

**Mount a persistent volume at `/app/data`.** All eight paths are overridable if the platform mounts elsewhere: `SQLITE_PATH`, `WATCHER_SQLITE_PATH`, `VAULT_EVENTS_SQLITE_PATH`, `VAULT_WATCHER_SQLITE_PATH`, `TREE_WATCHER_SQLITE_PATH`, `TREE_EVENTS_SQLITE_PATH`, `FAUCET_SQLITE_PATH`, `CCTP_RELAY_SQLITE_PATH`.

Both watchers are always-on polling loops started in `src/index.ts`, not request-driven handlers. A platform that suspends the container when idle produces silent gaps in the same data, so scale-to-zero tiers are not suitable regardless of the volume.

#### After the first deploy: rewind the cursor to capture existing history

`runVaultPollCycle` starts a first-ever run from the current ledger tip rather than backfilling, which is deliberate (a gap here undercounts metrics, it does not risk funds). The consequence is that a newly deployed relayer indexes nothing that happened before it booted.

If vault activity predates the deployment and should appear in the metrics, rewind once after the service is healthy. `insertVaultEvent` is idempotent, with a UNIQUE constraint across tx hash, depositor, kind and amount, so a re-scan cannot double count:

```bash
# The oldest ledger you want indexed, from the vault's transaction history on a
# Stellar explorer. cursorForLedger builds the cursor: an RPC events cursor is
# a 19-digit zero-padded TOID plus a 10-digit index, not "<ledger>-<index>",
# and a hand-written one is rejected by the RPC in a way that stalls the
# watcher silently. `writeCursor` refuses a malformed cursor rather than
# storing it, so a mistake here fails at the command instead of at the next
# poll.
bun -e 'import {writeCursor} from "./src/vault-watcher/cursor-store.js"; import {cursorForLedger} from "./src/rpc-cursor.js"; writeCursor(cursorForLedger(<ledger>))'
```

Events arrive over several poll cycles rather than all at once: the RPC bounds
the ledger span it will scan per call, so the poller walks forward in batches,
persisting the cursor after each. Watch the count climb rather than expecting
the final number on the first check.

Do this while the events are still inside RPC's retention window. After that, only a deep-history source such as Hubble can recover them.

Confirm the running service is the target you think it is:

```bash
curl -s https://<relayer-origin>/health
# {"status":"ok","service":"writz-relayer","target":"testnet","bitcoinNetwork":"signet",...}
```

A `target` of `local` in that response means `WRITZ_ENV` was never set on the service, and none of the checks above ran.

---

## Provisioning `writz.xyz` (landing)

The existing Vercel project for the apex domain serves `frontend/landing`:

1. Root directory `frontend/landing`; framework preset Next.js; the same Ignored Build Step as above.
2. Environment variables, from [`frontend/landing/.env.example`](https://github.com/WritzProtocol/writz/blob/main/frontend/landing/.env.example):

   ```
   NEXT_PUBLIC_SITE_URL=https://writz.xyz
   NEXT_PUBLIC_APP_URL=https://testnet.writz.xyz
   NEXT_PUBLIC_UMAMI_WEBSITE_ID=<the Umami website ID>
   ```

   No RPC, contract, relayer or signing variables. The landing bundle carries no chain code.
3. Domains `writz.xyz` and `www.writz.xyz`.

Change the root directory in the same window the landing split reaches `main`. Before that, `frontend/landing` does not exist on `main` and the production build fails; after it, the old root directory has no `package.json`.

When mainnet goes live, `NEXT_PUBLIC_APP_URL` moves to `https://app.writz.xyz`.

---

## Provisioning `app.writz.xyz` (mainnet, Earn only)

Mainnet serves Earn alone (#122). Lending is a property of the target, not a variable: on `mainnet`, `lendingEnabled()` is false in both apps, so

- the app's `proxy.ts` answers 404 on `/borrow`, `/loans`, `/lend`, `/help/reclaim`, `/dev` and `/api/cosign`, and sends `/` to `/earn`;
- the relayer mounts no SPV, Merkle or insertion routes and starts neither the header sync nor the repay watcher;
- both refuse to start with any lending setting or signing key present, so the mainnet services hold no Bitcoin or admin key at all.

Turning lending on is a reviewed code change after the audit, not a dashboard edit.

Use a **new** Vercel project (root directory `frontend/app`, the same code as testnet) and a **new** Railway service with its own volume. Do not clone the testnet ones: cloning is the failure this mechanism exists to catch. A copied testnet configuration fails the build or the boot with the full list of what is wrong.

### Frontend (Vercel, new project)

```
NEXT_PUBLIC_WRITZ_ENV=mainnet
NEXT_PUBLIC_SITE_URL=https://app.writz.xyz
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
NEXT_PUBLIC_SOROBAN_RPC_URL=<a mainnet Soroban RPC provider; SDF runs no public one>
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_RELAYER_URL=https://api.app.writz.xyz
NEXT_PUBLIC_EARN_ASSET_CODE=USDC
NEXT_PUBLIC_EARN_ASSET_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
NEXT_PUBLIC_EARN_VAULT_ID=CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU
```

No lending contract ids, no `NEXT_PUBLIC_POLLAR_API_KEY` (the build refuses it: Pollar holds the key of the wallets it creates), no `NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY`, no `PROTOCOL_SIGNING_KEY` or `KMS_KEY_ID`, no `NEXT_PUBLIC_EARN_FAUCET_URL`. The vault and asset come from [`defindex-vault-mainnet.md`](https://github.com/WritzProtocol/writz/blob/main/contracts/deployments/defindex-vault-mainnet.md).

### Relayer (Railway, new service)

Mount a persistent volume at `/app/data` before the first deploy (see Persistence above).

```
WRITZ_ENV=mainnet
BITCOIN_NETWORK=mainnet
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
STELLAR_RPC_URL=<a mainnet Soroban RPC provider>
CORS_ORIGIN=https://app.writz.xyz
DEFINDEX_VAULT_ID=CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU
DEFINDEX_API_KEY=<the mainnet-only key; never the testnet one>
```

No `FAUCET_SIGNET_WIF` and no `POLLAR_SECRET_KEY`: the Signet faucet does not exist on mainnet, and the relayer refuses to boot with either set.

### DNS (Cloudflare)

| Type | Name | Value |
|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` |
| CNAME | `api.app` | the target Railway shows for the custom domain |

Then point the landing at it: `NEXT_PUBLIC_APP_URL=https://app.writz.xyz` on the `writz-landing` project.

### Verify

```bash
curl -s https://api.app.writz.xyz/health      # "target":"mainnet","lending":false
curl -s -o /dev/null -w '%{http_code}\n' https://app.writz.xyz/borrow/new   # 404
curl -sI https://app.writz.xyz/ | grep -i location                         # /earn
```

### Metrics history

The vault was deployed on 2026-10-01. A new relayer indexes vault events from its first poll, and Soroban RPC keeps events for days, not weeks, so the seed deposit and anything else older than the RPC window cannot be backfilled from RPC. Rewind the cursor (above) to the oldest ledger RPC still serves; anything earlier needs a deep-history source such as Hubble.
