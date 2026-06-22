import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Mirror vite.config.ts: resolve the @fuzefront/* workspace UI packages from source.
const identityUiSrc = fileURLToPath(
  new URL('../packages/identity-ui/src/index.ts', import.meta.url)
)
const designSystemSrc = fileURLToPath(
  new URL('../design-system/index.js', import.meta.url)
)
const i18nSrc = fileURLToPath(
  new URL('../packages/i18n/src/index.ts', import.meta.url)
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      '@fuzefront/design-system': designSystemSrc,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'forks',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**'],
    testTimeout: 15000,
  },
})
