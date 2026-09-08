/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // earn-cycle.e2e.test.ts runs under Bun, not jest: it imports
  // @stellar/stellar-sdk to sign and submit, and that package's CJS build
  // require()s an ESM-only @noble/hashes file which ts-jest's CommonJS loader
  // cannot parse (the same constraint repay-watcher.test.ts documents). Bun is
  // what the relayer actually ships on, so the submission path is exercised on
  // the runtime that serves it. Run it with `bun run test:e2e`.
  testPathIgnorePatterns: ['<rootDir>/test/earn-cycle.e2e.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  moduleNameMapper: {
    // bun:sqlite only exists under Bun's runtime; substitute a minimal
    // test-only mock under Jest/Node (see test/__mocks__/bun-sqlite.ts).
    // Production code is unaffected - it still resolves the real
    // `bun:sqlite` when run via `bun src/index.ts` / `bun test`.
    '^bun:sqlite$': '<rootDir>/test/__mocks__/bun-sqlite.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
