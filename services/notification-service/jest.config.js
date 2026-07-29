// services/notification-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // isolatedModules: transpile-only. Full type-checking is `tsc --noEmit`.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json', isolatedModules: true }],
  },
  testTimeout: 30000,
};
