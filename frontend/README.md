# Writz frontend

Two independent Next.js apps, each its own Vercel project:

- `landing/` serves writz.xyz: the marketing site and the press page.
- `app/` is the dApp (Borrow, Lend, Earn and the `/metrics` dashboard). It is
  deployed once per network: testnet.writz.xyz today, app.writz.xyz when
  mainnet ships.

Each has its own `package.json`, lockfile and `bun install`. See each folder's
README for setup, and `../docs/developers/deploy-targets.md` for how they are
provisioned. The shared visual language is in `DESIGN_SYSTEM.md`.
