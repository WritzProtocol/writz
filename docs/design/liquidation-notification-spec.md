# UX Spec: Liquidation Notification

**Author:** Kaan (UX)
**Status:** Copy and frontend display shipped. Detection mechanism not yet implemented - this is the spec for it.

---

## The gap

Today, if a position is liquidated, the owner finds out only by noticing their
BTC is gone - no notification, no explanation, no visible status change. The
`PositionStatus` type now includes `"liquidated"` (`frontend/src/lib/position/types.ts`)
and `PositionCard` in `PositionDashboard.tsx` renders a red badge plus an
explanatory message whenever a position's status is `"liquidated"` - but
nothing currently sets that status. This spec closes that gap.

## What already exists to build on

`commitment-tree` emits a `LiquidateEvent` (`contracts/contracts/commitment-tree/src/events.rs`):

```rust
#[contractevent(topics = ["liquidate"])]
pub struct LiquidateEvent {
    #[topic]
    pub nullifier: BytesN<32>,
    pub keeper:    Address,
    pub usdc_debt: i128,
}
```

The `nullifier` field is exactly `Position.nullifier`, already stored locally
for every position. Detecting "was one of my positions liquidated" is a
straightforward set-membership check: does any recent `LiquidateEvent.nullifier`
match a nullifier I hold locally.

`relayer/src/repay-watcher/` (`poller.ts` + `cursor-store.ts` + `handler.ts`)
already implements the exact pattern needed: poll Soroban RPC for a specific
event topic from a persisted cursor, process new matches, never miss an event
that fires during downtime. **Don't build a new pattern - extend this one.**

## Recommended design

Server-side (relayer), not client-side polling from the browser:

1. Add a `liquidation-watcher` service alongside `repay-watcher`, same
   cursor-store pattern, watching the `liquidate` topic on both `commitment-tree`
   and `private-lend`.
2. On a match, record `{ nullifier, keeper, usdc_debt, ledger, txHash }` in a
   small persisted table (SQLite, same as the repay-watcher's cursor store).
3. Expose it via a relayer endpoint the frontend already knows how to call the
   same way it calls `/notes` for recovery: `GET /liquidations?nullifiers=...`
   or, simpler, fold liquidation records into the existing `/notes` response
   the frontend already scans in `recoverPositions` (`lib/flows/recover.ts`),
   so a single poll/scan pass picks up both recovery notes and liquidation
   status.
4. On the frontend, wherever positions are loaded or refreshed (dashboard
   mount, after `recoverPositions`), cross-reference local `position.nullifier`
   values against the liquidation records and set `status: "liquidated"` via
   `savePosition`.

**Why server-side and not a browser polling loop:** the browser isn't always
open, so a client-only check would only catch liquidations that happened while
the user was actively looking. A server-side watcher records the fact
permanently the moment it happens, so the status is correct the next time the
user opens the app regardless of timing - the same reasoning that justifies
the repay-watcher's existence instead of relying on the user's browser to
catch the repay event live.

## Notification, not just in-app status

Recording the status is necessary but not sufficient - the finding this spec
responds to was specifically about the *silence* at the moment of loss, and a
status the user only sees if they happen to reopen the app doesn't fully close
that gap. Once the relayer-side watcher exists, it has what it needs to also
push a notification (email/webhook the user optionally registered at deposit
time). That's a separate, smaller follow-up once the watcher and status are
in place - sequence it after, not blocking on it.

## Copy (already shipped in `PositionCard`)

> **This position was liquidated.**
> Your health factor dropped below the 120% liquidation threshold, and a
> keeper repaid your outstanding USDC debt in exchange for your BTC collateral
> (at the standard 10% liquidation discount). Your debt on this position is
> now zero - there is nothing left to repay - but the BTC collateral is gone;
> it was not partially returned. This is the protocol working as designed,
> not an error.

Design intent behind the wording: state the fact first, explain the mechanism
in one sentence, be explicit that no leftover collateral is coming back (so
the user doesn't wait for something that isn't happening), and close with
"working as designed" so a stressed user doesn't read it as a bug report to
file.
