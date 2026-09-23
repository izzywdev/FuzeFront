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
  // The mapper key names the SUPPORTED subpath (@fuzefront/shared/kafka, matching the
  // package's declared `exports`), not the dist/ internal it used to point at.
  moduleNameMapper: {
    '^@fuzefront/shared/kafka$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^@izzywdev/fuzefront-identity$': '<rootDir>/../../packages/identity/src/index.ts',
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
    // @fuzefront/auth's dist is gitignored (same reasoning as identity above) —
    // map straight to TS source so ts-jest can compile it at RUNTIME without
    // requiring a prior `npm run build` in packages/auth. ts-jest's
    // TYPE-CHECK still resolves the package's declared `types` (dist/index.d.ts)
    // regardless of this mapper, so CI additionally builds packages/auth
    // first (see .github/workflows/billing-service-tests.yml), same as it
    // already does for @izzywdev/fuzefront-identity.
    '^@fuzefront/auth$': '<rootDir>/../../packages/auth/src/index.ts',
  },
  testTimeout: 60000,
};
