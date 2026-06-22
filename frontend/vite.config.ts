import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      // Resolve the shared i18n runtime from local source for dev/build/tests so
      // the container does not require the private @fuzefront registry to be
      // reachable at build time. The dependency is still declared in
      // package.json so installs from GitHub Packages resolve in CI/prod.
      '@fuzefront/i18n': r('../packages/i18n/src/index.ts'),
      // Single source of truth for locales: the repo-root `locales/` tree that
      // the i18n-translate workflow regenerates. Bundled via import.meta.glob.
      '@locales': r('../locales'),
    },
  },
  plugins: [
    react(),
    federation({
      name: 'container',
      remotes: {
        // Placeholder remote so the federation plugin emits the full host runtime
        // (including the shared scope). Real remotes are registered at runtime via
        // __federation_method_setRemote(). With no declared remote, the host build
        // leaves __rf_placeholder__shareScope unresolved → runtime ReferenceError.
        _dynamic: 'http://localhost/remoteEntry.js',
      },
      // Share react/react-dom AND the i18n runtime as singletons so every
      // federated micro-frontend joins the host's single i18next instance and
      // direction manager instead of bundling its own.
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        '@fuzefront/i18n': { singleton: true },
        i18next: { singleton: true },
        'react-i18next': { singleton: true },
      },
    }),
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    cors: true,
  },
})
