/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // earn-cycle.e2e.test.ts and any *.bun.test.ts file run under Bun, not
  // jest: they import @stellar/stellar-sdk statically, and that package's
  // CJS build require()s an ESM-only @noble/hashes file which ts-jest's
  // CommonJS loader cannot parse (the same constraint repay-watcher.test.ts
  // documents). Bun is what the relayer actually ships on. Run these with
  // `bun run test:e2e` / `bun test test/<name>.bun.test.ts`.
  testPathIgnorePatterns: ['<rootDir>/test/earn-cycle.e2e.test.ts', '\\.bun\\.test\\.ts$'],
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
