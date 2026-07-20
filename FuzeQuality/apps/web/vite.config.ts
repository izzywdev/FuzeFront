import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(appRoot),
  plugins: [react()],
  server: {
    port: 4181,
    proxy: { '/api': 'http://localhost:4180', '/health': 'http://localhost:4180' },
  },
  build: { outDir: resolve(appRoot, '../../dist/web'), emptyOutDir: true },
})
