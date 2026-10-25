# Releasing

Two packages are published from this repository, each by its own workflow, when a version tag is pushed:

| Package | Registry | Source | Tag | Workflow |
|---|---|---|---|---|
| `@writz/sdk` | npm | `packages/sdk` | `sdk-v<version>` | `.github/workflows/release-sdk.yml` |
| `writz-spv-client` | crates.io | `contracts/contracts/writz-spv-client` | `writz-spv-client-v<version>` | `.github/workflows/release-spv-client.yml` |

Each workflow checks that the tag matches the package version, runs the tests, publishes, and creates a GitHub Release for the tag. The two release independently.

## One-time setup

### npm (`@writz/sdk`)

1. The `writz` organization exists on npmjs.com and the publishing account is a member with publish rights.
2. Create a granular access token on npmjs.com (Access Tokens > Generate New Token > Granular Access Token): permission **Read and write** on packages, scoped to `@writz`, with **Bypass two-factor authentication** enabled so CI can publish. Note its expiry date.
3. In GitHub (Settings > Environments) create the environment `npm` if it does not exist yet, and add the token as the secret `NPM_TOKEN`, either on that environment or on the repository.
4. After the first publish, switch to trusted publishing (configured for `@writz/sdk` since 0.1.1): on npmjs.com, package `@writz/sdk` > Settings > Trusted Publisher > GitHub Actions, with organization `WritzProtocol`, repository `writz`, workflow `release-sdk.yml` and environment `npm`. From then on npm authenticates the workflow with OIDC and `NPM_TOKEN` can be deleted. Trusted publishing cannot do the first publish, because npm only attaches a trusted publisher to a package that exists.

Every publish carries npm provenance, which links the tarball to the workflow run and the commit it was built from.

### crates.io (`writz-spv-client`)

1. Sign in to crates.io with the GitHub account that will own the crate, and verify its email address (crates.io refuses to publish without one).
2. Create an API token (Account Settings > API Tokens > New Token) with the scopes **publish-new** and **publish-update**, crate pattern `writz-spv-client`.
3. In GitHub (Settings > Environments) create the environment `crates-io` if it does not exist yet, and add the token as the secret `CARGO_REGISTRY_TOKEN`, either on that environment or on the repository.
4. After the first publish, add the other maintainers as owners: `cargo owner --add <github-user> writz-spv-client`.

GitHub creates an environment named in a workflow the first time the workflow runs, if it does not exist. Creating it by hand first lets you add the secret to it and set protection rules, such as required reviewers.

## Verify before tagging

Both workflows can be run by hand with **dry run** checked (Actions > the workflow > Run workflow, on `main`). A dry run builds, tests and packages exactly as a release does, runs `npm publish --dry-run` or `cargo publish --dry-run`, checks the token (`npm whoami` for `NPM_TOKEN`, presence for `CARGO_REGISTRY_TOKEN`), and writes the result to the run summary. It publishes nothing and creates no release.

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
