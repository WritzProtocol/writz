#!/usr/bin/env node
// Both frontends are styled with Tailwind utilities, so the only stylesheet in each
// is its globals.css (imports, the base reset, keyframes and the few rules that
// cannot be a utility). A new .css file under frontend/ means a page went back to
// its own stylesheet; put its styles in a styles.ts next to it instead.
//
// Usage: node scripts/check-frontend-styles.mjs
// Exit 0 = clean. Exit 1 = a stray stylesheet (also lists it).

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(repoRoot, "frontend");

const ALLOWED = new Set(["frontend/app/src/app/globals.css", "frontend/landing/src/app/globals.css"]);
const SKIPPED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".git"]);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else {
      yield path.join(dir, entry.name);
    }
  }
}

const stray = [];
for (const file of walk(frontend)) {
  if (!file.endsWith(".css")) continue;
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  if (!ALLOWED.has(rel)) stray.push(rel);
}

if (stray.length > 0) {
  console.error("Stylesheets outside the two globals.css files:");
  for (const rel of stray) console.error(`  ${rel}`);
  console.error("Style the page with utilities in a styles.ts next to it (see frontend/DESIGN_SYSTEM.md).");
  process.exit(1);
}
console.log("frontend styles: only the two globals.css files.");
