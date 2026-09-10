# Deploy Targets

**Audience:** whoever operates the Writz deployments. **When to use:** provisioning, changing, or auditing a deploy target's configuration.

Writz runs the same two applications - the Next.js frontend and the relayer - once per network. A *deploy target* is one such pairing plus the domain it answers on. The targets never share configuration, and this page is the contract that says so.

| Target | Frontend origin | Stellar network | Bitcoin network | Status |
|---|---|---|---|---|
| `local` | `http://localhost:3000` | Testnet | Signet | Developer machines. Validates nothing. |
| `testnet` | `testnet.writz.xyz` | Testnet | Signet | Live. Earn plus the existing dashboard. |
| `mainnet` | `app.writz.xyz` | Public | Mainnet | **Not deployed.** Reserved for Milestone 2. |

The apex `writz.xyz` serves the marketing site and is not a deploy target in this sense; it builds with `NEXT_PUBLIC_WRITZ_ENV` unset, which resolves to `local`.

---

## Why targets are declared rather than inferred

Both applications read flat, independently-set environment variables. Nothing in that shape prevents a mainnet deployment from running with testnet contract addresses, the testnet Soroban RPC, the testnet vault, or the Earn mock left switched on - and none of those mistakes announce themselves. The realistic failure is not a typo; it is a **copy**: cloning the testnet service to create the mainnet one and changing nine of the twelve variables.

So each target declares itself, and the declaration is checked against everything around it:

- **Frontend** - `NEXT_PUBLIC_WRITZ_ENV`, validated at build time in [`frontend/src/config/target.ts`](../../frontend/src/config/target.ts). A contradiction fails the build.
- **Relayer** - `WRITZ_ENV`, validated at startup in [`relayer/src/deploy-target.ts`](../../relayer/src/deploy-target.ts). A contradiction refuses to boot, before anything binds a port.

Both report every conflict at once rather than one per failed attempt, because these values are edited on a hosting dashboard where a one-variable-per-build loop is miserable.

Leaving the variable unset means `local` and validates nothing. That is deliberate: a developer running `bun run dev` against a scratch env file is not who this protects.

### What each target enforces

| Rule | `testnet` | `mainnet` |
|---|---|---|
| Stellar network passphrase must match the target | yes | yes |
| Bitcoin network must match the target (relayer) | signet | mainnet |
| `DEFINDEX_VAULT_ID` must be set (relayer) | yes | yes |
| Soroban RPC must not be a test endpoint | - | yes |
| All `NEXT_PUBLIC_*` contract addresses set (frontend) | - | yes |
| `NEXT_PUBLIC_RELAYER_URL` set and https (frontend) | - | yes |
| Earn mock forbidden (frontend) | - | yes |
| `KMS_KEY_ID` required, `PROTOCOL_SIGNING_KEY` forbidden (relayer) | - | yes |
| `CORS_ORIGIN` must name explicit origins, not `*` (relayer) | - | yes |

Testnet is deliberately looser. It is allowed to run with the Earn mock and with pieces still missing while the epic is being built out; mainnet is allowed to inherit nothing by omission.

---

## Provisioning `testnet.writz.xyz`

Steps 1 and 2 are dashboard and registrar actions - they cannot be done from this repository.

### 1. Frontend (Vercel)

1. Create a Vercel project from this repository, separate from the one serving the apex domain. Root directory `frontend/`; framework preset Next.js.
2. Under **Settings → Domains**, add `testnet.writz.xyz`.
3. Under **Settings → Environment Variables**, set the target's variables for the Production environment. At minimum:

   ```
   NEXT_PUBLIC_WRITZ_ENV=testnet
   NEXT_PUBLIC_SITE_URL=https://testnet.writz.xyz
   NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
   NEXT_PUBLIC_RELAYER_URL=<the testnet relayer's origin>
   ```

   plus the contract addresses from [`frontend/.env.example`](../../frontend/.env.example), which tracks the current testnet deployment. Never copy these into the mainnet project.

4. Set the production branch to `main`. Pushes to `main` then deploy to `testnet.writz.xyz`; pull requests get preview URLs, which build with the same `testnet` target.

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

The relayer's own service for this target needs, in addition to what [`relayer/.env.example`](../../relayer/.env.example) documents:

```
WRITZ_ENV=testnet
BITCOIN_NETWORK=signet
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CORS_ORIGIN=https://testnet.writz.xyz
DEFINDEX_VAULT_ID=<the testnet vault, from contracts/deployments/defindex-vault-testnet.md>
DEFINDEX_API_KEY=<from console.defindex.io>
```

`DEFINDEX_VAULT_ID` is the piece this issue is really about: it is per-network, has no safe default, and a relayer without it serves errors from every `/defindex` route. The testnet vault address lives in [`contracts/deployments/defindex-vault-testnet.md`](../../contracts/deployments/defindex-vault-testnet.md) rather than being repeated here, so there is one place to change when it is redeployed.

#### Persistence: mount a volume, or the metrics history is lost on every deploy

The relayer keeps four SQLite databases on local disk:

| File | Written by | What is lost without it |
|---|---|---|
| `data/merkle.db` | `leaf-store.ts` | Merkle leaves |
| `data/watcher.db` | `repay-watcher/cursor-store.ts` | The repay watcher's cursor |
| `data/vault-events.db` | `vault-watcher/event-store.ts` | **Every indexed vault deposit and withdrawal** |
| `data/vault-watcher.db` | `vault-watcher/cursor-store.ts` | The vault watcher's cursor |

The container image declares no `VOLUME`, so on a fresh service that directory is ephemeral and every redeploy starts empty.

That is recoverable for three of the four. It is not for `vault-events.db`. Soroban RPC retains events for days, not indefinitely (see `relayer-backfill-runbook.md`), and this database is the only durable record beyond that window. The metrics deliverable reports 30-day retention cohorts, which is longer than RPC will serve. Lose the file after the window closes and the history cannot be rebuilt from chain at all.

**Mount a persistent volume at `/app/data`.** All four paths are overridable if the platform mounts elsewhere: `SQLITE_PATH`, `WATCHER_SQLITE_PATH`, `VAULT_EVENTS_SQLITE_PATH`, `VAULT_WATCHER_SQLITE_PATH`.

Both watchers are always-on polling loops started in `src/index.ts`, not request-driven handlers. A platform that suspends the container when idle produces silent gaps in the same data, so scale-to-zero tiers are not suitable regardless of the volume.

#### After the first deploy: rewind the cursor to capture existing history

`runVaultPollCycle` starts a first-ever run from the current ledger tip rather than backfilling, which is deliberate (a gap here undercounts metrics, it does not risk funds). The consequence is that a newly deployed relayer indexes nothing that happened before it booted.

If vault activity predates the deployment and should appear in the metrics, rewind once after the service is healthy. `insertVaultEvent` is idempotent, with a UNIQUE constraint across tx hash, depositor, kind and amount, so a re-scan cannot double count:

```bash
# The oldest ledger you want indexed, from the vault's transaction history
# on a Stellar explorer.
bun -e 'import {writeCursor} from "./src/vault-watcher/cursor-store.js"; writeCursor("<ledger>-0")'
```

Do this while the events are still inside RPC's retention window. After that, only a deep-history source such as Hubble can recover them.

Confirm the running service is the target you think it is:

```bash
curl -s https://<relayer-origin>/health
# {"status":"ok","service":"writz-relayer","target":"testnet","bitcoinNetwork":"signet",...}
```

A `target` of `local` in that response means `WRITZ_ENV` was never set on the service, and none of the checks above ran.

---

## Adding `app.writz.xyz` later

Repeat the three steps with `mainnet` values, in a **new** Vercel project and a **new** Railway service. Do not clone the testnet ones - cloning is the failure this whole mechanism is built around, and the mainnet rules in the table above exist to catch it. Expect the first mainnet build to fail with a list of variables to fix; that list is the feature.

Mainnet also requires things testnet does not have yet:

- A DeFindex vault deployed on the public network, with roles split across dedicated keys rather than a single deployer (see the note at the end of [`defindex-vault-testnet.md`](../../contracts/deployments/defindex-vault-testnet.md)).
- Co-signing through AWS KMS. The WIF `PROTOCOL_SIGNING_KEY` fallback is refused on mainnet in two places: at boot by the target check, and at signing time by `resolveProtocolSigner` (see [security model](../security/security-model.md)).

---

## Checking a target's configuration

```bash
# Frontend: a contradiction fails the build.
cd frontend && NEXT_PUBLIC_WRITZ_ENV=testnet bun run build

# The rules themselves.
cd frontend && bun test src/config
cd relayer  && bun run test -- deploy-target
```
