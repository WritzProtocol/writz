#!/usr/bin/env bash
# Development-only trusted setup (NOT for production).
# Uses a small Powers of Tau file (2^15) for fast local testing.
# Production requires the Hermez ceremony ptau (2^28).
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"
KEYS="$CIRCUITS_DIR/keys"
PTAU="$CIRCUITS_DIR/ptau"
PTAU_FILE="$PTAU/pot15_final.ptau"

mkdir -p "$KEYS" "$PTAU"

echo "── Powers of Tau (development) ─────────────────────────────────────────"
if [ ! -f "$PTAU_FILE" ]; then
    echo "▶ Generating dev Powers of Tau (pot15 — 32,768 constraints max)..."
    snarkjs powersoftau new bn128 15 "$PTAU/pot15_0000.ptau" -v 2>&1 | tail -3
    snarkjs powersoftau contribute "$PTAU/pot15_0000.ptau" "$PTAU/pot15_0001.ptau" \
        --name="Writz dev setup" -v -e="writz dev entropy $(date)" 2>&1 | tail -3
    snarkjs powersoftau prepare phase2 "$PTAU/pot15_0001.ptau" "$PTAU_FILE" -v 2>&1 | tail -3
    echo "  ✓ pot15_final.ptau ready"
else
    echo "  ✓ pot15_final.ptau already exists"
fi

setup_circuit() {
    local name="$1"
    local r1cs="$BUILD/${name}.r1cs"
    local zkey0="$KEYS/${name}_0000.zkey"
    local zkey_final="$KEYS/${name}_final.zkey"
    local vkey="$KEYS/${name}_vkey.json"

    if [ ! -f "$r1cs" ]; then
        echo "ERROR: $r1cs not found. Run 'bash scripts/compile_all.sh' first." >&2
        return 1
    fi

    echo ""
    echo "── Setup: $name ─────────────────────────────────────────────────────"

    echo "▶ Groth16 setup..."
    snarkjs groth16 setup "$r1cs" "$PTAU_FILE" "$zkey0" 2>&1 | tail -2

    echo "▶ Contributing to circuit-specific ceremony..."
    snarkjs zkey contribute "$zkey0" "$zkey_final" \
        --name="Writz dev $name" -e="writz dev $name entropy $(date)" -v 2>&1 | tail -2

    echo "▶ Exporting verification key..."
    snarkjs zkey export verificationkey "$zkey_final" "$vkey"

    echo "  ✓ $name: keys ready at keys/${name}_final.zkey and keys/${name}_vkey.json"
}

setup_circuit deposit
setup_circuit borrow_repay
setup_circuit liquidation
setup_circuit zero_debt

echo ""
echo "✅ Development setup complete."
echo "   Proving keys:       keys/*_final.zkey"
echo "   Verification keys:  keys/*_vkey.json"
echo ""
echo "WARNING: These keys are for development ONLY."
echo "         For mainnet, use a proper multi-party trusted setup ceremony."
echo "         See docs/scf/milestone-plan.md Phase 2.3 for the production ceremony plan."
