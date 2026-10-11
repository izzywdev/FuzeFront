import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // The exported FuzeFront package lives one directory above this workspace.
    // Force hook-based Design System primitives onto FuzeQuality's renderer so
    // tests exercise the same singleton React contract as Module Federation.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
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
