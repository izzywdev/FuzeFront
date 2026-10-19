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
  // without requiring a prior `npm run build` in packages/identity. Same
  // treatment for telemetry (app.ts's tracingMiddleware()) — its type-check
  // still resolves the package's declared `types` (dist/index.d.ts), so CI
  // additionally builds it first (see .github/workflows/ci.yml's
  // config-service-tests job).
  moduleNameMapper: {
    '^@izzywdev/fuzefront-identity$': '<rootDir>/../../packages/identity/src/index.ts',
    '^@fuzefront/telemetry$': '<rootDir>/../../packages/telemetry/src/index.ts',
  },
  testTimeout: 30000,
};
