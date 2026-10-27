import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es', 'cjs'], fileName: format => format === 'cjs' ? 'index.cjs' : 'index.js' },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime', '@fuzefront/design-system'] },
  },
  resolve: { alias: { '@fuzefront/design-system': fileURLToPath(new URL('../../design-system/index.js', import.meta.url)) } },
})
