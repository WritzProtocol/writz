# brand

The Graphite & Gold design tokens shared by `frontend/app` and `frontend/landing`: colours, type families, the control radius and the motion tiers, plus the Tailwind theme that maps them to utilities. CSS only, no build step.

`tokens.css` declares every token as a plain custom property on `:root`, so scoped stylesheets read it with `var(--bg)`, `var(--accent)` and so on.

## Using it

- `frontend/landing` imports it at the top of `src/app/globals.css`:

  ```css
  @import "../../../../packages/brand/tokens.css";
  ```

- `frontend/app` imports it from `src/app/layout.tsx`, next to `globals.css`. Its `globals.css` goes through Tailwind, which resolves `@import` paths from the app root under Turbopack rather than from the file, so the import lives in the layout:

  ```ts
  import "../../../../packages/brand/tokens.css";
  ```

## Tailwind theme

`theme.css` maps the tokens to Tailwind v4 utilities (`bg-surface`, `text-heading`, `text-accent`, `shadow-border`, `rounded-control`, `ease-enter`, `font-mono`) with `@theme inline reference`, so the values stay in `tokens.css` and a token change needs no edit in the theme. It imports `tokens.css` itself, and also defines:

- `duration-micro`, `duration-element`, `duration-section` and `duration-signature`, the motion tiers.
- `slant`, the parallelogram at the mark's minus 16 degrees drawn behind an element. Set its fill with `[--slant-bg:var(--accent)]` and its horizontal inset with `[--slant-inset:6px]`. A plain skewed box is `-skew-x-16`.
- `cut` and `cut-sm`, the cut corner on panels.

Each app imports it from its `globals.css`:

```css
@import "tailwindcss";
@import "../../../../packages/brand/theme.css";
```

The landing imports Tailwind's theme and utilities without preflight and with source detection off, so its plain stylesheets render as before; a page that moves to utilities is added with an `@source` line in `frontend/landing/src/app/globals.css`.

Both apps set the `next/font` variables `--ff-sans` (Work Sans) and `--ff-mono` (Geist Mono) on `<html>`, which `--font-sans` and `--font-mono` resolve against.

Files outside an app folder are only reachable because each `next.config.ts` sets `turbopack.root` and `outputFileTracingRoot` to the repository root, and each `vercel.json` `ignoreCommand` also diffs `packages/brand`, so a token change rebuilds both sites.
