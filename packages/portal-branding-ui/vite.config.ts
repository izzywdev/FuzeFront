import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const dsRoot = fileURLToPath(new URL('../../design-system', import.meta.url))
const portalClientSrc = fileURLToPath(
  new URL('../../portal-client/src/index.ts', import.meta.url)
)

export default defineConfig({
  plugins: [react(), dts({ insertTypesEntry: true })],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: fmt => (fmt === 'cjs' ? 'index.cjs' : 'index.js'),
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@fuzeone/design-system',
        /^@fuzeone\/design-system\/.*/,
        '@fuzeone/portal-client',
        'axios',
      ],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Resolve workspace packages to SOURCE so unit tests don't depend on the npm
    // workspace symlink (which needs GitHub Packages auth) or a pre-built dist.
    alias: {
      '@fuzeone/design-system': dsRoot + '/index.js',
      '@fuzeone/portal-client': portalClientSrc,
    },
  },
})
