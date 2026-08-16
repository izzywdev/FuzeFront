import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(appRoot),
  plugins: [
    react(),
    federation({
      name: 'fuzequality',
      filename: 'remoteEntry.js',
      exposes: { './App': './src/remote.tsx' },
        shared: {
          react: { requiredVersion: '^18.0.0' },
          'react-dom': { requiredVersion: '^18.0.0' },
      },
    }),
  ],
  server: {
    port: 4181,
    proxy: { '/api': 'http://localhost:4180', '/health': 'http://localhost:4180' },
  },
  build: {
    outDir: resolve(appRoot, '../../dist/web'),
    emptyOutDir: true,
    target: 'esnext',
  },
})
