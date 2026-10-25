#!/usr/bin/env node
// Fills the placeholder tokens of the 2026-10-25 testnet redeploy (NEWSPVID,
// NEWLENDID, NEWCHECKPOINT, NEWEXAMPLETXID, ...) in the files that carry them,
// from the values the redeploy produced, and prints which files changed.
//
// Every value is required and validated before any file is written: a missing
// or malformed value stops the run with nothing changed. Derived forms (short
// IDs, thousands separators, internal byte order, confirmations) are computed
// here, never typed by hand.
//
// Usage (from the repo root):
//   node scripts/fill-redeploy-placeholders.mjs \
//     --date 2026-10-25 --build-commit <git sha> \
//     --spv C... --lend C... \
//     --spv-wasm contracts/target/wasm32v1-none/release/bitcoin_spv.wasm \
//     --lend-wasm contracts/target/wasm32v1-none/release/writz_lend.wasm \
//     --spv-deploy-tx <64 hex> --lend-deploy-tx <64 hex> \
//     --checkpoint-tx <64 hex> --submitter-tx <64 hex> --consumer-tx <64 hex> \
//     --checkpoint <height> --checkpoint-hash <64 hex, display order> \
//     --example-txid <64 hex, display order> --example-block <height> \
//     --example-block-hash <64 hex, internal order: sorobanArgs.block_hash> \
//     --example-index <sorobanArgs.tx_index> --example-siblings <merkle_proof length> \
//     --example-spk <scriptPubKey hex of the paid output> --example-sats <its value> \
//     --tip-height <n> --tip-hash <64 hex, internal order> --tip-chainwork <decimal>
//
//   --dry-run   validate and list the files that would change, write nothing
//
// Then: node scripts/sync-deployments.mjs && node scripts/check-docs-sync.mjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  "AGENTS.md",
  "README.md",
  "contracts/deployments/testnet.md",
  "docs/README.md",
  "docs/developers/contract-reference.md",
  "docs/developers/for-ai-agents.md",
  "docs/developers/integrate.md",
  "docs/developers/quick-start.md",
  "docs/developers/request-for-startups.md",
  "docs/developers/spv-sdk.md",
  "docs/how-it-works/spv-verification.md",
  "docs/how-it-works/stellar-side.md",
  "examples/spv-payment-check/README.md",
  "examples/verify-bitcoin-tx/README.md",
  "examples/verify-bitcoin-tx/index.ts",
  "frontend/app/.env.example",
  "frontend/landing/src/features/landing/data/contracts.data.ts",
  "packages/sdk/README.md",
  "packages/sdk/test/live.test.ts",
  "scripts/diagrams/07-contract-interactions.py",
];

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UINT = /^[0-9]+$/;

const OPTIONS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  "build-commit": /^[0-9a-f]{7,40}$/,
  spv: CONTRACT_ID,
  lend: CONTRACT_ID,
  "spv-wasm": null,
  "lend-wasm": null,
  "spv-deploy-tx": HEX64,
  "lend-deploy-tx": HEX64,
  "checkpoint-tx": HEX64,
  "submitter-tx": HEX64,
  "consumer-tx": HEX64,
  checkpoint: UINT,
  "checkpoint-hash": HEX64,
  "example-txid": HEX64,
  "example-block": UINT,
  "example-block-hash": HEX64,
  "example-index": UINT,
  "example-siblings": UINT,
  "example-spk": /^(?:[0-9a-f]{2}){2,40}$/,
  "example-sats": UINT,
  "tip-height": UINT,
  "tip-hash": HEX64,
  "tip-chainwork": UINT,
};

function fail(msg) {
  console.error(`fill-redeploy-placeholders: ${msg}`);
  console.error("Nothing was written.");
  process.exit(1);
}

// --- Parse and validate ---

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const v = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dry-run") continue;
  const name = a.startsWith("--") ? a.slice(2) : null;
  if (!name || !(name in OPTIONS)) fail(`unknown argument ${a}`);
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} has no value`);
  if (name in v) fail(`--${name} given twice`);
  // Hex values are compared and printed lowercase; contract IDs and paths as given.
  v[name] = OPTIONS[name] === HEX64 || name === "example-spk" || name === "build-commit" ? value.toLowerCase() : value;
  i++;
}

const missing = Object.keys(OPTIONS).filter((k) => !(k in v));
if (missing.length) fail(`missing ${missing.map((k) => `--${k}`).join(", ")}`);
for (const [k, re] of Object.entries(OPTIONS)) {
  if (re && !re.test(v[k])) fail(`--${k} is malformed: ${v[k]}`);
}

if (v.spv === v.lend) fail("--spv and --lend are the same ID");
if (Number.isNaN(Date.parse(`${v.date}T00:00:00Z`))) fail(`--date is not a date: ${v.date}`);

const checkpoint = Number(v.checkpoint);
const exampleBlock = Number(v["example-block"]);
const tipHeight = Number(v["tip-height"]);
if (checkpoint <= 325554) fail(`--checkpoint ${checkpoint} is not above the previous checkpoint 325554`);
if (exampleBlock <= checkpoint) fail(`--example-block ${exampleBlock} is not above --checkpoint ${checkpoint}; it could not be proven`);
const confirmations = tipHeight - exampleBlock + 1;
if (confirmations < 6) fail(`--tip-height gives the example ${confirmations} confirmations; the examples ask for 6`);
if (Number(v["example-siblings"]) < 1) fail("--example-siblings must be at least 1");

// Signet hashes have leading zeros in display order, so trailing zeros in
// internal order. This catches a hash passed in the wrong byte order.
if (!v["checkpoint-hash"].startsWith("00")) fail("--checkpoint-hash must be in display order (as mempool.space shows it)");
for (const k of ["example-block-hash", "tip-hash"]) {
  if (!v[k].endsWith("00")) fail(`--${k} must be in internal order (as the relayer's sorobanArgs and get_best_tip return it)`);
}

function wasm(name) {
  const file = path.resolve(repoRoot, v[name]);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`--${name} ${v[name]} does not exist`);
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 4).toString("hex") !== "0061736d") fail(`--${name} ${v[name]} is not a wasm file`);
  return {
    sha: createHash("sha256").update(bytes).digest("hex"),
    // Decimal kilobytes, one decimal, as the README table has always used.
    kb: (bytes.length / 1000).toFixed(1),
  };
}
const spvWasm = wasm("spv-wasm");
const lendWasm = wasm("lend-wasm");

// --- Derived forms ---

const reverseHex = (h) => h.match(/../g).reverse().join("");
const short = (h) => `${h.slice(0, 8)}...${h.slice(-8)}`;
const fmt = (n) => Number(n).toLocaleString("en-US");
const txInternal = reverseHex(v["example-txid"]);

const tokens = {
  NEWDEPLOYDATE: v.date,
  NEWBUILDCOMMIT: v["build-commit"],
  NEWSPVID: v.spv,
  NEWSPVIDSHORT: v.spv.slice(0, 16),
  NEWLENDID: v.lend,
  NEWLENDIDSHORT: v.lend.slice(0, 16),
  NEWSPVWASMSHA: spvWasm.sha,
  NEWSPVWASMKB: spvWasm.kb,
  NEWLENDWASMSHA: lendWasm.sha,
  NEWLENDWASMKB: lendWasm.kb,
  NEWSPVDEPLOYTX: v["spv-deploy-tx"],
  NEWSPVDEPLOYTXSHORT: v["spv-deploy-tx"].slice(0, 10),
  NEWLENDDEPLOYTX: v["lend-deploy-tx"],
  NEWLENDDEPLOYTXSHORT: v["lend-deploy-tx"].slice(0, 10),
  NEWCHECKPOINTTX: v["checkpoint-tx"],
  NEWCHECKPOINTTXSHORT: v["checkpoint-tx"].slice(0, 10),
  NEWSUBMITTERTX: v["submitter-tx"],
  NEWSUBMITTERTXSHORT: v["submitter-tx"].slice(0, 10),
  NEWCONSUMERTX: v["consumer-tx"],
  NEWCONSUMERTXSHORT: v["consumer-tx"].slice(0, 10),
  NEWCHECKPOINT: String(checkpoint),
  NEWCHECKPOINTFMT: fmt(checkpoint),
  NEWCHECKPOINTHASH: v["checkpoint-hash"],
  NEWEXAMPLETXID: v["example-txid"],
  NEWEXAMPLETXSHORT: short(v["example-txid"]),
  NEWEXAMPLETXINTERNAL: txInternal,
  NEWEXAMPLETXINTERNALSHORT: short(txInternal),
  NEWEXAMPLETXBUF: `${txInternal.slice(0, 2)} ${txInternal.slice(2, 4)}`,
  NEWEXAMPLEBLOCK: String(exampleBlock),
  NEWEXAMPLEBLOCKFMT: fmt(exampleBlock),
  NEWEXAMPLEHASHINTERNAL: v["example-block-hash"],
  NEWEXAMPLEHASHINTERNALSHORT: short(v["example-block-hash"]),
  NEWEXAMPLEHASHBUF: `${v["example-block-hash"].slice(0, 2)} ${v["example-block-hash"].slice(2, 4)}`,
  NEWEXAMPLEINDEX: String(Number(v["example-index"])),
  NEWEXAMPLESIBLINGS: String(Number(v["example-siblings"])),
  NEWEXAMPLESPK: v["example-spk"],
  NEWEXAMPLESATS: String(Number(v["example-sats"])),
  NEWEXAMPLECONF: String(confirmations),
  NEWTIPHEIGHT: String(tipHeight),
  NEWTIPHASHINTERNAL: v["tip-hash"],
  NEWTIPHASHINTERNALSHORT: short(v["tip-hash"]),
  NEWTIPCHAINWORK: String(BigInt(v["tip-chainwork"])),
};

// Longest first, so NEWSPVIDSHORT is never read as NEWSPVID + "SHORT".
const order = Object.keys(tokens).sort((a, b) => b.length - a.length);
const TOKEN_RE = /\bNEW(?:SPV|LEND|CHECKPOINT|DEPLOY|BUILD|EXAMPLE|TIP)[A-Z]*\b/g;

// --- Replace ---

const changed = [];
for (const rel of FILES) {
  const file = path.join(repoRoot, rel);
  if (!existsSync(file)) fail(`${rel} is missing`);
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const t of order) after = after.split(t).join(tokens[t]);
  const left = after.match(TOKEN_RE);
  if (left) fail(`${rel} still has unknown placeholder(s) after the replace: ${[...new Set(left)].join(", ")}`);
  if (after !== before) changed.push([rel, file, after]);
}

if (changed.length === 0) {
  console.log("No placeholders found; nothing to do.");
  process.exit(0);
}
for (const [rel, file, after] of changed) {
  if (!dryRun) writeFileSync(file, after);
  console.log(`${dryRun ? "would change" : "changed"} ${rel}`);
}
console.log(`\n${changed.length} file(s) ${dryRun ? "would change" : "changed"}.`);
if (!dryRun) {
  console.log("Next: node scripts/sync-deployments.mjs && node scripts/check-docs-sync.mjs");
  console.log("Then re-render docs/diagrams/output/07-contract-interactions.svg (python3 scripts/diagrams/07-contract-interactions.py).");
}
