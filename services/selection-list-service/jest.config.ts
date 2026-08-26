// services/selection-list-service/jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // isolatedModules: transpile-only (no cross-file type-checking) so ts-jest
    // does not fail on type imports it cannot resolve.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json', isolatedModules: true }],
  },
  testTimeout: 60000,
};

export default config;
