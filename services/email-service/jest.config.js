module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to its TypeScript source so ts-jest can compile it
  // (shared dist is ESM; email-service tests run in CommonJS via ts-jest)
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
  },
  testTimeout: 10000,
};
