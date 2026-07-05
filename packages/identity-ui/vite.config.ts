import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const dsRoot = fileURLToPath(new URL('../../design-system', import.meta.url))

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
      ],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Resolve the design-system to its source folder so unit tests don't depend
    // on the npm workspace symlink (which requires GitHub Packages auth to link).
    alias: {
      '@fuzefront/design-system': dsRoot + '/index.js',
    },
  },
})
