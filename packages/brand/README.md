# brand

The Graphite & Gold design tokens shared by `frontend/app` and `frontend/landing`: colours, type families, the control radius and the motion tiers, plus the Tailwind theme that maps them to utilities. CSS only, no build step.

`tokens.css` declares every token as a plain custom property on `:root`, so a utility or a rule reads it with `var(--bg)`, `var(--accent)` and so on.

## Using it

Both apps reach it through `theme.css`, which imports `tokens.css` (see below); nothing imports `tokens.css` directly.

## Tailwind theme

`theme.css` maps the tokens to Tailwind v4 utilities (`bg-surface`, `text-heading`, `text-accent`, `shadow-border`, `rounded-control`, `ease-enter`, `font-mono`) with `@theme inline reference`, so the values stay in `tokens.css` and a token change needs no edit in the theme. It imports `tokens.css` itself, and also defines:

- `hover:` only where a fine pointer can hover (`(hover: hover) and (pointer: fine)`), as both apps always did, so touch screens never keep a stuck hover state.
- `duration-micro`, `duration-element`, `duration-section` and `duration-signature`, the motion tiers. Like Tailwind's own `duration-*` they compose with `transition-*`.
- `slant`, the parallelogram at the mark's minus 16 degrees drawn behind an element. Set its fill with `[--slant-bg:var(--accent)]` and its horizontal inset with `[--slant-inset:6px]`. A plain skewed box is `-skew-x-16`.
- `cut` and `cut-sm`, the cut corner on panels.

Each app imports it from its `globals.css`:

```css
@import "tailwindcss";
@import "../../../../packages/brand/theme.css";
```

The landing imports Tailwind's theme and utilities without preflight and with source detection off, and lists the folders that hold class strings with `@source` lines in `frontend/landing/src/app/globals.css`.

Both apps set the `next/font` variables `--ff-sans` (Work Sans) and `--ff-mono` (Geist Mono) on `<html>`, which `--font-sans` and `--font-mono` resolve against.

Files outside an app folder are only reachable because each `next.config.ts` sets `turbopack.root` and `outputFileTracingRoot` to the repository root, and each `vercel.json` `ignoreCommand` also diffs `packages/brand`, so a token change rebuilds both sites.
