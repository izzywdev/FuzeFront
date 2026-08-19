import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Standalone vitest config (no vite build plugins) so the unit suite runs
// without @vitejs/plugin-react / vite-plugin-dts. esbuild handles the automatic
// JSX transform. Bundling/dts for the library build live in vite.config.ts.
const dsRoot = fileURLToPath(new URL('../../design-system', import.meta.url))
const securityClientSrc = fileURLToPath(new URL('../security/src/index.ts', import.meta.url))

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@fuzefront/design-system': dsRoot + '/index.js',
      '@fuzefront/security-client': securityClientSrc,
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
