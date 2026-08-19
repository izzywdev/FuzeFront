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
  // Configure the identity dual-accept window (bare UUIDs for legacy types)
  // before any test module runs. See tests/jest.setup.ts.
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  testTimeout: 30000,
}
