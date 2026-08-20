# UX Spec: Points Program

**Author:** Kaan (UX)
**Status:** Spec only - no points UI exists yet. The growth research
(`docs/research/growth-strategy.md`) defines the earning rules and anti-Sybil
thresholds; this spec defines what the user sees.

---

## Why this needs a spec, not just backend logic

The growth strategy treats points as a retention mechanic, but a points
program that's invisible or opaque doesn't retain anyone - it just runs
silently in a database no user ever looks at. The earning rules already
defined (minimum deposit, activity requirement, wallet age) are meaningless
to a user unless the app tells them, at the moment it matters, what they did
and didn't earn and why.

## Where it lives

A "Points" tab alongside the existing `AppTabs` (`Borrow` / `Lend` today,
per `frontend/src/components/AppTabs.tsx`) - not a separate page. Points are
a layer over the same positions the user already sees, not a distinct
product surface.

## What the user sees

1. **A running total**, always visible once a wallet is connected, even at
   zero - "0 points earned yet" beats a hidden feature discovered by accident.
2. **Per-position earning status**, shown right on the existing position
   card in `PositionDashboard.tsx` (same place the health factor lives):
   - Below the $250 minimum: "Not earning points - increase your deposit to
     $250+ to start earning." (Stated as a threshold to reach, not a
     penalty - the deposit still works fully otherwise.)
   - Above minimum, activity requirement not yet met: "Earning starts once
     you borrow, repay, or hold this position 30+ days." Show which
     condition is closest to being met, not just a flat "not yet."
   - Actively earning: show the points accrued on this position specifically,
     not just the wallet-wide total - users trust a number they can trace to
     a specific action.
3. **Wallet-age gating, explained plainly if it blocks someone:** "Points
   require your Bitcoin address to have history before [date] and your
   Stellar account to be 14+ days old. This wallet doesn't qualify yet."
   Never a bare rejection with no reason - that reads as a bug, not a rule.
4. **No fake urgency.** Don't invent countdown timers or "other users are
   earning right now" pressure - the growth research already rejected an
   immediate-airdrop model in favor of sustained engagement; the UI shouldn't
   undercut that with manufactured scarcity.

## What this spec does not decide

Exact points-per-action multipliers, the conversion ratio to WRTZ, and the
claim/distribution mechanism are growth/tokenomics decisions
(`docs/research/growth-strategy.md`, `docs/research/tokenomics-fee-model.md`),
not UX ones - this spec only covers how the program is surfaced and explained
to the user, whatever the underlying numbers end up being.
