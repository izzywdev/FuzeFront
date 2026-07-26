// services/chat-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // isolatedModules: transpile-only (no cross-file type-checking) so ts-jest does
    // not fail on type imports it cannot resolve from the mapped shared source (e.g.
    // kafkajs from shared/src/kafka). Full type-checking is done separately by
    // `tsc --noEmit`.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json', isolatedModules: true }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // shared dist is ESM (module: esnext); chat-service tests run in CommonJS via ts-jest.
  // The shared kafka source imports kafkajs + zod, and shared has no node_modules of its own,
  // so those must resolve from here.
  //
  // require.resolve rather than a hard-coded '<rootDir>/node_modules/...': chat-service is now a
  // root workspace, so npm hoists its deps to the repo-root node_modules and the local path does
  // not exist. require.resolve walks up from this config and finds the package wherever npm put
  // it, so this holds under both hoisted and nested installs.
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^kafkajs$': require.resolve('kafkajs'),
    '^zod$': require.resolve('zod'),
  },
  testTimeout: 60000,
};
