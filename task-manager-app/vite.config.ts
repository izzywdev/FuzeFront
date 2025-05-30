import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 3002,
    cors: true,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
  base: '/',
})
