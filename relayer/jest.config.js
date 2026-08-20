/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
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
