#!/usr/bin/env node
// Regenerates the machine-readable copies of contracts/deployments/testnet.md:
// contracts/deployments/testnet.json and the @writz/sdk network preset.
//
// Usage:
//   node scripts/sync-deployments.mjs           write the files
//   node scripts/sync-deployments.mjs --check   exit 1 if any is stale (CI)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generatedFiles, repoRoot } from "./lib/deployments.mjs";

const check = process.argv.includes("--check");
let stale = 0;

for (const [rel, content] of Object.entries(generatedFiles())) {
  const file = path.join(repoRoot, rel);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (current === content) continue;
  if (check) {
    console.error(`${rel} is out of date with contracts/deployments/testnet.md`);
    stale++;
  } else {
    writeFileSync(file, content);
    console.log(`wrote ${rel}`);
  }
}

if (stale > 0) {
  console.error("Run `node scripts/sync-deployments.mjs` and commit the result.");
  process.exit(1);
}
if (check) console.log("Generated deployment files are up to date.");
