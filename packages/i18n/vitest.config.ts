import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the design system from local monorepo source so the no-build
      // unit tests render the real DS <Select> (the published package would be
      // resolved from GitHub Packages in CI/Docker installs).
      '@fuzefront/design-system': r('../../design-system/index.js'),
    },
    // The DS source lives outside this package's tree and has no node_modules of
    // its own; dedupe ensures its `import "react"` resolves to this package's
    // single React copy instead of failing to resolve relative to design-system/.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
