// shared/jest.config.js
// Minimal Jest setup for shared package schema tests.
// Mirrors services/email-service/jest.config.js conventions.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  testTimeout: 30000,
};
