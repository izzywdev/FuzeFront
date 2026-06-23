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
const designSystemDir = fileURLToPath(new URL('../design-system', import.meta.url))
const i18nSrc = fileURLToPath(
  new URL('../packages/i18n/src/index.ts', import.meta.url)
)
// @fuzefront/chat-client and @fuzefront/chat-ui are file: workspace packages whose
// dist/ is not built in CI (same reason as identity-ui), so resolve them from
// SOURCE too. chat-ui's stylesheet lives at src/styles/chat-ui.css (tsup copies it
// to dist/styles.css on a real build); map the published ./styles.css subpath to it.
const chatClientSrc = fileURLToPath(
  new URL('../packages/chat-client/src/index.ts', import.meta.url)
)
const chatUiSrc = fileURLToPath(
  new URL('../packages/chat-ui/src/index.ts', import.meta.url)
)
const chatUiStyles = fileURLToPath(
  new URL('../packages/chat-ui/src/styles/chat-ui.css', import.meta.url)
)

export default defineConfig({
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      // Exact stylesheet subpath must precede the bare '@fuzefront/chat-ui' alias.
      '@fuzefront/chat-ui/styles.css': chatUiStyles,
      '@fuzefront/chat-ui': chatUiSrc,
      '@fuzefront/chat-client': chatClientSrc,
      // Subpath imports (e.g. styles.css, tokens/*) must map to the design-system
      // DIRECTORY and precede the exact alias, else `@fuzefront/design-system/styles.css`
      // resolves under the index.js FILE → ENOTDIR. main.tsx imports the stylesheet.
      '@fuzefront/design-system/': `${designSystemDir}/`,
      '@fuzefront/design-system': designSystemSrc,
    },
    // @fuzefront/i18n is bundled from source and pulls react-i18next (which has a
    // nested react copy under packages/i18n/node_modules). Dedupe so the host
    // bundle has a single React instance — otherwise hooks crash at runtime.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-i18next', 'i18next'],
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
      // UI packages (@fuzefront/identity-ui, @fuzefront/design-system,
      // @fuzefront/chat-ui) resolve from source/workspace; listing them here makes
      // the federation plugin read `<aliased-file>/package.json` (ENOTDIR) — so they
      // are bundled into the host directly rather than shared.
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
