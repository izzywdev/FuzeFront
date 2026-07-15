import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import { VitePWA } from 'vite-plugin-pwa'

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
// @fuzefront/billing-ui (packages/billing-ui) + @fuzefront/billing-client (top-level
// billing-client/) are unpublished file: workspace packages — resolve from SOURCE,
// same as identity-ui/chat-ui. billing-ui components are token-based (inline --ff-*),
// so there's no separate stylesheet subpath to map.
const billingUiSrc = fileURLToPath(
  new URL('../packages/billing-ui/src/index.ts', import.meta.url)
)
const billingClientSrc = fileURLToPath(
  new URL('../billing-client/src/index.ts', import.meta.url)
)
// @fuzefront/app-registry-client (apps-client/) is an unpublished file: workspace
// package whose dist/ is not built in CI — resolve from SOURCE, same as
// billing-client. Its src/index.ts re-exports the generated schema + axios client.
const appRegistryClientSrc = fileURLToPath(
  new URL('../apps-client/src/index.ts', import.meta.url)
)
// @fuzefront/security-client (packages/security/) is the generated, provider-
// agnostic Security API client + contract types. Its dist/ is not built in CI —
// resolve from SOURCE, same as the other unpublished workspace packages. The
// frontend consumes only its TYPES (import type), so this alias is a safety net.
const securityClientSrc = fileURLToPath(
  new URL('../packages/security/src/index.ts', import.meta.url)
)
// Workspace packages resolved from SOURCE (via alias) live outside the frontend/
// directory tree. Rollup walks UP from each file to find node_modules, so it never
// reaches frontend/node_modules for those files. This resolver fills the gap: it
// tries require.resolve from frontend/node_modules as a fallback so packages like
// @tanstack/react-table, eventsource-parser, etc. are found even though they're
// not installed in the workspace package's own node_modules.
const frontendRequire = createRequire(import.meta.url) // resolves from frontend/
const workspaceDepResolver = {
  name: 'resolve-workspace-transitive-deps',
  resolveId(id: string) {
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null
    try {
      const resolved = frontendRequire.resolve(id)
      return { id: resolved, external: false }
    } catch {
      return null
    }
  },
}

export default defineConfig({
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      // Exact stylesheet subpath must precede the bare '@fuzefront/chat-ui' alias.
      '@fuzefront/chat-ui/styles.css': chatUiStyles,
      '@fuzefront/chat-ui': chatUiSrc,
      '@fuzefront/chat-client': chatClientSrc,
      '@fuzefront/billing-ui': billingUiSrc,
      '@fuzefront/billing-client': billingClientSrc,
      '@fuzefront/app-registry-client': appRegistryClientSrc,
      '@fuzefront/security-client': securityClientSrc,
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
    workspaceDepResolver,
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
      //
      // React/react-dom are declared as explicit SINGLETONS (not the bare array
      // shorthand) so they EXACTLY match the clock-app remote's shared config
      // (clock-app/vite.config.ts). The host seeds the shared scope with its one
      // React instance and runtime-loaded remotes (Clock) reuse it across the
      // federation boundary — a singleton mismatch would let the remote pull its
      // own React copy and crash on "Invalid hook call" / hang on the spinner.
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' } as any,
      },
    }),
    VitePWA({
      // vite-plugin-pwa internal Rollup build re-processes src/index.css without
      // @tailwindcss/postcss, causing PostCSS to fail on Tailwind v4 directives.
      // Service workers are irrelevant in CI (E2E tests the app, not the SW).
      ...(process.env.CI === 'true' ? { disabled: true } : {}),
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      // Don't precache JS bundles — MFE remotes change independently and stale
      // cached JS would break federation. Let Workbox runtime-cache JS with
      // NetworkFirst so the shell always fetches fresh federation assets.
      globPatterns: ['**/*.{html,css,ico,png,svg,woff,woff2}'],
      workbox: {
        // Exclude /api/* from the SPA navigation fallback so full-page navigations
        // to backend redirect endpoints (e.g. /api/auth/oidc/signup → 302) are not
        // intercepted by the SW and silently served as index.html instead.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // API + WebSocket upgrade paths — never cache
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') ||
              url.pathname.startsWith('/chat-api/') ||
              url.pathname.startsWith('/socket.io/'),
            handler: 'NetworkOnly',
          },
          {
            // JS bundles (host + remote entry points) — NetworkFirst so
            // updated remotes always load without a full SW update cycle.
            urlPattern: ({ request }) => request.destination === 'script',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'js-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 80, maxAgeSeconds: 86400 },
            },
          },
          {
            // CSS — StaleWhileRevalidate for fast paint + background refresh
            urlPattern: ({ request }) => request.destination === 'style',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'css-cache' },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'FuzeFront',
        short_name: 'FuzeFront',
        description: 'Runtime Microfrontend Platform',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0b0e15',
        theme_color: '#6e5cff',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/FrontFuseLogo.png',
            sizes: '1024x1024',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'FuzeFront dashboard',
          },
        ],
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
