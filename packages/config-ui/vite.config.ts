import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const dsRoot = fileURLToPath(new URL('../../design-system', import.meta.url))
const configClientRoot = fileURLToPath(new URL('../../config-client/src/index.ts', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    dts({ insertTypesEntry: true }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (fmt) => fmt === 'cjs' ? 'index.cjs' : 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@fuzefront/design-system',
        /^@fuzefront\/design-system\/.*/,
        '@fuzefront/config-client',
      ],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Resolve workspace siblings to their source folders so unit tests don't
    // depend on the npm workspace symlink (which requires GitHub Packages
    // auth to link) — mirrors packages/identity-ui/vite.config.ts.
    alias: {
      '@fuzefront/design-system': dsRoot + '/index.js',
      '@fuzefront/config-client': configClientRoot,
    },
  },
})
