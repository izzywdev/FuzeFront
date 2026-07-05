// services/provisioning-service/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Map @fuzefront/shared to the kafka sub-barrel (TypeScript source) so ts-jest can compile it.
  // Narrower mapping intentional: provisioning-service only uses kafka exports.
  moduleNameMapper: {
    '^@fuzefront/shared$': '<rootDir>/../../shared/src/kafka/index.ts',
    '^@fuzefront/shared/kafka$': '<rootDir>/../../shared/src/kafka/index.ts',
  },
  // Ensure node_modules from this service are resolved even when ts-jest traverses
  // shared/src/* files that are outside rootDir.
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testTimeout: 60000,
};
