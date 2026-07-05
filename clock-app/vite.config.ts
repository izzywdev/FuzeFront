import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// The built-in Clock remote. It has ZERO build-time knowledge of the host —
// it only declares the agreed Module Federation contract that matches the seed
// manifest (services/app-registry-service/seed/clock.manifest.json):
//   scope  = "fuzeClock"  (federation `name`)
//   module = "./App"      (exposed module)
//   remoteEntry served at …/apps/clock/assets/remoteEntry.js
// React / react-dom are shared as singletons so the host's single React instance
// is reused across the federation boundary (must match the host's shared deps).
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
    {
      // In `vite preview` the build is served under the /apps/clock/ base. The
      // CI e2e workflow fetches remoteEntry.js from /assets/remoteEntry.js (root-
      // relative), so rewrite that prefix to the actual serving path so the
      // health-check curl and the Playwright federation load both succeed.
      name: 'preview-assets-rewrite',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/assets/')) {
            req.url = '/apps/clock' + req.url
          }
          next()
        })
      },
    },
  ],
  // Served under /apps/clock/ in prod (remoteEntry at /apps/clock/assets/remoteEntry.js),
  // matching the seed manifest's remoteEntry URL.
  base: '/apps/clock/',
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  server: { host: '0.0.0.0', port: 3003, cors: true, strictPort: true },
  // CORS on preview too, so the host page can cross-origin import remoteEntry.js
  // when served via `vite preview` (used in the CI e2e job).
  preview: { host: '127.0.0.1', port: 4174, cors: true, strictPort: true },
})
