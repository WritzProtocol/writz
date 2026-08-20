# UX Spec: Guided Recovery Flows

**Author:** Kaan (UX)
**Status:** Spec only - no UI exists yet for either flow described here. Ready for architecture/implementation.
**Replaces the current experience of:** `docs/how-it-works/manual-emergency-recovery.md` (Path B) and
`docs/how-it-works/manual-proof-submission.md` (relayer-down fallback).

---

## Why this exists

Both documents above are correct and well-written *as developer references* - the
underlying scripts are tested, safe, and thoughtfully guarded (`SpendParams` makes
the classic `nSequence` mistake structurally impossible, for instance). The
problem is not the engineering. The problem is that today, using them requires
installing `bitcoinjs-lib`, writing and running a Node.js script, decoding hex
by hand, and comparing SHA256d output against a block explorer. That's a
reasonable ask of a developer. It is not a reasonable ask of someone whose BTC
is stuck and who just wants it back.

These two flows are not equally urgent, and the design should not treat them
as if they were:

- **Manual proof submission is low-stakes.** The doc says so itself: "this is
  a liveness concern only... no funds are ever at risk from a stripping
  mistake." A wrong strip just fails cleanly and can be retried. This flow
  needs convenience, not reassurance.
- **Emergency recovery is high-stakes and time-pressured.** The user is here
  because something is wrong (Writz is unresponsive, or they've lost trust in
  the protocol) and they're moving real BTC with their own private key, past
  the CLTV timelock. This flow needs both convenience *and* the same anxiety-reducing
  design care as the rest of the deposit flow, arguably more.

## Flow 1: Guided SPV Proof Submission

**Trigger:** the relayer is down or slow (the existing `pollSpvBundle` retry
loop in `deposit.ts` already detects this - `"Relayer unreachable - retrying…
(attempt N)"`). After a threshold (e.g. 5 failed attempts), surface a "Try
submitting manually" option instead of leaving the user staring at a retrying
spinner indefinitely.

**Screens:**
1. **Explain, don't alarm.** "The relayer that normally assembles your proof
   isn't responding. Your Bitcoin transaction is safe and unaffected - this
   only affects how quickly we can verify it on Stellar. You can wait, or
   submit the proof yourself in a couple of steps."
2. **Auto-fill what's known.** The app already has the txid and can fetch the
   raw transaction from a public Bitcoin API (the same one `resolveVout`
   already calls) - the user should never be asked to paste raw hex by hand.
   `stripWitness` (already implemented in `relayer/src/bitcoin/tx.ts`) runs
   client-side or via a lightweight serverless function, not manually.
3. **One button: "Submit proof."** Runs the equivalent of what the relayer
   would have done, using the already-fetched header/Merkle data from a
   public Esplora-compatible API as a fallback data source. Show the same
   step labels the automatic flow uses ("Verifying with Soroban…") so the
   experience doesn't feel like a different, scarier product.
4. **Success state matches the normal deposit success state exactly** - no
   visual signal that this was "the hard path." The user shouldn't feel like
   they did something risky just because the relayer had a bad day.

**What this removes from the user:** installing anything, running scripts,
hex comparison, knowing what SegWit stripping even is.

## Flow 2: Guided Emergency Recovery (Path B)

**Trigger:** user-initiated, from the position dashboard. Show a "Recover via
timelock" action on any position whose `timelockHeight` has passed - this is
a computable condition (`current block height >= position.timelockHeight`),
so the option should only appear when it's actually usable, never as a dead
button that fails on click.

**Design principle:** this is the closest thing Writz has to a "break glass"
flow. It should feel calm, procedural, and confidence-building, not like an
error state. Borrow visual language from the rest of the deposit flow, not
from the red liquidation banner.

**Screens:**
1. **Eligibility check, shown plainly.** "Your BTC can now be recovered
   without Writz's cooperation - block height 712,340 has passed your
   timelock of 700,000." If not yet eligible: "Recoverable after Bitcoin
   block 700,000 (currently ~X blocks / Y days away)" - turn the wait into
   the same kind of countable, ETA'd progress used for Bitcoin confirmations
   elsewhere in the app (see the confirmation progress bar in
   `frontend/src/components/DepositFlow.tsx`), not a bare number.
2. **Explain what's about to happen, in one paragraph.** "This sends your
   full BTC collateral back to a Bitcoin address you choose, using the
   timelock path - no signature from Writz is needed. This does not affect
   any USDC you've already borrowed; that debt still exists and this does
   not repay it." (Get legal/product sign-off on this exact wording before
   shipping - it's a real financial disclosure, not just UX copy.)
3. **One input: destination Bitcoin address.** Pre-fill with the connected
   Bitcoin wallet's own address as a sensible default, editable.
4. **Everything else is derived, never typed by the user:** redeem script,
   scriptPubKey, funding txid/vout/amount all come from the stored `Position`
   record (`btcPubkey`, `timelockHeight`, `vout`, `txid`, `collateralSats`) -
   exactly the fields the manual doc currently asks the user to gather by
   hand. Fee estimate pulled from a fee-rate API, shown to the user before
   they confirm, not silently assumed.
5. **The actual transaction construction reuses `buildEmergencyTransaction`/
   `finalizePathB` from `bitcoin-script` directly** - this spec is asking for
   a UI in front of tested logic, not new cryptographic code. The structural
   guarantee that already exists (no caller-settable `sequence` field) carries
   over automatically.
6. **Confirmation screen shows the exact transaction details** (destination,
   amount, fee) before signing - the user's Bitcoin wallet extension handles
   the actual signature, same pattern as `handleSendBtc` already uses for
   deposits, so no private key ever touches Writz's own code.
7. **Post-broadcast:** show the txid with a block explorer link, same pattern
   as `TxLink` elsewhere in the app, plus a plain-language "what happens now"
   (waiting for confirmations, same as a deposit).

**What this removes from the user:** installing `bitcoinjs-lib`, writing a
script, deriving addresses/scripts by hand, decoding raw tx hex, comparing
`sequence` values manually. The verification steps in the current doc
(decode raw tx, check `locktime`/`sequence`) become internal QA checks the
app runs before ever showing the "confirm" screen, not user homework.

## What does NOT need to change

The underlying scripts and the written manual docs should stay - they remain
the correct reference for the rare case where the frontend itself is
unreachable (not just the relayer), which the guided flow can't help with by
definition. Keep both docs, but retitle them for what they actually are once
the guided flows ship: "Fully manual reference (only if the Writz app itself
is unreachable)," not the primary path.

## Sequencing note

Flow 1 (proof submission) is smaller and lower-risk - build it first. Flow 2
(emergency recovery) touches real fund movement via a less-common code path
and deserves its own test pass (testnet + signet dry runs against real
timelocked UTXOs) before shipping, independent of Flow 1's timeline.
