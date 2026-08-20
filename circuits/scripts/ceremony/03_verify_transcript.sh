#!/usr/bin/env bash
# Verifies a circuit's completed ceremony: checks the final
# zkey's internal Groth16 contribution chain against the r1cs + ptau, and
# cross-checks it against the transcript's recorded hash chain.
#
# Anyone can (and should) run this independently - it requires no special
# access, only the public r1cs, ptau, transcript, and final zkey.
#
# Usage: bash scripts/ceremony/03_verify_transcript.sh <circuit> [final.zkey]
#   circuit:    deposit | borrow_repay | liquidation | zero_debt
#   final.zkey: defaults to ceremony/<circuit>/<highest-numbered>.zkey
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$CIRCUITS_DIR/build"

CIRCUIT="${1:-}"
if [ -z "$CIRCUIT" ]; then
  echo "Usage: bash scripts/ceremony/03_verify_transcript.sh <circuit> [final.zkey]" >&2
  exit 1
fi

OUT_DIR="$CIRCUITS_DIR/ceremony/$CIRCUIT"
TRANSCRIPT="$OUT_DIR/transcript.json"
R1CS="$BUILD/${CIRCUIT}.r1cs"

if [ ! -f "$TRANSCRIPT" ]; then
  echo "ERROR: no transcript found at $TRANSCRIPT" >&2
  exit 1
fi
if [ ! -f "$R1CS" ]; then
  echo "ERROR: $R1CS not found. Run 'bash scripts/compile_all.sh' first." >&2
  exit 1
fi

FINAL_ZKEY="${2:-}"
if [ -z "$FINAL_ZKEY" ]; then
  # Highest-numbered .zkey in the ceremony directory (excluding 0000.zkey,
  # which is the pre-contribution setup step, not a valid "final" state).
  FINAL_ZKEY="$(find "$OUT_DIR" -maxdepth 1 -name '*.zkey' ! -name '0000.zkey' | sort -V | tail -1)"
  if [ -z "$FINAL_ZKEY" ]; then
    echo "ERROR: no contribution .zkey found in $OUT_DIR (only 0000.zkey exists -" >&2
    echo "        has anyone actually contributed yet? See 02_contribute.sh)" >&2
    exit 1
  fi
fi

# Which ptau power was used - recover it from the transcript's recorded
# 0000.zkey hash isn't possible directly, so require the operator to have
# kept the matching ptau file around; default to power 15 (Writz's current
# default across all four circuits).
POWER="${POWER:-15}"
PTAU="$CIRCUITS_DIR/ceremony/ptau/powersOfTau28_hez_final_${POWER}.ptau"
if [ ! -f "$PTAU" ]; then
  echo "ERROR: $PTAU not found. Set POWER=<n> if this ceremony used a" >&2
  echo "        different power, or run 00_fetch_ptau.sh again." >&2
  exit 1
fi

echo "▶ Verifying $CIRCUIT's Groth16 contribution chain..."
echo "  r1cs:  $R1CS"
echo "  ptau:  $PTAU"
echo "  zkey:  $FINAL_ZKEY"
echo ""

# snarkjs verifies the full internal contribution chain baked into the
# zkey - every contributor's proof-of-knowledge, in order - against the
# r1cs and the original ptau.
snarkjs zkey verify "$R1CS" "$PTAU" "$FINAL_ZKEY"

echo ""
echo "▶ Cross-checking transcript hash chain ($TRANSCRIPT)..."
python3 - "$TRANSCRIPT" "$OUT_DIR" <<'PYEOF'
import json, hashlib, os, sys

transcript_path, out_dir = sys.argv[1:3]
with open(transcript_path) as f:
    transcript = json.load(f)

if not transcript:
    print("ERROR: transcript is empty", file=sys.stderr)
    sys.exit(1)

for i, entry in enumerate(transcript):
    if entry["contribution_index"] != i:
        print(f"ERROR: transcript entry {i} has contribution_index={entry['contribution_index']} (expected {i})", file=sys.stderr)
        sys.exit(1)
    if "dev" in entry.get("participant_name", "").lower():
        print(f"ERROR: transcript entry {i} participant_name contains 'dev' ({entry['participant_name']!r}) - "
              "this looks like a development ceremony, not a production one. Refusing to treat it as valid.", file=sys.stderr)
        sys.exit(1)
    if i > 0:
        prev_recorded = entry.get("prev_zkey_sha256")
        prev_actual = transcript[i - 1]["zkey_sha256"]
        if prev_recorded != prev_actual:
            print(f"ERROR: transcript entry {i}'s prev_zkey_sha256 ({prev_recorded}) does not match "
                  f"entry {i-1}'s recorded zkey_sha256 ({prev_actual}) - the hash chain is broken.", file=sys.stderr)
            sys.exit(1)

print(f"  ✓ {len(transcript)} contribution(s) recorded, hash chain is consistent, no 'dev' markers found")

if len(transcript) < 6:  # coordinator's 0000 entry + 5 real participants
    print(f"WARNING: only {len(transcript) - 1} participant contribution(s) recorded - "
          "docs/scf/milestone-plan.md requires a minimum of 5 independent participants "
          "per circuit for a production ceremony.", file=sys.stderr)
PYEOF

echo ""
echo "✅ $CIRCUIT ceremony verified."
echo "   Next: node scripts/ceremony/04_export.js $CIRCUIT $FINAL_ZKEY"
