"""
Render all Writz Protocol diagrams to docs/diagrams/output/ (SVG + PNG).
Usage: python scripts/diagrams/render-all.py   (from repo root)
Requires: pip install graphviz
"""
import subprocess
import sys
from pathlib import Path

ROOT   = Path(__file__).parent.parent.parent
OUTPUT = ROOT / "docs" / "diagrams" / "output"
OUTPUT.mkdir(parents=True, exist_ok=True)

scripts = [
    "01-system-architecture.py",
    "02-deposit-flow.py",
    "03-borrow-repay-flow.py",
    "04-btc-release-flow.py",
    "05-zk-circuits.py",
    "06-commitment-state-machine.py",
    "07-contract-interactions.py",
]

base   = Path(__file__).parent
errors = []

print(f"Rendering {len(scripts)} diagrams → {OUTPUT}\n")
for script in scripts:
    path   = base / script
    result = subprocess.run(
        [sys.executable, str(path)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"✗ {script}\n{result.stderr}")
        errors.append(script)
    elif result.stdout:
        print(result.stdout.strip())

if errors:
    print(f"\n{len(errors)} script(s) failed: {errors}")
    sys.exit(1)
else:
    print(f"\nAll {len(scripts)} diagrams rendered successfully.")
