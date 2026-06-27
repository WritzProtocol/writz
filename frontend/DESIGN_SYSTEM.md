# Writz — Design System

**"Private Vault"** — a design language for trustless, ZK-private Bitcoin lending.
Institutional in its restraint, precise in its data, built so a position stays
invisible until you choose to look.

Implemented as Tailwind v4 theme tokens in `src/app/globals.css` and fonts in
`src/app/layout.tsx`. Use the generated utilities (`bg-surface`, `text-amber`,
`border-line`, `font-serif`, `font-mono`, …) — do not hardcode hex values.

## Principles

- **Redacted by default.** Private values (a user's collateral, debt) render
  blurred and are revealed only on deliberate interaction. The protocol hides
  amounts on-chain; the interface mirrors that. Use the `.private` class and
  toggle `.revealed`.
- **Amber is scarce.** One primary action per screen, thin active borders,
  single micro-accents. Restraint is the luxury.
- **Data is monospace.** Hashes, addresses, amounts, ratios use `font-mono`
  with `tabular-nums` so figures align and read as precise.
- **Hairline structure.** 1px lines and tonal shifts over heavy borders or
  shadows. Let space, not chrome, separate things.
- **Semantic color ≠ accent.** `ok` / `crit` signal state; they are never the
  decorative accent. Never pair amber with critical.

## Color

Ratio target: ~82% obsidian/neutrals · ~12% off-whites · ~5% amber · ~1% signal.

| Token | Hex | Use |
|---|---|---|
| `obsidian` | `#0A0908` | Canvas (warm near-black) |
| `surface` | `#16130F` | Cards, panels |
| `surface-2` | `#1E1A14` | Raised elements, inputs |
| `line` | `#2A251D` | Hairline borders |
| `line-2` | `#3A3128` | Stronger borders, hover |
| `muted` | `#877F71` | Captions, metadata |
| `body` | `#B7AF9F` | Body text |
| `head` | `#E8E2D5` | Headings, labels |
| `hi` | `#FBF8F1` | Display / hero (warm white) |
| `amber` | `#E3A646` | Accent — CTAs, active state |
| `amber-2` | `#C98A34` | Amber hover / deep borders |
| `zk` | `#8FB6B0` | Privacy / ZK semantics only |
| `ok` | `#79A66F` | Success / healthy |
| `crit` | `#C75B4F` | Errors, undercollateralized |

## Typography

| Role | Font | Notes |
|---|---|---|
| Display | **Fraunces** (`font-serif`) | Luxury editorial serif; wordmark + hero + section titles, used sparingly. Italic for accents. |
| UI / body | **Hanken Grotesk** (`font-sans`) | Default. Precise, neutral. |
| Data | **Geist Mono** (`font-mono`) | On-chain values, hashes, amounts. Always `tabular-nums`. |

Loaded via `next/font` (`--ff-display`, `--ff-body`, `--ff-mono`). Keep running
text near 65ch; uppercase labels get `tracking-wider`; headings use
`text-wrap: balance`.

## Layout & motion

- Generous negative space; panels float on obsidian, never edge-to-edge.
- Border radius small and consistent (`rounded-xl` on cards).
- Atmosphere: a faint amber radial glow + ZK whisper + subtle grain, applied
  globally on `body` (see `globals.css`).
- Motion is functional: 150–250ms, `ease-out` entrances. No springs or bounce.
  Honor `prefers-reduced-motion` (the redact blur is disabled there).

## Components

- **Buttons** — Primary: solid amber, dark text. Secondary: transparent, thin
  `line-2` border, amber on hover. Destructive: ghost with `crit` text/border.
- **Pills/badges** — thin border, optional dot; variants for `zk`, `amber`
  (testnet), `ok`, `crit`.
- **Cards** — `bg-surface` + `border-line`; hover lifts to `border-line-2`.
- **Inputs** — `surface-2` background, thin `line` border, amber focus border,
  `font-mono` for numeric entry.
- **Tables** — minimal grid; hairline row dividers; `tabular-nums`; selected row
  gets a faint amber tint.
- **Private value** — `.private` (blurred) → `.revealed` on click/Enter.
