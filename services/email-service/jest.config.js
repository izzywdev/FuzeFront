// services/email-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // shared dist is ESM (module: esnext); email-service tests run in CommonJS via ts-jest.
  // Pointing to shared/src/index.ts would pull in AppContext.tsx (JSX), which ts-jest
  // cannot compile without --jsx. Since email-service only ever imports from the kafka
  // sub-tree of shared, the narrower mapping is intentional — not a partial-import trap.
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
    // @fuzefront/telemetry's dist is gitignored — map straight to TS source
    // for RUNTIME resolution (app.ts's tracingMiddleware()). ts-jest's
    // type-check still resolves the package's declared `types`
    // (dist/index.d.ts), so CI additionally builds it first (see
    // .github/workflows/ci.yml's email-service job).
    '^@fuzefront/telemetry$': '<rootDir>/../../packages/telemetry/src/index.ts',
  },
  testTimeout: 60000,
};
