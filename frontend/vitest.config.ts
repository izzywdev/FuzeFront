import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import react from '@vitejs/plugin-react'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Mirror vite.config.ts: resolve the shared i18n runtime from local monorepo
// source for tests when present (host); falls back to node_modules otherwise.
const i18nLocalSrc = r('../packages/i18n/src/index.ts')
const i18nAlias = existsSync(i18nLocalSrc) ? { '@fuzefront/i18n': i18nLocalSrc } : {}

// Mirror vite.config.ts: the LanguageSelector (in the i18n source) renders the
// design-system <Select>, so tests must resolve @fuzefront/design-system too.
const dsLocalSrc = r('../design-system/index.js')
const dsLocalDir = r('../design-system')
const dsAlias = existsSync(dsLocalSrc)
  ? {
      '@fuzefront/design-system/': `${dsLocalDir}/`,
      '@fuzefront/design-system': dsLocalSrc,
    }
  : {}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
      ...i18nAlias,
      ...dsAlias,
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'i18next', 'react-i18next'],
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
