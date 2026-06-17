import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// This remote has ZERO build-time knowledge of the host. It only declares the
// agreed Module Federation contract: a scope name, the exposed module, and the
// shared singletons (react/react-dom) the host also shares.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'fuzeClock',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' } as any,
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  base: '/',
  server: { host: '0.0.0.0', port: 3003, cors: true, strictPort: true },
  // CORS on preview too, so the host page can cross-origin import remoteEntry.js
  // when served via `vite preview` (used in the CI e2e job).
  preview: { host: '127.0.0.1', port: 4174, cors: true, strictPort: true },
})
