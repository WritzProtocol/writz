#!/usr/bin/env bash
# Downloads the Hermez Phase-1 Powers of Tau file used as the SRS input for
# the production trusted-setup ceremony.
#
# Replaces `scripts/setup_dev.sh`'s locally-generated `pot15` ptau - that
# file uses scripted, non-random entropy (`-e="writz dev entropy $(date)"`)
# and is capped at 2^15 = 32,768 constraints, too small for `borrow_repay`
# (~10,500 constraints) once real ceremony overhead is included. Hermez's
# publicly verifiable, already-phase-1-prepared ceremony transcript is the
# standard SRS reused across the Groth16/BN254 ecosystem - no need to
# re-run Powers of Tau Phase 1 from scratch.
#
# ── Checksum pinning (read before running for a real ceremony) ─────────────
# This script deliberately does NOT ship a hardcoded checksum for the ptau
# file - a security script must never present a fabricated-looking checksum
# as authoritative. Instead, the ceremony coordinator must pin the real,
# independently-verified checksum in `ceremony/PTAU_CHECKSUM.txt` (one line:
# `<power> <sha256>`) *before* running this script for a production
# ceremony, sourcing it from Hermez/Polygon zkEVM's official ceremony page
# (https://github.com/iden3/snarkjs#7-prepare-phase-2 links the canonical
# ptau files) or by cross-checking against multiple independent mirrors -
# never trust a single download unverified. This file should be reviewed
# and committed via PR, so the checksum itself goes through code review
# before any real ceremony run trusts it.
#
# Usage: bash scripts/ceremony/00_fetch_ptau.sh [power]
#   power: log2(max constraints). Default 15 (32,768) - sufficient for all
#          four Writz circuits (largest is borrow_repay at ~10,500
#          constraints). Only increase if a circuit grows past this.
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PTAU_DIR="$CIRCUITS_DIR/ceremony/ptau"
CHECKSUM_FILE="$CIRCUITS_DIR/ceremony/PTAU_CHECKSUM.txt"
POWER="${1:-15}"

mkdir -p "$PTAU_DIR"

FILE="powersOfTau28_hez_final_${POWER}.ptau"
URL="https://storage.googleapis.com/zkevm/ptau/${FILE}"
DEST="$PTAU_DIR/$FILE"

if [ -f "$DEST" ]; then
  echo "  ✓ $FILE already downloaded at $DEST"
else
  echo "▶ Downloading $FILE from Hermez..."
  curl -fL --progress-bar -o "$DEST" "$URL"
fi

echo "▶ Verifying checksum..."
ACTUAL_SHA256="$(shasum -a 256 "$DEST" | awk '{print $1}')"

EXPECTED_SHA256=""
if [ -f "$CHECKSUM_FILE" ]; then
  EXPECTED_SHA256="$(awk -v p="$POWER" '$1 == p {print $2}' "$CHECKSUM_FILE")"
fi

if [ -z "$EXPECTED_SHA256" ]; then
  echo "" >&2
  echo "ERROR: no pinned checksum for power $POWER in $CHECKSUM_FILE" >&2
  echo "" >&2
  echo "This script refuses to proceed without an independently-verified" >&2
  echo "checksum - do not add one without actually cross-checking it against" >&2
  echo "Hermez/Polygon zkEVM's official published value from multiple sources." >&2
  echo "" >&2
  echo "The downloaded file's SHA-256 is:" >&2
  echo "  $ACTUAL_SHA256" >&2
  echo "" >&2
  echo "After verifying this independently, add a line to $CHECKSUM_FILE:" >&2
  echo "  $POWER $ACTUAL_SHA256" >&2
  echo "and commit it via PR for review before using this ptau in a real ceremony." >&2
  exit 1
fi

if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "ERROR: checksum mismatch for $FILE" >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  echo "Refusing to use an unverified ptau file. Delete $DEST and retry, or" >&2
  echo "investigate - this may indicate a corrupted download or a tampered file." >&2
  exit 1
fi

echo "  ✓ checksum verified: $ACTUAL_SHA256"
echo ""
echo "✅ Powers of Tau ready: $DEST"
echo "   Next: bash scripts/ceremony/01_new_zkey.sh <circuit>"
