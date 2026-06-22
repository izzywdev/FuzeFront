import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// Resolve the @fuzefront/* workspace UI packages from SOURCE rather than from a
// published registry build. @fuzefront/identity-ui is an unpublished local
// workspace package whose ./dist is not built in CI, and @fuzefront/design-system
// ships pre-built source from its package root. Aliasing both to source keeps the
// host build/test self-contained (no GitHub Packages token, no extra build step).
const identityUiSrc = fileURLToPath(
  new URL('../packages/identity-ui/src/index.ts', import.meta.url)
)
const designSystemSrc = fileURLToPath(
  new URL('../design-system/index.js', import.meta.url)
)
const i18nSrc = fileURLToPath(
  new URL('../packages/i18n/src/index.ts', import.meta.url)
)

export default defineConfig({
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      '@fuzefront/design-system': designSystemSrc,
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
      // Only true cross-remote singletons go in the shared scope. The host's own
      // UI packages (@fuzefront/identity-ui, @fuzefront/design-system) are aliased
      // to source files above; listing them here makes the federation plugin read
      // `<aliased-file>/package.json` (ENOTDIR) — so they are bundled into the host
      // directly rather than shared.
      shared: ['react', 'react-dom'],
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
