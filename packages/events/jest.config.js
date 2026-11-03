// Unit tests run with no services. The Postgres-backed suites self-skip unless
// EVENTS_TEST_PG_URL (or DATABASE_URL) is set.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Resolve the contract + identity packages from source so the suite does not depend on a
  // prior build of their (tracked, possibly stale) dist/.
  moduleNameMapper: {
    '^@fuzefront/shared/kafka$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^@izzywdev/fuzefront-identity$': '<rootDir>/../identity/src/index.ts',
  },
  testTimeout: 30000,
}
