# Contributing to Writz

Writz is open source. Contributions - bug reports, code improvements, documentation, and security research - are welcome. This page explains how to contribute effectively.

---

## Ways to Contribute

**Bug reports:** If you find a bug in any of the contracts, circuits, relayer, or bitcoin-script toolkit, open a GitHub issue with a minimal reproduction. Include the test case if possible.

**Code contributions:** See the open issues tagged `good first issue` or `help wanted` on GitHub. All contributions require tests. The CI must pass before merge.

**Documentation:** Spotted something unclear, incorrect, or missing? Open a PR directly against the `docs/` directory.

**Security research:** See the [Bug Bounty](../security/bug-bounty.md) page for responsible disclosure guidelines and rewards.

**ZK ceremony participation:** The Groth16 trusted setup ceremony requires independent participants. If you're interested in participating, [open an issue](https://github.com/WritzProtocol/writz/issues) (`writz.xyz` has no mailbox yet). No technical background required - participants just need to run a script and discard their randomness.

---

## Development Setup

```bash
git clone https://github.com/WritzProtocol/writz.git
cd writz

# Install all dependencies. Note the package manager differs per module:
# Bun for bitcoin-script / relayer / frontend / packages/*, npm for circuits.
cd contracts && cargo fetch
cd ../bitcoin-script && bun install && bun run build
cd ../packages/commitment-tree && bun install
cd ../../relayer && bun install
cd ../circuits && npm install
```

All 384 tests should pass on a clean checkout.

---

## Keeping the docs in sync

Contract addresses and test counts are quoted in a lot of places (README, SCF docs, community posts) and drift easily after a redeploy or when tests are added. Two scripts guard against that:

- After a redeploy, update `contracts/deployments/testnet.md` - it's the source of truth every other doc is checked against.
- After adding/removing tests, run `node scripts/update-test-counts.mjs` to regenerate `docs/_data/facts.json` from the real test suites.
- Before opening a PR that touches deployments or docs, run `node scripts/check-docs-sync.mjs` - it scans every `.md` file for contract addresses and "N tests" mentions that don't match the current truth, and CI runs it on every PR regardless.

---

## Code Standards

### Rust / Soroban Contracts

- Run `cargo fmt` and `cargo clippy` before committing
- Every public function must have a test
- Use `#[contractevent]` for all events - no deprecated `Events` API
- Per-entry persistent storage only - no growing `Vec` or `Map` in instance storage
- Manage TTL: every write to persistent storage must set TTL thresholds
- No `unwrap()` on user inputs - return errors via `Result` or panic with descriptive messages

### TypeScript (Relayer + Bitcoin Script)

- Run `bun run lint` before committing
- Every function must have a test covering the happy path and at least one error case
- No `any` types - explicit type annotations required
- Use the `Result<T, E>` pattern for operations that can fail

### Circom Circuits

- Every constraint must be intentional - document why it exists
- All public inputs must be explicitly marked `<== signal (public)`
- Test proof generation AND proof verification - not just compilation
- Test with both valid and invalid inputs - verify that invalid inputs are rejected

---

## Pull Request Process

1. Fork the repository and create a feature branch (`feature/your-feature`)
2. Make your changes with tests
3. Run `cargo test` (contracts), `bun test` (bitcoin-script), `bun run test` (relayer), `npm test` (circuits) - all must pass
4. Open a PR with a clear description of what changed and why
5. A maintainer will review within 5 business days

---

## Open Items

The following areas are actively looking for contributors:

| Area | Description | Skill needed |
|---|---|---|
| Frontend (app.writz.xyz) | React/Next.js frontend for PrivateLend | React, TypeScript, Stellar Wallets Kit |
| WASM prover integration | Integrate circom WASM prover in browser | TypeScript, snarkjs |
| Phase 2 ceremony tooling | Scripts for Powers of Tau Phase 2 ceremony | snarkjs, cryptography |
| Taproot migration | Upgrade P2WSH to P2TR for Phase 2 | Bitcoin Script, bitcoinjs-lib |
| SDK npm package | `writz-sdk` TypeScript package for SPV proof assembly | TypeScript, npm |
| Oracle integration | Integrate RedStone + Pyth SEP-40 adapters | Rust, Soroban |

If you want to work on any of these, open an issue first to discuss the approach before writing code.
