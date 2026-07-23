import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@fuzequality/contracts': `${root}packages/contracts/src/index.ts`,
      '@fuzequality/core': `${root}packages/core/src/index.ts`,
      '@fuzequality/github-app': `${root}packages/github-app/src/index.ts`,
      '@fuzequality/scanner': `${root}packages/scanner/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
  },
})
