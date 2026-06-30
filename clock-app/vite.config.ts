import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// The built-in Clock remote. It has ZERO build-time knowledge of the host —
// it only declares the agreed Module Federation contract that matches the seed
// manifest (services/app-registry-service/seed/clock.manifest.json):
//   scope  = "clockApp"   (federation `name`)
//   module = "./ClockApp" (exposed module)
//   remoteEntry served at …/apps/clock/remoteEntry.js
// React / react-dom are shared as singletons so the host's single React instance
// is reused across the federation boundary (must match the host's shared deps).
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'clockApp',
      filename: 'remoteEntry.js',
      exposes: {
        './ClockApp': './src/App',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' } as any,
      },
    }),
  ],
  // Served under /apps/clock/ in prod (remoteEntry at /apps/clock/remoteEntry.js),
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
