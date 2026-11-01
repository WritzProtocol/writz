# writz-lend bindings

TypeScript client for the `writz-lend` Soroban contract, generated from the
contract built in this repository rather than from a deployment, so it always
matches `contracts/contracts/writz-lend` on the same commit. The relayer
imports it as the `writz-lend` package (`file:../packages/writz-lend`).

The app keeps a byte-identical copy in
`frontend/app/src/lib/contracts/writzLendGenerated.ts`: bun installs a `file:`
dependency as per-file symlinks, and Turbopack cannot resolve a package whose
`package.json` is a symlink. The script writes and checks both files.

`src/index.ts` is generated. Do not edit it by hand: change the contract, then
regenerate.

```bash
scripts/writz-lend-bindings.sh           # rebuild the wasm and rewrite both files
scripts/writz-lend-bindings.sh --check   # fail if either file is out of date
```

The script runs, with stellar-cli 28.1.0:

```bash
(cd contracts && cargo build --release --target wasm32v1-none --locked -p writz-lend)
stellar contract bindings typescript \
  --wasm contracts/target/wasm32v1-none/release/writz_lend.wasm \
  --output-dir <tmp>/writz-lend --overwrite
```

and copies `<tmp>/writz-lend/src/index.ts` to both places. CI runs the
`--check` form, so a contract change that is not regenerated fails the build.

Like `privacy/packages/commitment-tree`, the package has its own dependencies:
run `bun install --frozen-lockfile` here before installing the relayer.

The client carries no contract ID: pass `contractId`, `networkPassphrase` and
`rpcUrl` to `new Client(...)`. IDs of record are in
`contracts/deployments/testnet.md`.
