#!/usr/bin/env node
// Scans every markdown file in the repo for two things that tend to drift
// after a redeploy or a test-suite change:
//
//   1. Soroban contract addresses (`C...` StrKeys) that don't match the
//      canonical addresses recorded in contracts/deployments/testnet.md.
//   2. "N tests" / "N/N tests" mentions whose number isn't any of the real,
//      just-measured counts in docs/_data/facts.json.
//
// It does NOT try to figure out which contract or module a stray number
// "should" belong to - that's a human judgment call. It only tells you
// the number doesn't match anything true right now, with the file/line so
// you can go look. Regenerate facts.json first with
// `node scripts/update-test-counts.mjs` if you've changed any tests.
//
// Usage: node scripts/check-docs-sync.mjs
// Exit 0 = clean. Exit 1 = drift found (also lists it).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "test_snapshots", "target", "build", "dist",
  ".next", "coverage", ".claude", ".codex", ".agents", "ptau",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// --- 1. Canonical contract addresses, parsed from the deployment log ---
//
// testnet.md is the ledger of every address we've ever legitimately used on
// testnet - the 4 primary deployed contracts, plus one-off ephemeral
// instances from e2e test runs (each explicitly labeled "Test instance" /
// "instance `C...`" there). Both kinds are real and shouldn't be flagged.
// The check below is therefore "does this address appear anywhere in
// testnet.md", not "is this one of the 4 primary contracts" - an address
// that's never been recorded there at all is the actual red flag.

const testnetMdPath = path.join(repoRoot, "contracts/deployments/testnet.md");
const testnetMd = readFileSync(testnetMdPath, "utf8");

const primaryContracts = new Map(); // address -> contract name, for the summary printout
{
  let currentSection = null;
  for (const line of testnetMd.split("\n")) {
    const heading = line.match(/^##\s+(\S.*\S)\s*$/);
    if (heading) {
      currentSection = heading[1];
      continue;
    }
    const idRow = line.match(/\*\*Contract ID\*\*\s*\|\s*`(C[A-Z2-7]{55})`/);
    if (idRow && currentSection) {
      primaryContracts.set(idRow[1], currentSection);
    }
  }
}

if (primaryContracts.size === 0) {
  console.error(`No contract IDs found in ${path.relative(repoRoot, testnetMdPath)} - is its table format still "**Contract ID** | \`C...\`"?`);
  process.exit(1);
}

const knownAddresses = new Set(testnetMd.match(/\bC[A-Z2-7]{55}\b/g) ?? []);

// --- 2. Canonical test counts, from the last update-test-counts.mjs run ---

const factsPath = path.join(repoRoot, "docs/_data/facts.json");
const facts = JSON.parse(readFileSync(factsPath, "utf8"));

const canonicalCounts = new Set([
  facts.totalTests,
  facts.contractsTotal,
  ...Object.values(facts.modules),
]);

// --- Scan every doc ---

const ADDRESS_RE = /\bC[A-Z2-7]{55}\b/g;
const COUNT_RE = /\b(\d+)(?:\s*\/\s*\d+)?\s+(?:unit\s+|integration\s+)?tests?\b/gi;

const skipForCounts = new Set([testnetMdPath]); // deployment log has no test-count claims to check
const skipForAddresses = new Set([testnetMdPath]); // this file IS the source of truth

let errors = 0;

for (const file of walk(repoRoot)) {
  const rel = path.relative(repoRoot, file);
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    if (!skipForAddresses.has(file)) {
      for (const match of line.matchAll(ADDRESS_RE)) {
        const addr = match[0];
        if (!knownAddresses.has(addr)) {
          console.error(`${rel}:${i + 1}: unknown/stale contract address ${addr}`);
          console.error(`    ${line.trim()}`);
          errors++;
        }
      }
    }

    if (!skipForCounts.has(file)) {
      for (const match of line.matchAll(COUNT_RE)) {
        const n = Number(match[1]);
        if (!canonicalCounts.has(n)) {
          console.error(`${rel}:${i + 1}: "${n} tests" doesn't match any current count`);
          console.error(`    ${line.trim()}`);
          errors++;
        }
      }
    }
  });
}

console.log("\nCanonical contract addresses (from contracts/deployments/testnet.md):");
for (const [addr, name] of primaryContracts) {
  console.log(`  ${name}: ${addr}`);
}
console.log(`\nCanonical test counts (from docs/_data/facts.json, generated ${facts.generatedAt}):`);
for (const [mod, n] of Object.entries(facts.modules)) {
  console.log(`  ${mod}: ${n}`);
}
console.log(`  contracts total: ${facts.contractsTotal}`);
console.log(`  grand total: ${facts.totalTests}`);

if (errors > 0) {
  console.error(`\n${errors} doc-sync issue(s) found.`);
  process.exit(1);
}
console.log("\nNo doc-sync issues found.");
