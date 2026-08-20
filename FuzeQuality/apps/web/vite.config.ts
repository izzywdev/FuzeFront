import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(appRoot),
  // Served by the host shell at https://<host>/apps/fuzequality/ — the FuzeFront
  // ingress proxies that prefix straight to this app's in-cluster Service, so the
  // remote never re-enters the public edge. `base` must match that prefix (and
  // the app-registry slug): remoteEntry.js would load either way, but every chunk
  // it imports would be emitted at /assets/… and get answered by the HOST shell's
  // own bundle instead of ours.
  base: '/apps/fuzequality/',
  plugins: [
    react(),
    federation({
      name: 'fuzequality',
      filename: 'remoteEntry.js',
      exposes: { './App': './src/remote.tsx' },
      // MUST match the host's shared config EXACTLY (FuzeFront
      // frontend/vite.config.ts): explicit singletons on ^19.0.0. Without
      // `singleton: true`, or on a different major range, this remote loads its
      // own React copy across the federation boundary and dies at runtime on
      // "Invalid hook call" — in the browser, with nothing in CI to catch it.
      //
      // The `as any` casts mirror the host verbatim: @originjs/vite-plugin-
      // federation@1.4.1 types `shared` as `Shared`, which does not admit this
      // per-package object form even though the plugin consumes it at runtime.
      // Dropping the casts fails `tsc --noEmit` with TS2322 and takes the whole
      // image build down at the Dockerfile's type-check step.
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' } as any,
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
