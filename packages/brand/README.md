# brand

The Graphite & Gold design tokens shared by `frontend/app` and `frontend/landing`: colours, type families, the control radius and the motion tiers. CSS only, no build step.

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

  `globals.css` maps the colours into Tailwind with an `@theme inline` block (`--color-bg: var(--bg)` and so on), which gives utilities such as `bg-surface` and `text-muted`. The landing can copy that block when it moves to Tailwind.

Both apps set the `next/font` variables `--ff-sans` (Work Sans) and `--ff-mono` (Geist Mono) on `<html>`, which `--font-sans` and `--font-mono` resolve against.

Files outside an app folder are only reachable because each `next.config.ts` sets `turbopack.root` and `outputFileTracingRoot` to the repository root, and each `vercel.json` `ignoreCommand` also diffs `packages/brand`, so a token change rebuilds both sites.
