# Accessibility Strategy

**Author:** Kaan (UX)
**Status:** New - no formal strategy existed before this document. Target: WCAG 2.1 AA.

---

## Where this stands today

Accessibility is not mentioned anywhere in Writz's product or roadmap documentation
(`docs/introduction/`, `docs/products/`, `docs/roadmap/phases.md`) as of this
writing. The frontend code itself is ahead of the documentation: there's real,
if inconsistent, ARIA work already in place -

- `AppTabs.tsx`: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-label`
- `Navbar.tsx`: `aria-label="Toggle menu"`, `aria-expanded`
- `ErrorBoundary.tsx`: `role="alert"`
- `PositionDashboard.tsx`: keyboard handling (`tabIndex`, `onKeyDown`) on the
  `Private` reveal-on-click component

- but it's ad-hoc, developer-by-developer, with no checklist, no acceptance
criteria in the roadmap, and no target conformance level. That's the gap this
document closes.

## Why this matters more than usual for Writz specifically

Two things make accessibility a sharper requirement here than for a typical
DeFi frontend, not a softer one:

1. **The growth research explicitly targets a conservative, complexity-averse
   segment** (`docs/research/growth-strategy.md`) - the opposite of the
   "crypto power user" persona accessibility gets skipped for elsewhere. That
   audience skews toward wanting things legible and predictable, which is
   substantially the same thing accessibility asks for.
2. **This is a product that moves real money with irreversible-by-default
   actions** (a mis-clicked liquidation-adjacent action, a misread health
   factor). Poor contrast or an unlabeled control isn't just an annoyance
   here - it's a path to a financial mistake.

## Target: WCAG 2.1 AA

Not AAA (disproportionate effort for a product at this stage) and not just
"best effort" (not falsifiable, easy to silently regress). AA is the standard
most fintech products converge on and gives concrete, testable criteria.

## Scope, prioritized

**P0 - the money-moving flows** (deposit, borrow, repay, release, liquidation
notice): every interactive element keyboard-reachable and operable, visible
focus states, form inputs with associated labels (not just placeholder text -
`DepositFlow.tsx`'s BTC amount and txid inputs currently rely on `<label>`
correctly, keep that pattern everywhere), error messages programmatically
associated with their field, and color never the *only* signal (the health
factor already pairs color with a numeric label - `text-ok`/`text-amber`/`text-crit`
plus the percentage text - keep extending that pattern, don't let a future
change drop the text and leave only color).

**P1 - the rest of the app dashboard:** consistent landmark regions, skip-to-content
link, heading hierarchy that doesn't skip levels, the `.private` blur-reveal
pattern (`globals.css`) needs a non-hover/non-click alternative for keyboard
and screen-reader users - right now it's `cursor: pointer` driven, verify a
keyboard user can reach and toggle it (there's a start on this in
`PositionDashboard.tsx`'s `Private` component's `tabIndex`/`onKeyDown`, audit
whether every other use of `.private` in the app has the same).

**P2 - marketing/landing site:** lower stakes (no financial actions), but
should still hit AA - it's most users' first impression and often where
someone using a screen reader decides whether the product is for them at all.

## Process, not just a checklist

- Add "Accessibility (WCAG AA)" as an explicit exit criterion in
  `docs/roadmap/phases.md` Phase 2, alongside the other frontend items -
  done, see that document.
- Automated baseline: run `axe-core` (or `@axe-core/react` in dev) in CI
  against the app dashboard routes. Automated tools catch roughly a third of
  real issues - necessary, not sufficient.
- Manual pass before mainnet launch: keyboard-only walkthrough of the full
  deposit → borrow → repay → release cycle, plus a screen reader smoke test
  (VoiceOver or NVDA) of the same flow. This should be a named task with an
  owner, not an implicit expectation.
- No new PR touching `frontend/src/components/` or `frontend/src/app/`
  should introduce a component with an interactive element that has no
  accessible name - this is cheap to catch in review once it's an explicit
  standard, expensive to retrofit later.

## What this document does not do

It doesn't hand off a component-by-component remediation list - that requires
an actual audit pass (automated + manual) against the criteria above, which
hasn't happened yet. This document sets the target and the process; the audit
is the next concrete step, and it should happen once the deposit/borrow/repay
UI is out of "in progress" per `docs/roadmap/phases.md`, not before (auditing
UI that's still actively changing wastes the audit).
