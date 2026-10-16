# Writz design system

Graphite & Gold: a dark graphite ground, one gold accent, Work Sans for words and
Geist Mono for figures. Small details take the angle of the Writz mark, minus 16
degrees: parallelogram buttons, the slash before a status, chips and the cut
corner on panels. Everything else is flat.

This file describes how the system is built in code. The brand itself (logo,
colours with their contrast pairs, type specimens) is shown on writz.xyz/brand.

## Tokens

All tokens live in `packages/brand/tokens.css` as plain CSS custom properties on
`:root`. There is no build step and no generated theme; both apps read the same
file.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0e12` | Graphite, the page ground |
| `--surface` | `#15181e` | Panels, sheets, bottom tabs |
| `--surface-2` | `#1c2027` | Raised tiles inside a panel |
| `--deep` | `#2a303a` | Empty tracks, skeletons, unfilled slots |
| `--line` | white at 7% | Hairline rules and dividers |
| `--line-strong` | white at 14% | Outlines that need to read as an edge |
| `--heading` | `#f4f5f7` | Headings, figures, labels that carry a value |
| `--body` | `#b6bbc4` | Running text |
| `--muted` | `#8b919b` | Captions, terms in a ledger row, hints |
| `--accent` | `#ffc300` | Gold: the primary action, the active mark, focus |
| `--accent-hover` | `#ffd033` | Gold on hover |
| `--on-accent` | `#15181e` | Text and icons on gold |
| `--danger` | `#e5786c` | Errors, can be liquidated |
| `--warning` | `#f0a33a` | Close to liquidation, needs attention |
| `--positive` | `#4fbf8f` | Healthy, done |
| `--info` | `#8fb0d8` | Neutral status, in progress |
| `--link` | `var(--accent)` | Inline links and text buttons |
| `--mark` | `var(--accent)` | Active nav mark, focus ring, meter marker |
| `--tint-10` | heading at 7% | Quiet fills: secondary buttons, tags, chips |
| `--tint-20` | heading at 13% | Hover on those fills |
| `--shadow-border` | | A one pixel edge with a soft neutral drop |

The file also carries the type families (`--font-sans`, `--font-mono`), the
control radius (`--radius-control`) and the motion tiers (see Motion).

Status tints are mixed from the tokens with `color-mix()`, for example
`color-mix(in srgb, var(--warning) 10%, transparent)` behind a warning notice.
Never write a hex or rgb colour in a component or stylesheet.

### How each app reads them

- `frontend/landing` imports the file at the top of `src/app/globals.css` and
  styles its pages with plain scoped CSS (`.landing`, `.press-root`). The
  whitepaper is a light paper page and defines its own paper variables in
  `src/app/whitepaper/whitepaper.css`.
- `frontend/app` imports the file from `src/app/layout.tsx`, before
  `globals.css`. `globals.css` maps the colours into Tailwind with an
  `@theme inline` block (`--color-surface: var(--surface)` and so on), so
  utilities such as `bg-surface` or `text-muted` exist. Most screens are styled
  with the classes in `ui.css` and the route stylesheets instead.

Inside the app, `.app` defines a few short aliases used by `ui.css` and the
route stylesheets: `--gold`, `--ink`, `--panel`, `--panel-2`, `--midnight`,
`--rule`, `--rule-strong`, plus `--edge` (heading at 36%, the outline of a line
button) and `--shear` (the tangent of 16 degrees, used to cut corners at the
mark's angle). See `packages/brand/README.md` for the Next.js and Vercel
settings that let both apps reach the shared folder.

## Type

- **Work Sans** for all text, weights 400, 500 and 600, loaded with `next/font`
  as `--ff-sans`.
- **Geist Mono** for every figure that comes from a chain or a calculation:
  amounts, ratios, prices, block heights, addresses, transaction ids. Always
  with tabular numbers so columns and live values do not jitter. In the app use
  the `.mono` class, which sets both.
- Headings use `text-wrap: balance`. Section labels are 13px, uppercase, with
  wide tracking (`.wz-label`). Nothing renders under 13px.

## The cut primitives

The shared pieces of the app live in `frontend/app/src/app/(app)/ui.css` (the
`wz-` classes) and `frontend/app/src/components/ui/` (React parts: `Notice`,
`ErrorBox`, `ExternalLink`, `SlideToConfirm`, `ConfirmationSlots`, `Spinner`,
and the hooks in `hooks.ts`). The landing has its own copies of the button and
tag treatment in `landing.css`, drawn the same way.

The angle is always drawn with a `::before` layer under the content, skewed by
`skewX(-16deg)`, so the text stays upright and the hit area stays a rectangle.

- **Buttons** (`.wz-btn`): a parallelogram fill. Variants: `wz-btn-gold` (the
  one primary action), `wz-btn-line` (outlined), the default quiet fill on
  `--tint-10`, `wz-btn-text` (an underlined text action in `--link`) and
  `wz-btn-sm`. Disabled buttons keep a readable muted label on a quiet fill.
- **Tags and badges** (`.wz-tag`, `.wz-badge`): a quiet parallelogram. A status
  badge starts with the slash, a small skewed bar in the status colour, and
  always names the status in words (`data-tone` picks the colour).
- **Chips** (`.wz-chip` in `.wz-chips`): small parallelograms for presets and
  inline choices; the pressed chip fills with `--heading`.
- **Segmented control** (`.wz-seg`): tabs as parallelograms of equal width; the
  selected one fills with `--heading`.
- **Fields** (`.wz-field`, `.wz-label`, `.wz-hint`, `.wz-error`, `.wz-check`):
  a square field outlined in `--muted`, Geist Mono input, the unit at the end,
  a 2px `--danger` outline when invalid. The checkbox fills gold when checked.
- **Panels with the cut corner** (`.wz-cut`, `.wz-cut-sm`): a `clip-path` that
  takes the top left corner off at the mark's angle. Panels are square
  otherwise, with no radius and no shadow.
- **Notices** (`Notice`, `.wz-note`): the status colour at a 10% tint with a
  thin outline in the same colour, and a word label after the slash.
- **Ledger rows** (`.wz-row` in a `dl`): term on the left in `--muted`, value on
  the right in `--heading`, hairline between rows.
- **Slide to confirm** (`SlideToConfirm`, `.wz-slide`): a gold parallelogram
  handle dragged across a track to send a transaction. By keyboard, the first
  Enter arms it and the second sends.
- **Confirmation slots** (`ConfirmationSlots`, `.wz-slots`): one block per
  required confirmation, gold when reached.

Route stylesheets sit next to their routes and use a short prefix: `hm-` home,
`ln-` loans, `bj-` the borrow journey, `fu-` Earn and Lend, `pr-` Protocol,
`rc-` reclaim. Reuse a `wz-` class before adding a new one.

## App shell

`frontend/app/src/components/shell/` holds the shell, the nav, the Activity
tray and the account sheet.

- **From 1024px**: a fixed left sidebar (256px) with the lockup, Home, Borrow,
  Earn and Lend, then Protocol and Docs below a rule, and the network note at
  the bottom. The network chip, Activity and the wallet chip sit at the top
  right of the content column.
- **Below 1024px**: a compact header with the mark and the same controls, and
  four bottom tabs (Home, Borrow, Earn, Lend) that respect the safe area.
- The content column is at most 1184px wide with a 32px gutter, 16px below
  768px.
- The active item carries the gold slanted mark and `aria-current="page"`.
  Which item is active comes from `currentNav()` in `components/shell/nav.ts`,
  with its tests next to it: `/` and `/loans/*` mark Home, `/borrow/*` marks
  Borrow, Earn, Lend and Protocol mark themselves, and any other route (for
  example `/help/reclaim`) marks nothing.
- Sheets (Activity, account) slide in from the right on desktop and up from
  the bottom below 760px, and return focus to their trigger on close.

## Health meter

`HealthMeter` in `frontend/app/src/components/loan/parts.tsx`, styled by the
`ln-bm-` classes in `loans.css`. It is a bullet meter on a 100% to 250%
collateral ratio scale:

- a continuous track filled to the ratio, coloured by state (positive, info,
  warning or danger);
- fine ticks at 120% (liquidation) and 150% (borrow limit), zone bands under
  the track and a legend that names each zone;
- the gold marker at the current ratio and, while a valid amount is typed in
  Borrow more or Repay, an outlined marker at the ratio it would leave;
- `role="meter"` with a text value that states the ratio and the state in
  words. While the ratio is loading the track is empty; with no debt it is
  full.

The meter is a solid track. Do not draw it as a row of slanted stripes.

## Numbers

- **BTC**: always 8 decimals (`0.05000000 BTC`).
- **USDC**: 2 decimals, thousands separators, rounded down, with the `USDC`
  suffix (`2,000.00 USDC`).
- **`$`** only for the BTC price (`$60,000`).
- **Collateral ratio**: a whole percentage, rounded down.

The formatters are `formatBtc`, `formatUsdc` and `formatUsd` in
`frontend/app/src/lib/borrow/journey.ts` and `pct` in
`components/loan/parts.tsx`. Use them rather than formatting inline. Figures
render in Geist Mono with tabular numbers.

## Motion

Four tiers in the tokens: `--dur-micro` (120ms, hover and press),
`--dur-element` (220ms, a control or a value changing), `--dur-section`
(420ms, a panel or sheet arriving) and `--dur-signature` (900ms, one thing
once), with `--ease-enter` for things arriving and `--ease-exit` for things
leaving. Buttons scale to 0.96 on press. No springs, no bounce, and nothing
loops except progress indicators and loading placeholders.

Each app route has one orchestrated entrance. The cut-corner panels sweep in
from the right over `--dur-signature` (120ms delay) and their contents rise at
640ms; the other sections rise 16px over `--dur-section`, staggered in 80ms
steps; inside a panel the health meter fills and its marker drops after it.
`useEntrance()` and `<Enter>` in `components/ui/entrance.tsx` play it once per
visit to a route: re-renders, data updates, tab switches and remounts on the
same visit do not replay it, and an element that first appears later plays it
then. The sidebar and header never animate.

While a page waits for the client to know the wallet, its skeleton takes the
loaded layout: the same classes and cut corners, placeholder bars sized by the
real copy (`T` and `SkBtn` in `components/ui/skeleton.tsx`), and a slow opacity
pulse. A script in the app layout marks before first paint whether this browser
remembers a wallet, loans or a deposit, so each skeleton shows the layout the
page will settle into. The header shows a neutral chip until the wallet state
is known.

Every animation has a static end state that is complete on its own. Under
`prefers-reduced-motion: reduce` entrances, the skeleton pulse, sheet slides,
the spinner, the meter fill and control transitions are switched off, and the
landing skips its hero entrance and scroll reveals. In React,
`usePrefersReducedMotion()` from `components/ui/hooks.ts` gives the same
answer.

## Rules code must keep

- No gradients, glow, grain, glassmorphism, backdrop blur or coloured shadows.
- Colour only from the tokens, directly or through `color-mix()`.
- Status is never the accent: gold is for the primary action, the active mark,
  focus and the meter marker; danger, warning, positive and info are for state.
  A status always comes with its word, never colour alone.
- Gold marks the primary action, so keep to one gold button in view.
- The minus 16 degree angle is for small details only. No large diagonal slabs,
  and no rows of slanted stripes as dividers, progress or meters.
- Square corners on panels and controls; the cut corner is the only shape
  change.
- Focus is always visible: a 2px gold ring offset from the element.
- Touch targets are at least 44px and no text is under 13px.
- The layout holds at 320px with no horizontal scroll.
