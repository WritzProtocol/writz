#!/usr/bin/env bash
#
# Checks how old the bitcoin-spv contract's difficulty checkpoint is and
# exits non-zero if it's past the recommended refresh window.
#
# Closes a real gap: `set_checkpoint` is admin-gated and there is no
# on-chain automation or alert if nobody calls it - the checkpoint can go
# arbitrarily stale with the contract still accepting deposits against a
# widening difficulty-floor band (see docs/security/security-model.md,
# "Checkpoint difficulty floor"). This script is the missing "somebody
# notices" step; it does not refresh the checkpoint itself.
#
# Usage:
#   BITCOIN_SPV_ID=<contract id> ./check-checkpoint-age.sh [network]
#
# Exit codes (standard cron/monitoring convention):
#   0 = healthy (within WARN_DAYS)
#   1 = warning (past WARN_DAYS, not yet critical)
#   2 = critical (past CRIT_DAYS) or an operational failure (missing config,
#       checkpoint never set, CLI/RPC error) - treat all of these as
#       "needs a human," not just the age check itself.
#
# Run this on a schedule (cron/CI) and alert on any non-zero exit.

set -euo pipefail

NETWORK="${1:-testnet}"
BITCOIN_SPV_ID="${BITCOIN_SPV_ID:?Set BITCOIN_SPV_ID to the deployed bitcoin-spv contract address}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-writz-deployer}"

# Soroban RPC JSON-RPC endpoint, for getLatestLedger - queried directly via
# curl rather than the `stellar` CLI, since the CLI's exact subcommand for
# "current ledger sequence" has moved between versions; the RPC method
# itself (getLatestLedger) is a stable, documented API.
case "$NETWORK" in
  testnet) DEFAULT_RPC_URL="https://soroban-testnet.stellar.org" ;;
  mainnet) DEFAULT_RPC_URL="https://mainnet.sorobanrpc.com" ;;
  *) DEFAULT_RPC_URL="" ;;
esac
RPC_URL="${RPC_URL:-$DEFAULT_RPC_URL}"
if [ -z "$RPC_URL" ]; then
  echo "CRITICAL: set RPC_URL explicitly for network '$NETWORK' (no default known for it)" >&2
  exit 2
fi

# Matches LEDGERS_PER_DAY in contracts/contracts/*/src/storage.rs (5s ledger close time).
LEDGERS_PER_DAY=17280
WARN_DAYS="${WARN_DAYS:-7}"   # matches the "operationally, weekly" refresh recommendation
CRIT_DAYS="${CRIT_DAYS:-14}"  # double the recommendation - clearly overdue, not just due

if ! command -v stellar >/dev/null 2>&1; then
  echo "CRITICAL: stellar CLI not found on PATH" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "CRITICAL: jq not found on PATH" >&2
  exit 2
fi

checkpoint_json=$(stellar contract invoke \
  --id "$BITCOIN_SPV_ID" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- get_checkpoint 2>&1) || {
    echo "CRITICAL: get_checkpoint invocation failed: $checkpoint_json" >&2
    exit 2
  }

if [ "$checkpoint_json" = "null" ] || [ -z "$checkpoint_json" ]; then
  echo "CRITICAL: no checkpoint set at all (CheckpointNotSet) - deposits cannot verify until set_checkpoint is called" >&2
  exit 2
fi

set_at_ledger=$(echo "$checkpoint_json" | jq -r '.set_at_ledger // empty')
if [ -z "$set_at_ledger" ]; then
  echo "CRITICAL: could not parse set_at_ledger from get_checkpoint output: $checkpoint_json" >&2
  exit 2
fi

current_ledger_json=$(curl -sS -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}') || {
    echo "CRITICAL: could not reach RPC at $RPC_URL to fetch the current ledger" >&2
    exit 2
  }
current_ledger=$(echo "$current_ledger_json" | jq -r '.result.sequence // empty')
if [ -z "$current_ledger" ]; then
  echo "CRITICAL: could not parse .result.sequence from getLatestLedger response: $current_ledger_json" >&2
  exit 2
fi

age_ledgers=$(( current_ledger - set_at_ledger ))
age_days=$(( age_ledgers / LEDGERS_PER_DAY ))

echo "bitcoin-spv checkpoint: set at ledger $set_at_ledger, current ledger $current_ledger, age ~${age_days}d"

if [ "$age_days" -ge "$CRIT_DAYS" ]; then
  echo "CRITICAL: checkpoint is ${age_days} days old (>= ${CRIT_DAYS}d) - refresh via set_checkpoint immediately" >&2
  exit 2
elif [ "$age_days" -ge "$WARN_DAYS" ]; then
  echo "WARNING: checkpoint is ${age_days} days old (>= ${WARN_DAYS}d) - schedule a refresh" >&2
  exit 1
fi

echo "OK: checkpoint is within the ${WARN_DAYS}-day recommendation"
exit 0
