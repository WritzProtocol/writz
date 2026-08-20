#!/usr/bin/env node
// Runs every module's real test suite and writes the counts to
// docs/_data/facts.json - the canonical source check-docs-sync.mjs
// checks all docs against. Run this after adding/removing tests,
// before updating any "N tests" mention in the docs.
//
// Usage: node scripts/update-test-counts.mjs

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, cwd) {
  // bun test writes its pass/fail summary to stderr, jest and cargo mix
  // both streams depending on version - merge both so the parsers below
  // don't need to care which stream a given tool chose.
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  const output = (result.stdout || "") + (result.stderr || "");
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}:\n${output}`);
  }
  return output;
}

function parseCargoResult(output) {
  const matches = [...output.matchAll(/test result: ok\. (\d+) passed/g)];
  if (matches.length === 0) {
    throw new Error(`no "test result: ok" line found in cargo output:\n${output}`);
  }
  // Sum across all `test result:` blocks (lib tests + any integration
  // test binaries) rather than assuming there's exactly one.
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

function parseBunTestResult(output) {
  const match = output.match(/^\s*(\d+)\s+pass\s*$/m);
  if (!match) throw new Error(`no "N pass" line found in bun test output:\n${output}`);
  return Number(match[1]);
}

function parseJestResult(output) {
  const match = output.match(/^Tests:\s+(\d+) passed, (\d+) total$/m);
  if (!match) throw new Error(`no "Tests: N passed, N total" line found in jest output:\n${output}`);
  if (match[1] !== match[2]) {
    throw new Error(`jest run has failures: ${match[1]} passed of ${match[2]} total`);
  }
  return Number(match[1]);
}

console.log("Running contracts (cargo test, per package)...");
const contractPackages = ["bitcoin-spv", "zk-verifier", "commitment-tree", "private-lend"];
const modules = {};
for (const pkg of contractPackages) {
  const out = run("cargo", ["test", "-p", pkg, "--lib"], path.join(repoRoot, "contracts"));
  modules[`contracts/${pkg}`] = parseCargoResult(out);
  console.log(`  ${pkg}: ${modules[`contracts/${pkg}`]}`);
}

console.log("Running bitcoin-script (bun test)...");
modules["bitcoin-script"] = parseBunTestResult(
  run("bun", ["test"], path.join(repoRoot, "bitcoin-script")),
);
console.log(`  bitcoin-script: ${modules["bitcoin-script"]}`);

console.log("Running relayer (bun run test)...");
modules["relayer"] = parseJestResult(
  run("bun", ["run", "test"], path.join(repoRoot, "relayer")),
);
console.log(`  relayer: ${modules["relayer"]}`);

console.log("Running circuits (npm test)...");
modules["circuits"] = parseJestResult(
  run("npm", ["test"], path.join(repoRoot, "circuits")),
);
console.log(`  circuits: ${modules["circuits"]}`);

const contractsTotal = contractPackages.reduce((sum, pkg) => sum + modules[`contracts/${pkg}`], 0);
const totalTests = Object.values(modules).reduce((sum, n) => sum + n, 0);

const facts = {
  generatedBy: "scripts/update-test-counts.mjs",
  generatedAt: new Date().toISOString(),
  contractsTotal,
  totalTests,
  modules,
};

const outPath = path.join(repoRoot, "docs/_data/facts.json");
writeFileSync(outPath, JSON.stringify(facts, null, 2) + "\n");
console.log(`\nWrote ${path.relative(repoRoot, outPath)}`);
console.log(`  contracts total: ${contractsTotal}`);
console.log(`  grand total:     ${totalTests}`);
