// services/config-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map the identity package to its TypeScript source so ts-jest can compile it
  // without requiring a prior `npm run build` in packages/identity.
  moduleNameMapper: {
    '^@izzywdev/fuzefront-identity$': '<rootDir>/../../packages/identity/src/index.ts',
  },
  testTimeout: 30000,
};
