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
      fileName: (fmt) => (fmt === 'cjs' ? 'index.cjs' : 'index.js'),
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@fuzefront/design-system',
        /^@fuzefront\/design-system\/.*/,
        'react-router-dom',
      ],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Run with `vitest run --coverage` (needs the `@vitest/coverage-v8` dev
    // dependency). The thresholds are a floor: a drop below them fails the run.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/index.ts', 'src/types.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 90,
        branches: 85,
      },
    },
    alias: {
      '@fuzefront/design-system': dsRoot + '/index.js',
    },
  },
})
