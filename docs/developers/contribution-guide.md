---
title: "Contributing to Writz"
---

Writz is open source. Bug reports, code, documentation and security research are welcome. This page explains how to contribute.

---

## Ways to Contribute

**Bug reports:** If you find a bug in any of the contracts, the relayer, or the bitcoin-script toolkit, open a GitHub issue with a minimal reproduction. Include the test case if possible.

**Code contributions:** See the open issues tagged `good first issue` or `help wanted` on GitHub. All contributions require tests. The CI must pass before merge.

**Documentation:** Spotted something unclear, incorrect, or missing? Open a PR directly against the `docs/` directory.

**Security research:** See the [Bug Bounty](/security/bug-bounty) page for responsible disclosure guidelines.

---

## Development Setup

```bash
git clone https://github.com/WritzProtocol/writz.git
cd writz

# Install all dependencies. Note the package manager differs per module:
# Bun for bitcoin-script / relayer / frontend / packages/*.
cd contracts && cargo fetch
cd ../bitcoin-script && bun install && bun run build
cd ../packages/writz-lend && bun install
cd ../../relayer && bun install
```

All 845 tests should pass on a clean checkout.

---

## Secrets

`relayer/.env.example` and `frontend/app/.env.example` are tracked deliberately, so
no `.gitignore` rule protects them, and a directory-wide `git add` stages
whatever they happen to contain.

A pre-commit hook scans staged additions for live-looking credentials, `sk_`
keys, Stellar `S...` seeds, Bitcoin WIF keys, PEM private key blocks and AWS
access key ids. Install it once per clone:

```bash
git config core.hooksPath scripts/hooks
```

It reads staged content only, so it costs nothing on an unrelated commit and a
clean working tree cannot hide anything from it. Documentation placeholders like
`sk_...` or `sk_your_api_key_here` do not trip it.

Two habits the hook does not replace:

- Review the staged diff, not the list of filenames. A file showing as modified
  when you did not expect to touch it is the signal worth stopping on.
- Treat a pushed secret as published. Deleting the commit does not un-publish
  it, and an orphaned commit stays reachable by its SHA. Revoke first.

## Keeping the docs in sync

Contract addresses and test counts are quoted in many places and drift after a redeploy or when tests are added. Scripts guard against that:

- After a redeploy, update `contracts/deployments/testnet.md` first: it is the source of truth every other doc is checked against. Then run `node scripts/sync-deployments.mjs` to regenerate `contracts/deployments/testnet.json` and the `@writz/sdk` network preset.
- After adding/removing tests, run `node scripts/update-test-counts.mjs` to regenerate `docs/_data/facts.json` from the real test suites.
- Before opening a PR that touches deployments or docs, run `node scripts/check-docs-sync.mjs`. It scans every `.md` file for contract addresses and "N tests" mentions that do not match the current truth, and CI runs it on every PR.

---

## Code Standards

### Rust / Soroban Contracts

- Run `cargo fmt` and `cargo clippy` before committing
- Every public function must have a test
- Use `#[contractevent]` for all events, not the deprecated `Events` API
- Per-entry persistent storage only: no growing `Vec` or `Map` in instance storage
- Manage TTL: every write to persistent storage must set TTL thresholds
- No `unwrap()` on user inputs: return errors via `Result` or panic with descriptive messages

### TypeScript (Relayer + Bitcoin Script)

- Run `bun run lint` before committing
- Every function must have a test covering the happy path and at least one error case
- No `any` types; use explicit type annotations
- Use the `Result<T, E>` pattern for operations that can fail

## Pull Request Process

1. Fork the repository and create a feature branch (`feature/your-feature`)
2. Make your changes with tests
3. Run `cargo test` (contracts), `bun test` (bitcoin-script) and `bun run test` (relayer); all must pass
4. Open a PR with a clear description of what changed and why
5. A maintainer will review within 5 business days

---

## Open Items

The following areas are actively looking for contributors:

| Area | Description | Skill needed |
|---|---|---|
| Frontend (testnet.writz.xyz) | The Next.js app for Writz Lend, on testnet | React, TypeScript, Stellar Wallets Kit |
| `@writz/sdk` | Examples and integrations for the published TypeScript SDK | TypeScript, npm |
| Oracle integration | Add RedStone's BTC/USD feed beside Reflector, with a divergence guard | Rust, Soroban |

If you want to work on any of these, open an issue first to discuss the approach before writing code.
