import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// The shared i18n runtime is published privately to GitHub Packages. For host
// dev/test/type-check (and any build outside the Docker context) we resolve it
// from local monorepo source when that source is present; inside the frontend
// Docker image — whose build context is only ./frontend — it resolves from
// node_modules (installed from the @fuzefront registry with a token).
const i18nLocalSrc = r('../packages/i18n/src/index.ts')
const i18nAlias = existsSync(i18nLocalSrc) ? { '@fuzefront/i18n': i18nLocalSrc } : {}

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      ...i18nAlias,
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
