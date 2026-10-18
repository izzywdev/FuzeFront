module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // @fuzefront/telemetry's dist is gitignored — map straight to TS source so
  // ts-jest can resolve app.ts's tracingMiddleware() import without
  // requiring a prior `npm run build` in packages/telemetry (mirrors
  // services/billing-service/jest.config.js's identical treatment).
  moduleNameMapper: {
    '^@fuzefront/telemetry$': '<rootDir>/../../packages/telemetry/src/index.ts',
  },
  testTimeout: 10000,
};
