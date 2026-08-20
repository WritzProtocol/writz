# Relayer Backfill Runbook - Repay-Watcher Outage Recovery

**Audience:** whoever operates the relayer. **When to use:** the repay-watcher process (`relayer/src/repay-watcher/`) was down long enough that Soroban RPC no longer retains events back to the last persisted cursor (`data/watcher.db`, table `watcher_cursor`) - RPC's retention window is on the order of days, not indefinite.

Until this runbook is rehearsed once against a real testnet outage, treat it as reviewed-but-unverified - see the checklist at the end.

---

## Why this exists

The watcher's cursor (`relayer/src/repay-watcher/cursor-store.ts`) is the only thing standing between a normal restart (safe - resumes exactly where it left off) and a silent gap (an outage that outlasts RPC's retention). When the gap exists, `runPollCycle`'s `getEvents({ cursor: persistedCursor })` call will fail or return nothing meaningful for the missing range - the code comment in `poller.ts` names this exact scenario as needing "a documented manual backfill." This is that document.

**What's actually at stake:** every `repay_full` event on `private-lend` that fired during the gap corresponds to a user who fully repaid their USDC debt and is waiting for their BTC release PSBT to be co-signed and published. Missing one means that user's BTC stays locked until either (a) this backfill runs, or (b) the CLTV timelock expires and they use the manual emergency recovery path - a much worse experience for them, and avoidable.

## Step 1 - Confirm there's actually a gap

Don't run this speculatively. Check first:

```bash
# What cursor does the watcher have on record?
sqlite3 data/watcher.db "SELECT cursor FROM watcher_cursor WHERE id = 1;"
```

Restart the watcher normally first. If `runPollCycle` throws on that cursor (rather than just returning zero events), that's the signal - RPC no longer has that cursor's position. Log the exact error before proceeding; it's useful evidence if this needs escalating.

## Step 2 - Determine the gap's ledger range

You need: the ledger sequence the watcher was last confirmed healthy at (check logs/monitoring for the last successful poll timestamp before the outage began), and the current ledger tip (`getLatestLedger()`). That range is what needs to be scanned.

## Step 3 - Enumerate `repay_full` events in the gap from an out-of-band source

RPC itself can't give you this once the cursor is stale - that's the whole problem. Use one of:

- **A second RPC provider or archive node** with a longer retention window, if one is configured or available on short notice.
- **Hubble / Galexie** (Stellar's deep-history data pipeline - see the `data` skill's coverage of these tools) for a historical query of `private-lend` contract events filtered to topic `repay_full` across the gap's ledger range.
- **stellar.expert** or a similar explorer, manually, if the gap is small enough to review by hand (this does not scale past a small number of ledgers, but is the fastest option for a short outage).

Whichever source you use, the output you need is a list of txids (internal byte order, matching what `decodeRepayFullEvent` extracts from `event.topic[1]`).

## Step 4 - Replay each txid through the existing handler, not a new script

**Do not write ad-hoc PSBT-signing code for this.** `handleRepayFull` in `relayer/src/repay-watcher/handler.ts` already does everything correctly (loads the position, verifies the derived scriptPubKey matches on-chain state, builds and co-signs the release PSBT, publishes it) and - critically - **is idempotent**: it checks `get_release_psbt` first and no-ops if a PSBT was already published for that position. This means:

- It is safe to call for a txid that was already handled (e.g. if you're not certain where the gap actually starts) - it will just do nothing for those.
- It is safe to re-run this entire backfill if it fails partway and needs restarting.

A minimal backfill script, run once from the relayer's environment (same config/credentials as the normal watcher process):

```ts
import { handleRepayFull } from "./src/repay-watcher/handler.js";
// ...construct the same HandlerDeps (esplora client, resolved signer, relayer keypair)
// the normal watcher process uses - see startRepayWatcher in poller.ts / index.ts
// for how those are built.

const gapTxids: Buffer[] = [
  // internal-byte-order txids from Step 3, e.g.:
  // Buffer.from("...", "hex"),
];

for (const txid of gapTxids) {
  try {
    await handleRepayFull(txid, deps);
    console.log(`backfilled ${txid.toString("hex")}`);
  } catch (e) {
    // Log and continue - one bad txid (e.g. a transcription error from Step 3)
    // should not abort the rest of the batch.
    console.error(`failed to backfill ${txid.toString("hex")}:`, e);
  }
}
```

## Step 5 - Advance the cursor past the gap

Once every txid from Step 3 has been replayed (or confirmed already-handled), manually set the watcher's cursor to a fresh one at the current tip so normal polling resumes cleanly:

```bash
# Restart the watcher after Step 4 completes - on a cursor miss it currently
# errors rather than self-healing to "start from tip," so this may need a
# one-time manual cursor write. If `runPollCycle` still throws after a normal
# restart, write a fresh cursor value directly:
sqlite3 data/watcher.db "UPDATE watcher_cursor SET cursor = '<fresh cursor from getEvents at current tip>' WHERE id = 1;"
```

(If, by the time this runs, `poller.ts` has been changed to self-heal a stale cursor by falling back to `startLedger` automatically, this manual step is unnecessary - check current behavior before assuming this instruction is still accurate.)

## Step 6 - Verify

For each txid backfilled, confirm `get_release_psbt` on `private-lend` now returns a non-empty PSBT. Spot-check at least one end-to-end by having the affected user (or a test position, on testnet) fetch and broadcast their release transaction successfully.

---

## Rehearsal checklist (do this before trusting this runbook)

- [ ] Run this on testnet against a deliberately-induced gap (stop the watcher, let several `repay_full` events accumulate past a manufactured "stale cursor," then execute Steps 1–6)
- [ ] Confirm Step 3 actually works against whichever historical data source is chosen - this is the step most likely to be harder in practice than it reads here
- [ ] Time the whole process once, so there's a real answer to "how long would users actually wait" the first time this is needed for real
- [ ] Assign an owner for this runbook (who runs it, who's paged if the watcher goes down) - see `docs/roadmap/phases.md`, Phase 2 "Team / key-person risk"
