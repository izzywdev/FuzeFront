import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The SDK currently ships no unit tests; allow the suite to pass cleanly
    // until tests are added, so CI's `npm test` step stays green.
    passWithNoTests: true,
    environment: 'node',
  },
})
