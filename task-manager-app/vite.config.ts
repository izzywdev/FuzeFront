import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'taskManager',
      filename: 'remoteEntry.js',
      exposes: {
        './TaskManagerApp': './src/App',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.0.0',
        } as any,
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
        } as any,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3002,
    cors: true,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  base: '/',
})
