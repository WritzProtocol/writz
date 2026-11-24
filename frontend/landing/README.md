# Writz landing

The marketing site, the brand page and the whitepaper, served at writz.xyz.
Next.js (App Router), React, TypeScript. It has no wallet, chain or ZK
dependencies: the dApp lives in `../app`.

## Setup

    cp .env.example .env.local
    bun install
    bun run dev

## Styling

`src/app/globals.css` imports Tailwind (theme and utilities, no preflight) and the
shared Graphite & Gold theme from `../../packages/brand/theme.css`. The home page,
the navbar and the footer are styled with utilities, their class strings in
`src/features/landing/styles.ts`. `/about`, `/brand` and `/whitepaper` still use
their stylesheets (`src/app/about/about.css`, `src/app/brand/press.css`,
`src/app/whitepaper/whitepaper.css`, and the shared rules left in
`src/features/landing/landing.css`), which sit in a `legacy` cascade layer under
the utilities. A folder that moves to utilities gets an `@source` line in
`globals.css`. The design system is documented in `../DESIGN_SYSTEM.md`.

## Troubleshooting

If the dev server shows "Could not find the module ... in the React Client
Manifest" after pulling changes that touch `packages/brand` or
`next.config.ts`, stop it, delete this app's `.next` folder and run
`bun run dev` again.
