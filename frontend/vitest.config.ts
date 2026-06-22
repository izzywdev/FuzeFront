import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import react from '@vitejs/plugin-react'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Mirror vite.config.ts: resolve the shared i18n runtime from local monorepo
// source for tests when present (host); falls back to node_modules otherwise.
const i18nLocalSrc = r('../packages/i18n/src/index.ts')
const i18nAlias = existsSync(i18nLocalSrc) ? { '@fuzefront/i18n': i18nLocalSrc } : {}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
      ...i18nAlias,
    },
    // Force singleton React: when @fuzefront/i18n source is resolved from
    // packages/i18n/src/, its react-i18next import walks up to the root
    // node_modules and loads a second React copy, breaking hook invariants.
    dedupe: ['react', 'react-dom', 'react-i18next', 'i18next'],
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
