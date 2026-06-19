// services/chat-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // shared dist is ESM (module: esnext); chat-service tests run in CommonJS via ts-jest.
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
  },
  testTimeout: 60000,
};
