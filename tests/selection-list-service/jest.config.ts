import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // isolatedModules: transpile-only; full type-checking runs separately via `tsc --noEmit`.
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  moduleNameMapper: {
    // Point the client import at the TypeScript source so tests compile without
    // a prior `npm run build` in the client package.
    '^@fuzeone/selection-list-client$': '<rootDir>/../../selection-list-client/src/index.ts',
  },
  // Integration tests hit a real service; 30 s per test is generous but necessary.
  testTimeout: 30_000,
};

export default config;
