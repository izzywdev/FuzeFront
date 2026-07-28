import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The stub integration test polls a real four-state lifecycle on a timer.
    testTimeout: 90_000,
  },
});
