import { describe, expect, it } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createRequire } from "module";

// The circuit the browser proves with and the verification key the contracts
// (and /api/cosign) check against must come from the same trusted setup. A
// served .zkey that drifts from the committed vkey makes every proof fail on
// chain with no hint why. This exports each served zkey's vkey and compares.
//
// snarkjs hangs when run under bun's runtime, so the export runs in a Node
// subprocess through the frontend's own snarkjs CLI (resolved from its package,
// so it works wherever node_modules is installed, including CI).
const ROOT = path.resolve(__dirname, "../../../../..");
const SERVED = path.join(ROOT, "frontend/app/public/circuits");
const COMMITTED = path.join(ROOT, "circuits/keys");
const SNARKJS = path.join(
  path.dirname(createRequire(import.meta.url).resolve("snarkjs/package.json")),
  "build/cli.cjs",
);

const circuits = ["deposit", "borrow_repay", "liquidation", "zero_debt"] as const;

function exportVkey(zkey: string): unknown {
  const dir = mkdtempSync(path.join(tmpdir(), "writz-vkey-"));
  const out = path.join(dir, "vkey.json");
  try {
    execFileSync("node", [SNARKJS, "zkey", "export", "verificationkey", zkey, out], {
      stdio: "ignore",
      timeout: 60_000,
    });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("served circuit artifacts match the committed verification keys", () => {
  for (const name of circuits) {
    it(`${name}: the served zkey exports the committed vkey`, () => {
      const exported = exportVkey(path.join(SERVED, `${name}_final.zkey`));
      const committed = JSON.parse(readFileSync(path.join(COMMITTED, `${name}_vkey.json`), "utf8"));
      expect(exported).toEqual(committed);
    }, 90_000);
  }

  it("the frontend's own zero_debt vkey (used by /api/cosign) matches the committed one", () => {
    const frontend = JSON.parse(
      readFileSync(path.join(ROOT, "frontend/app/src/circuits/zero_debt_vkey.json"), "utf8"),
    );
    const committed = JSON.parse(readFileSync(path.join(COMMITTED, "zero_debt_vkey.json"), "utf8"));
    expect(frontend).toEqual(committed);
  });
});
