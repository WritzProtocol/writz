#!/usr/bin/env bash
#
# Verifies, by calling the deployed contracts directly, which oracle
# providers actually expose a real (non-wrapped) BTC/USD feed on Stellar -
# rather than trusting provider docs/blog posts, which turned out to be
# wrong or stale for more than one provider during this research (see
# docs/research/oracle-design.md, "on-chain verification pass").
#
# This is a read-only diligence tool, not part of the oracle integration
# itself: it does not touch get_btc_price_stroops or any contract state.
#
# Usage:
#   contracts/scripts/verify-oracles.sh [network]
#
# network defaults to "testnet". Requires the `stellar` CLI (v22+) and an
# identity to sign the (simulation-only) invoke calls - create one with:
#   stellar keys generate verify-probe --network testnet --fund
# and set SOURCE_ACCOUNT=verify-probe, or let this script fall back to the
# default below.
#
# Addresses baked in below were confirmed live on Stellar testnet on
# 2026-09-16. Contracts can be redeployed - re-run this before trusting any
# of it again, especially before wiring a real oracle into the contracts or
# citing a specific address/finding externally (SCF application, audit
# scope, etc).

set -uo pipefail

NETWORK="${1:-testnet}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-verify-probe}"

if ! command -v stellar >/dev/null 2>&1; then
  echo "CRITICAL: stellar CLI not found on PATH" >&2
  exit 2
fi

# --- Known candidate addresses ------------------------------------------
# Source: Stellar's own oracle-providers documentation
# (developers.stellar.org/docs/data/oracles/oracle-providers), cross-checked
# against each provider's own docs/GitHub where reachable. Testnet-only;
# add mainnet addresses here once this is re-run against mainnet.
#
# Plain variables, not an associative array: macOS ships bash 3.2 by
# default (no `declare -A` support), and this needs to run on a laptop, not
# just CI - matches the portability constraint already documented in
# check-checkpoint-age.sh.

PYTH_VERIFIER="CAYFT5JE3UQTKT4Q6ZOZK4FXVYVT6RE3MFC7STA4UB6WAEGBT65MRU52"
REFLECTOR_STELLAR_ASSETS="CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP"
REFLECTOR_EXTERNAL_PRICES="CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63"
DIA_TESTNET="CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4"

pass=0
fail=0

section() { echo; echo "=== $1 ==="; }

# Confirms a contract exists at all and dumps its real exported interface -
# the cheapest way to catch a stale/wrong address before trying to call a
# function on it. Does not require SOURCE_ACCOUNT since it only reads the
# deployed Wasm's spec, not contract state.
#
# Tries 3 times, not once: the public testnet RPC this hits was observed
# during this research to give inconsistent "Contract not found" results
# for the same address across consecutive calls seconds apart (DIA's
# documented address failed 6 of 7 manual attempts, succeeded once) -
# almost certainly multiple backend RPC nodes out of sync with each other,
# not a real flip in contract state. A single check here would silently
# report a coin-flip result as ground truth. Report the hit rate, don't
# hide it - for a price feed this critical, "sometimes resolves" is itself
# the finding, not noise to average away.
check_exists() {
  local name="$1" id="$2" attempts=3 hits=0 last_output=""
  section "$name ($id)"
  for i in $(seq 1 "$attempts"); do
    last_output=$(stellar contract info interface --id "$id" --network "$NETWORK" 2>&1)
    if ! echo "$last_output" | grep -q "^error:\|Contract not found"; then
      hits=$((hits + 1))
    fi
  done
  if [ "$hits" -eq 0 ]; then
    echo "NOT FOUND on $NETWORK (0/$attempts attempts succeeded) - address is stale, wrong, or the contract was never deployed here."
    fail=$((fail + 1))
    return 1
  elif [ "$hits" -lt "$attempts" ]; then
    echo "FLAKY on $NETWORK ($hits/$attempts attempts succeeded) - the public RPC is giving inconsistent answers for this address. Treat as unreliable, not as confirmed live, regardless of which way the majority leans."
    fail=$((fail + 1))
    return 1
  fi
  echo "OK: contract exists on $NETWORK ($hits/$attempts attempts succeeded)."
  pass=$((pass + 1))
  return 0
}

# Calls a SEP-40-shaped lastprice() for a given Asset and prints the result.
# $3 is the raw JSON for the --asset arg, e.g. '{"Other":"BTC"}'.
try_lastprice() {
  local id="$1" label="$2" asset_json="$3"
  local out
  out=$(stellar contract invoke --id "$id" --source "$SOURCE_ACCOUNT" --network "$NETWORK" \
    -- lastprice --asset "$asset_json" 2>&1)
  if echo "$out" | grep -qi "error"; then
    echo "  $label: FAILED - $out"
  else
    echo "  $label: $out"
  fi
}

echo "Verifying oracle contracts on Stellar $NETWORK ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
echo "Source account for invoke calls: $SOURCE_ACCOUNT"

# --- Reflector: external CEXs & DEXs instance (the one with a real BTC ticker) ---
if check_exists "Reflector (external CEXs & DEXs)" "$REFLECTOR_EXTERNAL_PRICES"; then
  id="$REFLECTOR_EXTERNAL_PRICES"
  echo "Listing assets():"
  stellar contract invoke --id "$id" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- assets 2>&1 \
    | grep -v "^ℹ️\|^⚠️" | tee /tmp/reflector-external-assets.json
  if grep -q '"Other":"BTC"' /tmp/reflector-external-assets.json 2>/dev/null; then
    echo "FOUND plain BTC ticker. Fetching lastprice + decimals + resolution:"
    try_lastprice "$id" "lastprice(BTC)" '{"Other":"BTC"}'
    echo "  decimals: $(stellar contract invoke --id "$id" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- decimals 2>&1 | tail -1)"
    echo "  resolution (seconds): $(stellar contract invoke --id "$id" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- resolution 2>&1 | tail -1)"
  else
    echo "WARNING: no plain BTC ticker in assets() - re-check docs/research/oracle-design.md, something changed."
    fail=$((fail + 1))
  fi
fi

# --- Reflector: Stellar-assets instance (expected to NOT have plain BTC - only SAC tokens like SolvBTC) ---
if check_exists "Reflector (Stellar assets - expect SolvBTC, not BTC)" "$REFLECTOR_STELLAR_ASSETS"; then
  id="$REFLECTOR_STELLAR_ASSETS"
  echo "Listing assets() (expect Stellar contract addresses, not plain tickers):"
  stellar contract invoke --id "$id" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- assets 2>&1 | grep -v "^ℹ️\|^⚠️"
  echo "  (Do not wire this instance in as 'the BTC price' - see oracle-design.md for why.)"
fi

# --- DIA: documented address, expected to fail per the 2026-09-16 finding ---
check_exists "DIA (documented testnet address)" "$DIA_TESTNET" || \
  echo "  Expected per docs/research/oracle-design.md as of 2026-09-16. If this now succeeds, DIA is un-parked - update the docs."

# --- Pyth: verifier contract, no direct price read possible ---
if check_exists "Pyth (verifier)" "$PYTH_VERIFIER"; then
  echo "  Pyth's contract only verifies a caller-supplied signed Hermes payload"
  echo "  (verify_update(data: Bytes)) - there is nothing to read here without"
  echo "  first fetching a live update from Hermes off-chain. Not automated by"
  echo "  this script; see docs/research/oracle-design.md, 'Before wiring this in'."
fi

section "Summary"
echo "Checks passed: $pass"
echo "Checks failed: $fail"
if [ "$fail" -gt 0 ]; then
  echo "One or more contracts did not resolve as expected - see above before trusting docs/research/oracle-design.md's claims."
  exit 1
fi
echo "All checked contracts resolved as expected."
exit 0
