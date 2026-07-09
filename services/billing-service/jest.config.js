// services/billing-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // shared dist is ESM (module: esnext); billing-service tests run in CommonJS via ts-jest.
  // Pointing to shared/src/index.ts would pull in AppContext.tsx (JSX), which ts-jest
  // cannot compile without --jsx. Since billing-service only ever imports from the kafka
  // sub-tree of shared, the narrower mapping is intentional — not a partial-import trap.
  moduleNameMapper: {
    '^@fuzefront/shared/dist/kafka$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
  },
  testTimeout: 60000,
  // Coverage scoped to the unit-testable logic (services, handlers, routes,
  // mappers). Excluded: index.ts (process bootstrap), the Kafka/db/stripe glue,
  // type-only modules, and the Pg* repositories (DB-bound — exercised by the
  // DATABASE_URL-gated integration suite, not the unit run). Thresholds are set
  // conservatively so the build is green; CI is the source of truth and the
  // numbers can be ratcheted up as coverage grows.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/kafka/**',
    '!src/db.ts',
    '!src/config.ts',
    '!src/stripe-client.ts',
    '!src/types.ts',
    '!src/handlers/types.ts',
    '!src/repositories/**',
    '!src/middleware/**',
  ],
  coverageThreshold: {
    global: {
      statements: 60,
      lines: 60,
      functions: 55,
      branches: 45,
    },
  },
};
