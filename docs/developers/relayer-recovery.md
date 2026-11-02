# Relayer recovery

How to diagnose the relayer's `writz-lend` state, rebuild it from the chain, and start a new relayer from nothing.

**Audience:** whoever operates a relayer, including a third party running their own.

## What the relayer holds

Positions and balances live in `writz-lend`. Losing the relayer's data loses no funds, and every position stays readable on chain. The relayer keeps three things of its own:

| State | Where | What it is for |
|---|---|---|
| Event archive | `data/lend-events.db` | Every `deposit`, `borrow`, `repay`, `repay_full`, `liquidate`, `supply` and `withdraw`, kept past RPC retention |
| Repay watcher cursor | `data/watcher.db` | Its place in the event stream |
| Pending releases | `data/watcher.db` | Full repayments whose co-signed release is not on chain yet |

Without a cursor, the repay watcher starts from `WRITZ_LEND_DEPLOY_LEDGER`, never from the chain tip. A lost database therefore delays a borrower's release. It does not drop it, as long as that ledger is inside RPC retention.

## Diagnose

Everything starts at `GET /health`:

```json
{
  "releases": { "pending": 0, "oldestPendingAt": null, "stuck": 0, "lastError": null },
  "lendEvents": { "ok": true, "lastLedger": 5517628, "lastError": null }
}
```

| What you see | What it means | What to do |
|---|---|---|
| `releases.pending` above 0, going down | Normal: releases are being published | Nothing |
| `releases.pending` above 0, `oldestPendingAt` old | Publishing keeps failing and is backing off | Read the `[repay-watcher]` log lines |
| `releases.stuck` above 0 | A release used up its 24 attempts, about 20 hours. It is kept, not dropped | See [Stuck releases](#stuck-releases) |
| `releases.lastError` set | The watcher cannot read events | If it mentions the ledger range, the cursor left RPC retention: rebuild |
| `lendEvents.ok` is false | The archive stopped, on purpose, instead of skipping events | `empty archive and WRITZ_LEND_DEPLOY_LEDGER is not set`: set the variable. A malformed event: read the `[lend-events]` log line |

## Recover

Stop the relayer first. The command refuses to run while a live relayer on the same host holds the data directory.

```bash
cd relayer

# Check first. It does everything except the swap, and changes nothing.
bun run rebuild-lend-state --dry-run

# Then for real.
bun run rebuild-lend-state
```

The output is the same in both:

```
Events replayed:      8
Positions verified:   2
Suppliers verified:   2
Total scaled supply:  1500000000
Repaid in full:       0
Missing releases:     0
Verified against the chain and swapped in.
```

The result is accepted only if all of these hold:

- Every `deposit` has a position, and its status matches the replay: `repay_full` gives `Closed`, `liquidate` gives `Liquidated`, otherwise `Active`.
- For each supplier, `supply` minus `withdraw` in scaled units equals `get_supply_position`.
- The sum over all suppliers equals `total_scaled_supply`.

Contract views can only be read at the current ledger, so the command reads the events again after the views. If a new event arrived, it checks again, and after five rounds it fails instead of accepting a mixed state. Run it again when the contract is quieter.

**If a check fails,** it prints the first difference, exits non-zero, and changes nothing. Do not work around it: the chain is right and the events are not.

**If it passes,** the archive is swapped in atomically, the watcher's cursor moves to the replayed position, and every `repay_full` without a release is queued. Start the relayer: the sweep publishes those releases with no manual step. Existing pending rows are kept.

## Start a new relayer

The rebuild needs public RPC access only, with no copy of anyone's database, and a source of events never has to be trusted, because the chain proves or rejects the result.

```bash
cd relayer
export WRITZ_LEND_ID=<the current writz-lend, from contracts/deployments/testnet.md>
export WRITZ_LEND_DEPLOY_LEDGER=<its deployment ledger, from the same file>
bun run rebuild-lend-state
```

Then configure the rest of the relayer as in [Deploy targets](/developers/deploy-targets) and start it. Publishing releases needs the relayer account and the protocol signer. Rebuilding does not.

## Limits

- **RPC retention.** Testnet RPC keeps 120,960 ledgers, 7 days. The rebuild reads from `WRITZ_LEND_DEPLOY_LEDGER`, so past that window it stops with `outside RPC retention`.
- **The archive does not replace the rebuild yet.** The rebuild reads RPC only. Rebuilding from an archive file is tracked in #266.
- **After each `writz-lend` redeploy,** update `WRITZ_LEND_ID` and `WRITZ_LEND_DEPLOY_LEDGER` together. Rows of the old contract stay in the tables, and the sweep ignores them.

### Past RPC retention

Until #266 ships, a relayer that lost its data after the window recovers the releases by hand. Positions and balances are still safe on chain.

1. List the `repay_full` events from a source with longer history: a second RPC provider, Hubble or Galexie, or an explorer for a small gap. You need each position's txid in internal byte order, as in `topic[1]` of the event.
2. Queue them. `handleRepayFull` is idempotent, so a txid that already has its release is harmless, and the sweep does the rest.

```bash
bun -e '
import { openReleaseStore, watcherDbPath } from "./src/repay-watcher/release-store.js";
import { cursorForLedger } from "./src/rpc-cursor.js";
const txids = ["<hex>"];
openReleaseStore(watcherDbPath()).recordBatch(process.env.WRITZ_LEND_ID, txids, cursorForLedger(<current ledger>), Date.now());
'
```

3. Start the relayer and confirm `get_release_psbt` returns a value for each one.

Never write ad-hoc PSBT signing for this. `handleRepayFull` also checks the position's script against the protocol key, and refuses to co-sign on a mismatch.

## Stuck releases

A stuck row has used its attempts. The usual cause is a deterministic failure, such as the script mismatch above after a protocol key change. Read the error in the `pending_releases` table:

```bash
sqlite3 data/watcher.db "SELECT txid, attempts, last_error FROM pending_releases WHERE attempts >= 24;"
```

Fix the cause, then let it retry:

```bash
sqlite3 data/watcher.db "UPDATE pending_releases SET attempts = 0, next_attempt = 0 WHERE attempts >= 24;"
```

The borrower is not locked out meanwhile: the timelock exit does not depend on the relayer.

## Reference

| Command | What it does |
|---|---|
| `bun run rebuild-lend-state` | Rebuilds, verifies and swaps in |
| `bun run rebuild-lend-state --dry-run` | The same, with no change |

| Variable | Default | Used for |
|---|---|---|
| `WRITZ_LEND_ID` | none | The contract |
| `WRITZ_LEND_DEPLOY_LEDGER` | none | Where the archive, the watcher and the rebuild start |
| `LEND_EVENTS_POLL_INTERVAL_MS` | `30000` | How often the archive polls |
| `REPAY_WATCHER_POLL_INTERVAL_MS` | `30000` | How often the watcher polls and sweeps |
| `LEND_EVENTS_SQLITE_PATH` | `data/lend-events.db` | The archive |
| `WATCHER_SQLITE_PATH` | `data/watcher.db` | The cursor and pending releases |
| `STELLAR_RPC_URL` | testnet | RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | testnet | Network |
