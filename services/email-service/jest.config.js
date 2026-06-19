module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // shared dist is ESM (module: esnext); email-service tests run in CommonJS via ts-jest.
  // Pointing to shared/src/index.ts would pull in AppContext.tsx (JSX), which ts-jest
  // cannot compile without --jsx. Since email-service only ever imports from the kafka
  // sub-tree of shared, the narrower mapping is intentional — not a partial-import trap.
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
  },
  testTimeout: 10000,
};
