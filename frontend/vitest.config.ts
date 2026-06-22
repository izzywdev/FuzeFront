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

// Force i18next and react-i18next to resolve from frontend/node_modules so that
// packages/i18n (aliased from source) and the host share a single module instance.
// Without this, Vite walks up from packages/i18n/src/ and can find a separate copy
// installed there by the root workspace npm ci, giving two isolated singletons/contexts.
const i18nextSrc = fileURLToPath(
  new URL('./node_modules/i18next', import.meta.url)
)
const reactI18nextSrc = fileURLToPath(
  new URL('./node_modules/react-i18next', import.meta.url)
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      '@fuzefront/design-system': designSystemSrc,
      'i18next': i18nextSrc,
      'react-i18next': reactI18nextSrc,
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
