import { defineConfig } from 'vitest/config'

// The frontend currently has no unit tests (its coverage is the Playwright
// e2e suite under tests/). Don't fail CI's `vitest` run on an empty set;
// real unit tests added later run normally.
export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
