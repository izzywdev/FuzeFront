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
  // The shared kafka source imports kafkajs + zod; shared has no node_modules of its own, so
  // pin those to chat-service's copies (resolvable for both ts-jest type-checking and runtime).
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^kafkajs$': '<rootDir>/node_modules/kafkajs',
    '^zod$': '<rootDir>/node_modules/zod',
  },
  testTimeout: 60000,
};
