#!/usr/bin/env bash
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$CIRCUITS_DIR/src"
BUILD="$CIRCUITS_DIR/build"
NODE_MODULES="$CIRCUITS_DIR/node_modules"

# Resolve circomlib include path
CIRCOMLIB="$NODE_MODULES/circomlib"
if [ ! -d "$CIRCOMLIB" ]; then
    echo "ERROR: circomlib not found. Run: npm install" >&2
    exit 1
fi

mkdir -p "$BUILD"

compile_circuit() {
    local name="$1"
    echo "▶ Compiling $name.circom..."
    PATH="$HOME/bin:$PATH" circom \
        "$SRC/$name.circom" \
        --r1cs \
        --wasm \
        --sym \
        --output "$BUILD" \
        -l "$NODE_MODULES"
    echo "  ✓ $name: R1CS + WASM generated"
}

compile_circuit deposit
compile_circuit borrow_repay
compile_circuit liquidation

echo ""
echo "✅ All circuits compiled."
echo "   R1CS files:  build/*.r1cs"
echo "   WASM provers: build/*_js/*.wasm"
echo ""
echo "Next: run 'bash scripts/setup_dev.sh' for a development trusted setup."
