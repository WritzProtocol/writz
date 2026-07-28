#!/usr/bin/env bash
# Coordinator step 1 of the production trusted-setup ceremony:
# runs the initial Groth16 setup for one circuit against the pinned,
# checksum-verified Hermez ptau, producing contribution #0 — the starting
# point every participant's contribution (02_contribute.sh) builds on.
#
# Run this ONCE per circuit, by the ceremony coordinator only.
#
# Usage: bash scripts/ceremony/01_new_zkey.sh <circuit> [power]
#   circuit: deposit | borrow_repay | liquidation | zero_debt
#   power:   must match the ptau already fetched via 00_fetch_ptau.sh (default 15)
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$CIRCUITS_DIR/build"
CEREMONY="$CIRCUITS_DIR/ceremony"
POWER="${2:-15}"
PTAU="$CEREMONY/ptau/powersOfTau28_hez_final_${POWER}.ptau"

CIRCUIT="${1:-}"
if [ -z "$CIRCUIT" ]; then
  echo "Usage: bash scripts/ceremony/01_new_zkey.sh <circuit> [power]" >&2
  echo "  circuit: deposit | borrow_repay | liquidation | zero_debt" >&2
  exit 1
fi

R1CS="$BUILD/${CIRCUIT}.r1cs"
OUT_DIR="$CEREMONY/$CIRCUIT"
ZKEY0="$OUT_DIR/0000.zkey"
TRANSCRIPT="$OUT_DIR/transcript.json"

if [ ! -f "$R1CS" ]; then
  echo "ERROR: $R1CS not found. Run 'bash scripts/compile_all.sh' first." >&2
  exit 1
fi
if [ ! -f "$PTAU" ]; then
  echo "ERROR: $PTAU not found. Run 'bash scripts/ceremony/00_fetch_ptau.sh $POWER' first." >&2
  exit 1
fi
if [ -f "$ZKEY0" ]; then
  echo "ERROR: $ZKEY0 already exists — refusing to overwrite an in-progress ceremony." >&2
  echo "If you intend to restart this circuit's ceremony from scratch, move or" >&2
  echo "delete $OUT_DIR manually first (and be sure no one has started" >&2
  echo "contributing to it yet)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "▶ Groth16 setup for $CIRCUIT against $(basename "$PTAU")..."
snarkjs groth16 setup "$R1CS" "$PTAU" "$ZKEY0"

CONTRIBUTION_HASH="$(shasum -a 256 "$ZKEY0" | awk '{print $1}')"

cat > "$TRANSCRIPT" <<EOF
[
  {
    "contribution_index": 0,
    "participant_name": "coordinator (initial setup, no entropy contributed)",
    "timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "entropy_source_description": "none — this is the Groth16 setup step, not a contribution",
    "zkey_sha256": "$CONTRIBUTION_HASH",
    "prev_zkey_sha256": null,
    "asset_url": null
  }
]
EOF

echo ""
echo "✅ $CIRCUIT: 0000.zkey ready at $ZKEY0"
echo "   SHA-256: $CONTRIBUTION_HASH"
echo "   Transcript started: $TRANSCRIPT"
echo ""
echo "Next: distribute $ZKEY0 to the first participant, who runs:"
echo "   bash scripts/ceremony/02_contribute.sh $CIRCUIT <participant_name> $ZKEY0 $OUT_DIR/0001.zkey"
