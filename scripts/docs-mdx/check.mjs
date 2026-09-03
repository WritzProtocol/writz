#!/usr/bin/env node
// Parses every docs page with the same MDX parser Mintlify uses, so a syntax
// error is caught in CI instead of on deploy.
//
// Why this exists: Mintlify renders pages as MDX, not plain Markdown, and it
// only parses files that changed in a push. A page can therefore carry a
// syntax error for months without anyone noticing, and then break the deploy
// on an unrelated PR that merely touches it - which is exactly what happened
// when a test-count bump pulled docs/roadmap/phases.md and
// docs/scf/milestone-plan.md into a deploy's targeted paths (#137). The
// errors below are reported verbatim from `@mdx-js/mdx`, the same parser and
// the same messages Mintlify's build prints.
//
// Scope is every .md/.mdx under docs/, not just pages reachable from
// docs.json. A page outside the navigation is still a page we intend to be
// valid, and keeping the scope simple avoids an exclusion list that would
// quietly rot.
//
// Usage: bun run check   (from scripts/docs-mdx/)
// Exit 0 = every page parses. Exit 1 = at least one does not.

import { compile } from "@mdx-js/mdx";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = path.join(repoRoot, "docs");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".md") || entry.endsWith(".mdx")) out.push(full);
  }
  return out;
}

/**
 * Translate MDX's parser-level wording into the edit that actually fixes it.
 * The raw messages describe the tokenizer's state ("before name"), not the
 * mistake, so without this a failing build tells you where but not what.
 */
function hint(message) {
  if (/to create a comment in MDX/.test(message)) {
    return "HTML comments are not valid MDX. Use {/* ... */} instead of <!-- ... -->.";
  }
  if (/before name, expected a character that can start a name/.test(message)) {
    return "A bare `<` reads as the start of a JSX tag. Write it as `&lt;`, or wrap the text in backticks.";
  }
  if (/Unexpected end of file|before local name|in name/.test(message)) {
    return "Looks like an unclosed or malformed JSX tag. Escape a literal `<` as `&lt;`.";
  }
  return null;
}

const files = walk(docsRoot).sort();
const failures = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  try {
    await compile(source);
  } catch (error) {
    failures.push({ file, error, source });
  }
}

for (const { file, error, source } of failures) {
  const rel = path.relative(repoRoot, file);
  console.error(`${rel}:${error.line}:${error.column}`);
  console.error(`  ${error.message}`);

  const line = source.split("\n")[error.line - 1];
  if (line !== undefined) {
    console.error(`  | ${line.trimEnd()}`);
    // trimStart shifts the caret, so measure the shift and subtract it.
    const shift = line.length - line.trimStart().length;
    console.error(`  | ${" ".repeat(Math.max(0, error.column - 1 - shift))}^`);
  }

  const suggestion = hint(error.message);
  if (suggestion) console.error(`  fix: ${suggestion}`);
  console.error("");
}

console.log(
  failures.length === 0
    ? `${files.length} docs pages parse as MDX.`
    : `${failures.length} of ${files.length} docs pages fail to parse as MDX. Mintlify will refuse this deploy.`,
);

process.exit(failures.length === 0 ? 0 : 1);
