# Writz frontend

Two independent Next.js apps, each its own Vercel project:

- `landing/` serves writz.xyz: the marketing site, the brand page and the
  whitepaper.
- `app/` is the dApp (Borrow, Earn, Lend and the Protocol page). It is
  deployed once per network: testnet.writz.xyz today, app.writz.xyz when
  mainnet ships.

Each has its own `package.json`, lockfile and `bun install`. See each folder's
README for setup, and `../docs/developers/deploy-targets.md` for how they are
provisioned. Both read the Graphite & Gold tokens from `../packages/brand`; the
design system is described in `DESIGN_SYSTEM.md`.
