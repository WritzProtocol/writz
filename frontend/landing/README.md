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
shared Graphite & Gold theme from `../../packages/brand/theme.css`, and is the only
stylesheet. Every page is styled with utilities, the class strings in a `styles.ts`
next to the page: `src/features/landing/styles.ts` (the home page, the navbar and
the footer, and the pieces the other pages share), `src/app/brand/styles.ts`,
`src/app/about/styles.ts` and `src/app/whitepaper/styles.ts`. `globals.css` also
holds the page reset, the element defaults of the landing pages (in the `base`
layer, under the utilities), the scroll reveal, and the keyframes. Source
detection is off, so a folder that gets a `styles.ts` is listed with an `@source`
line there. The design system is documented in `../DESIGN_SYSTEM.md`.

## Troubleshooting

If the dev server shows "Could not find the module ... in the React Client
Manifest" after pulling changes that touch `packages/brand` or
`next.config.ts`, stop it, delete this app's `.next` folder and run
`bun run dev` again.
