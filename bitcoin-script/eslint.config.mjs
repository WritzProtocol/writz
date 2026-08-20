import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // scripts/e2e_testnet.mjs is a standalone Node CLI script (run via `bun
    // run scripts/e2e_testnet.mjs`, see its own shebang/usage comment), not
    // part of the library's bundled TS sources - it genuinely runs under
    // Node's global scope (process, fetch, console, ...).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
