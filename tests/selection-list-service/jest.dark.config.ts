// jest.dark.config.ts — runs ONLY the flag-OFF dark spec (dark.spec.ts).
//
// The CI matrix's `off` leg starts selection-list-service with no flag provider
// and runs this config. It overrides the base testMatch (which collects
// `**/*.test.ts` and would skip a `.spec.ts` file) and drops the quota-seeding
// globalSetup, which the dark spec does not need.
import type { Config } from 'jest';
import base from './jest.config';

const config: Config = {
  ...base,
  globalSetup: undefined,
  testMatch: ['**/dark.spec.ts'],
};

export default config;
