#!/usr/bin/env bash
# Regenerates the writz-lend TypeScript bindings from the contract built in
# this repository, so they match the code rather than a deployment (#259):
#   packages/writz-lend/src/index.ts                      imported by the relayer
#   frontend/app/src/lib/contracts/writzLendGenerated.ts  the app's copy
# The app keeps its own byte-identical copy because Turbopack cannot resolve a
# bun `file:` dependency, which bun installs as per-file symlinks. Both are
# written and checked together, so neither can drift from the contract.
#
# Usage (from anywhere in the repo):
#   scripts/writz-lend-bindings.sh           # rebuild the wasm, rewrite the bindings
#   scripts/writz-lend-bindings.sh --check   # rebuild the wasm, fail if the bindings differ
#
# The output depends on the CLI version, so the version is pinned here and in
# CI. STELLAR overrides which binary runs (default: `stellar` on PATH).
set -euo pipefail

STELLAR_CLI_VERSION="28.1.0"
STELLAR="${STELLAR:-stellar}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
targets=(
  "$root/packages/writz-lend/src/index.ts"
  "$root/frontend/app/src/lib/contracts/writzLendGenerated.ts"
)
wasm="$root/contracts/target/wasm32v1-none/release/writz_lend.wasm"

check=false
case "${1:-}" in
  --check) check=true ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

version="$("$STELLAR" --version | head -n1 | awk '{print $2}')"
if [ "$version" != "$STELLAR_CLI_VERSION" ]; then
  echo "error: stellar CLI $STELLAR_CLI_VERSION is required, found $version ($STELLAR)" >&2
  exit 1
fi

(cd "$root/contracts" && cargo build --release --target wasm32v1-none --locked -p writz-lend)

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
"$STELLAR" contract bindings typescript --wasm "$wasm" --output-dir "$out/writz-lend" --overwrite >/dev/null

generated="$out/writz-lend/src/index.ts"
stale=0
for target in "${targets[@]}"; do
  rel="${target#"$root"/}"
  if $check; then
    if diff -u "$target" "$generated"; then
      echo "$rel matches the contract."
    else
      echo "error: $rel is out of date with contracts/contracts/writz-lend." >&2
      stale=1
    fi
  else
    cp "$generated" "$target"
    echo "Wrote $rel."
  fi
done
if [ "$stale" -ne 0 ]; then
  echo "Run scripts/writz-lend-bindings.sh and commit the result." >&2
  exit 1
fi
