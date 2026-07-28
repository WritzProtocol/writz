#!/usr/bin/env bash
# Participant step of the production trusted-setup ceremony:
# adds one contribution to a circuit's zkey chain.
#
# Run this by EACH ceremony participant, once per circuit, in sequence.
# Unlike `scripts/setup_dev.sh`'s `snarkjs zkey contribute`, this does NOT
# pass a scripted `-e` entropy flag — each participant must supply their
# own real entropy. Run this script interactively (no args after the
# in/out paths) so snarkjs prompts for entropy at the terminal; do not
# automate this step or pipe in a fixed string, since that would defeat
# the entire point of a multi-party ceremony (a leaked or predictable
# entropy source lets that participant alone compute the toxic waste).
#
# Usage: bash scripts/ceremony/02_contribute.sh <circuit> <participant_name> <in.zkey> <out.zkey>
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CIRCUIT="${1:-}"
PARTICIPANT="${2:-}"
IN_ZKEY="${3:-}"
OUT_ZKEY="${4:-}"

if [ -z "$CIRCUIT" ] || [ -z "$PARTICIPANT" ] || [ -z "$IN_ZKEY" ] || [ -z "$OUT_ZKEY" ]; then
  echo "Usage: bash scripts/ceremony/02_contribute.sh <circuit> <participant_name> <in.zkey> <out.zkey>" >&2
  exit 1
fi
if [ ! -f "$IN_ZKEY" ]; then
  echo "ERROR: input zkey not found: $IN_ZKEY" >&2
  exit 1
fi
if [ -f "$OUT_ZKEY" ]; then
  echo "ERROR: output path already exists, refusing to overwrite: $OUT_ZKEY" >&2
  exit 1
fi

TRANSCRIPT="$CIRCUITS_DIR/ceremony/$CIRCUIT/transcript.json"
if [ ! -f "$TRANSCRIPT" ]; then
  echo "ERROR: no transcript found at $TRANSCRIPT" >&2
  echo "Run 'bash scripts/ceremony/01_new_zkey.sh $CIRCUIT' first (coordinator step)." >&2
  exit 1
fi

IN_HASH="$(shasum -a 256 "$IN_ZKEY" | awk '{print $1}')"
echo "▶ Input zkey: $IN_ZKEY"
echo "  SHA-256: $IN_HASH"
echo ""
echo "IMPORTANT — before continuing:"
echo "  1. Verify this SHA-256 matches what the previous participant published"
echo "     (their entry in $TRANSCRIPT, or the value they announced publicly)."
echo "  2. Do not proceed if it doesn't match — that indicates tampering."
echo ""
read -r -p "Confirmed the hash matches? [y/N] " CONFIRMED
if [ "$CONFIRMED" != "y" ] && [ "$CONFIRMED" != "Y" ]; then
  echo "Aborted." >&2
  exit 1
fi

echo ""
echo "▶ Contributing entropy for $CIRCUIT as '$PARTICIPANT'..."
echo "  You will be prompted for random text — type something unpredictable"
echo "  (mash the keyboard). This is combined with OS randomness; snarkjs does"
echo "  not rely solely on what you type."
echo ""

# Deliberately no -e flag — snarkjs prompts interactively for entropy.
snarkjs zkey contribute "$IN_ZKEY" "$OUT_ZKEY" --name="$PARTICIPANT"

OUT_HASH="$(shasum -a 256 "$OUT_ZKEY" | awk '{print $1}')"

# Append this contribution to the transcript.
TMP="$(mktemp)"
python3 - "$TRANSCRIPT" "$TMP" "$PARTICIPANT" "$OUT_HASH" "$IN_HASH" <<'PYEOF'
import json, sys, datetime
transcript_path, tmp_path, participant, out_hash, in_hash = sys.argv[1:6]
with open(transcript_path) as f:
    transcript = json.load(f)
transcript.append({
    "contribution_index": len(transcript),
    "participant_name": participant,
    "timestamp_utc": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "entropy_source_description": "interactive keyboard entropy + OS randomness (snarkjs default)",
    "zkey_sha256": out_hash,
    "prev_zkey_sha256": in_hash,
    "asset_url": None,
})
with open(tmp_path, "w") as f:
    json.dump(transcript, f, indent=2)
PYEOF
mv "$TMP" "$TRANSCRIPT"

echo ""
echo "✅ Contribution recorded for $CIRCUIT by '$PARTICIPANT'"
echo "   Output: $OUT_ZKEY"
echo "   SHA-256: $OUT_HASH"
echo ""
echo "Publish this SHA-256 publicly (e.g. in the ceremony coordination channel)"
echo "before handing $OUT_ZKEY to the next participant, so they — and anyone"
echo "auditing later — can verify it wasn't tampered with in transit."
echo ""
echo "Next participant runs:"
echo "   bash scripts/ceremony/02_contribute.sh $CIRCUIT <next_name> $OUT_ZKEY <next_out.zkey>"
echo "Or, if this was the final contribution:"
echo "   bash scripts/ceremony/03_verify_transcript.sh $CIRCUIT"
