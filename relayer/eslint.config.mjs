import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "dist/**",
      "node_modules/**",
    ],
  },
  {
    rules: {
      // Test mocks and generic helpers in this repo use a leading
      // underscore to mark intentionally-unused params/vars/type params
      // (see e.g. test/__mocks__/bun-sqlite.ts) - recognize that
      // convention instead of flagging it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Jest config files are plain CommonJS, loaded directly by Node/Jest
    // (not compiled), so they use CJS globals rather than ES module syntax.
    files: ["jest.config.js"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
      },
    },
  },
  {
    // This suite deliberately `require()`s modules inside each test body
    // (rather than static `import`s) so `jest.resetModules()` genuinely
    // reloads them, simulating a process restart re-opening the cursor
    // sqlite file - see the file's own top-of-file comment. A static
    // `import` is hoisted and evaluated once, which would defeat the
    // point of the test.
    files: ["test/repay-watcher.test.ts", "test/vault-watcher.test.ts", "test/metrics.test.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
