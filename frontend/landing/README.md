# Writz landing

The marketing site, the brand page and the whitepaper, served at writz.xyz.
Next.js (App Router), React, TypeScript. It has no wallet, chain or ZK
dependencies: the dApp lives in `../app`.

## Setup

    cp .env.example .env.local
    bun install
    bun run dev

## Styling

Plain CSS, no Tailwind. `src/app/globals.css` imports the shared Graphite & Gold
tokens from `../../packages/brand/tokens.css`, and each page styles itself with
scoped stylesheets that read those tokens: `src/features/landing/landing.css`
for the landing (also used by `/brand`), `src/app/brand/press.css` and
`src/app/whitepaper/whitepaper.css`. The design system is documented in
`../DESIGN_SYSTEM.md`.

## Troubleshooting

If the dev server shows "Could not find the module ... in the React Client
Manifest" after pulling changes that touch `packages/brand` or
`next.config.ts`, stop it, delete this app's `.next` folder and run
`bun run dev` again.
