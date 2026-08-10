// Mirrors shared/jest.config.js. The package is dependency-free, so the suite
// needs no services and no fixtures — it runs anywhere Node runs.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  testTimeout: 30000,
}
