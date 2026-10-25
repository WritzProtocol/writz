# Releasing

Two packages are published from this repository, each by its own workflow, when a version tag is pushed:

| Package | Registry | Source | Tag | Workflow |
|---|---|---|---|---|
| `@writz/sdk` | npm | `packages/sdk` | `sdk-v<version>` | `.github/workflows/release-sdk.yml` |
| `writz-spv-client` | crates.io | `contracts/contracts/writz-spv-client` | `writz-spv-client-v<version>` | `.github/workflows/release-spv-client.yml` |

Each workflow checks that the tag matches the package version, runs the tests, publishes, and creates a GitHub Release for the tag. The two release independently.

## One-time setup

Both registries publish through trusted publishing (OIDC): the registry trusts this repository, the workflow file and its GitHub environment, and the job gets a short-lived credential at publish time. No registry token is stored in GitHub.

### npm (`@writz/sdk`)

- The `writz` organization exists on npmjs.com and its admins manage the package.
- Package `@writz/sdk` > Settings > Trusted Publisher: GitHub Actions, organization `WritzProtocol`, repository `writz`, workflow `release-sdk.yml`, environment `npm`, with permission to publish.
- Publishing access: two-factor authentication required and tokens disallowed, so only the workflow can publish.

Every publish carries npm provenance, which links the tarball to the workflow run and the commit it was built from.

### crates.io (`writz-spv-client`)

- Crate `writz-spv-client` > Settings > Trusted Publishing: GitHub, repository `WritzProtocol/writz`, workflow `release-spv-client.yml`, environment `crates-io`.
- Add the other maintainers as owners: `cargo owner --add <github-user> writz-spv-client`.

A new package needs one token publish first, because both registries attach a trusted publisher only to a package that already exists. Use a short-lived token for that publish, then configure trusted publishing and revoke the token.

## Verify before tagging

Both workflows can be run by hand with **dry run** checked (Actions > the workflow > Run workflow, on `main`). A dry run builds, tests and packages exactly as a release does, runs `npm publish --dry-run` or `cargo publish --dry-run`, and writes the result to the run summary. It publishes nothing and creates no release.

Locally:

```bash
# @writz/sdk
cd packages/sdk
bun install --frozen-lockfile && bun run typecheck && bun test
npm pack --dry-run          # lists the tarball: dist, src, README.md, LICENSE, package.json
npm publish --dry-run

# writz-spv-client
cd contracts
cargo test -p writz-spv-client --locked
cargo publish -p writz-spv-client --locked --dry-run
```

## Release

1. On `main`, bump the version in `packages/sdk/package.json` or `contracts/contracts/writz-spv-client/Cargo.toml` (then run `cargo update -p writz-spv-client` in `contracts` so `Cargo.lock` follows), and merge that change. The first release is `0.1.0` for both, already set.
2. For `@writz/sdk`, check the network preset first: `node scripts/sync-deployments.mjs --check`. The preset is generated from `contracts/deployments/testnet.md`, so a redeploy recorded there needs a new SDK release.
3. Tag the merged commit and push the tag:

   ```bash
   git switch main && git pull
   git tag sdk-v0.1.0 && git push origin sdk-v0.1.0
   git tag writz-spv-client-v0.1.0 && git push origin writz-spv-client-v0.1.0
   ```

4. Watch the run in Actions. When it is green, the package is on the registry and the GitHub Release exists.

A published version cannot be replaced. If a run fails after publishing, fix forward with the next patch version. If it fails before publishing, fix the cause on `main`, then delete the tag (`git push origin :refs/tags/<tag>` and `git tag -d <tag>`) and push it again on the fixed commit.
