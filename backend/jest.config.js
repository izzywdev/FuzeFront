module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.spec.ts',
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest
  // compiles it under CommonJS. shared/dist is ESM and would pull in JSX from the
  // React barrel; the backend only ever uses the kafka sub-tree of shared.
  moduleNameMapper: {
    '^@fuzefront/shared/kafka$': '<rootDir>/../shared/src/kafka/index.ts',
    '^@fuzefront/shared$': '<rootDir>/../shared/src/kafka/index.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/config/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
}
