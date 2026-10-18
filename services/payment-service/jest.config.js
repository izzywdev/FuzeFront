// services/payment-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Resolve the file-linked @fuzefront packages from TS source, so tests run
  // without a built dist (mirrors billing-service's identity mapping). The
  // package's only cross-package reference is a type-only import of
  // @fuzefront/security-client, which is erased at runtime; it is mapped too so
  // any resolution stays inside the repo rather than reaching node_modules.
  moduleNameMapper: {
    '^@fuzefront/service-auth$': '<rootDir>/../../packages/service-auth/src/index.ts',
    '^@fuzefront/security-client$': '<rootDir>/../../packages/security/src/index.ts',
    // @fuzefront/telemetry's dist is gitignored too — map straight to TS
    // source so tests run without a prior `npm run build` in
    // packages/telemetry (app.ts's tracingMiddleware()).
    '^@fuzefront/telemetry$': '<rootDir>/../../packages/telemetry/src/index.ts',
  },
  testTimeout: 60000,
};
