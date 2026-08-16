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
// @fuzefront/auth-ui (AuthPanel, consumed by LoginPage.tsx) is an unpublished
// file: workspace package whose dist/ is not built in CI — resolve from
// SOURCE for bundling, same as identity-ui. frontend/tsconfig.json still
// resolves it to its built dist/index.d.ts for the type-check (see ci.yml),
// since it is TSX and imports @fuzefront/design-system.
const authUiSrc = fileURLToPath(
  new URL('../packages/auth-ui/src/index.ts', import.meta.url)
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
// @fuzefront/portal-client (top-level portal-client/) is the generated portal
// API client + contract types (contract-designer, FF-EPIC-10) and
// @fuzefront/portal-branding-ui (packages/portal-branding-ui) is the white-label
// tenant portal shell/login UI built against it (FF-EPIC-13). Neither's dist/ is
// built in CI — resolve both from SOURCE, same as billing-client/billing-ui.
const portalClientSrc = fileURLToPath(
  new URL('../portal-client/src/index.ts', import.meta.url)
)
const portalBrandingUiSrc = fileURLToPath(
  new URL('../packages/portal-branding-ui/src/index.ts', import.meta.url)
)
// @fuzefront/account-security-ui (packages/account-security-ui) is an unpublished
// file: workspace package whose dist/ is not built in CI — resolve from SOURCE,
// same as identity-ui. It is design-system-first and consumes only the generated
// @fuzefront/security-client TYPES.
const accountSecurityUiSrc = fileURLToPath(
  new URL('../packages/account-security-ui/src/index.ts', import.meta.url)
)
// @fuzeone/selection-lists-ui (packages/selection-lists-ui) is an unpublished
// file: workspace package whose dist/ is not built in the Docker image build —
// resolve from SOURCE so the frontend Dockerfile and vite build work without a
// separate pre-build step. CI builds dist/index.d.ts before the type-check step.
const selectionListsUiSrc = fileURLToPath(
  new URL('../packages/selection-lists-ui/src/index.ts', import.meta.url)
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
      '@fuzefront/auth-ui': authUiSrc,
      '@fuzefront/account-security-ui': accountSecurityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      // Exact stylesheet subpath must precede the bare '@fuzefront/chat-ui' alias.
      '@fuzefront/chat-ui/styles.css': chatUiStyles,
      '@fuzefront/chat-ui': chatUiSrc,
      '@fuzefront/chat-client': chatClientSrc,
      '@fuzefront/billing-ui': billingUiSrc,
      '@fuzefront/billing-client': billingClientSrc,
      '@fuzefront/app-registry-client': appRegistryClientSrc,
      '@fuzefront/security-client': securityClientSrc,
      '@fuzefront/portal-branding-ui': portalBrandingUiSrc,
      '@fuzefront/portal-client': portalClientSrc,
      '@fuzeone/selection-lists-ui': selectionListsUiSrc,
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
        react: { singleton: true, requiredVersion: '^19.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' } as any,
      },
    }),
    VitePWA({
      // vite-plugin-pwa internal Rollup build re-processes src/index.css without
      // @tailwindcss/postcss, causing PostCSS to fail on Tailwind v4 directives.
      // Service workers are irrelevant in CI (E2E tests the app, not the SW).
      ...(process.env.CI === 'true' ? { disabled: true } : {}),
      registerType: 'autoUpdate',
      // We register the SW ourselves (src/registerServiceWorker.ts via
      // virtual:pwa-register) so we can add the periodic/visibility/online
      // update-check polling the default auto-injected registerSW.js does
      // not provide. injectRegister: false stops VitePWA from ALSO
      // injecting its own <script> registration into index.html.
      injectRegister: false,
      devOptions: { enabled: false },
      workbox: {
        // Don't precache JS bundles — MFE remotes change independently and
        // stale cached JS would break federation. Let Workbox runtime-cache
        // JS with NetworkFirst so the shell always fetches fresh federation
        // assets. (Moved here from a top-level `globPatterns:` sibling of
        // `workbox` — VitePWAOptions has no such top-level field, only
        // `workbox.globPatterns` via GenerateSWOptions, so the prior
        // placement silently had no effect on the actual precache manifest.)
        globPatterns: ['**/*.{html,css,ico,png,svg,woff,woff2}'],
        // registerType 'autoUpdate' only re-checks for a new SW; it does NOT
        // by itself make a waiting worker activate. Without these two flags a
        // freshly-installed SW sits in `waiting` (observed live: old SW
        // `active`, new SW `waiting`, never activating) after rapid
        // consecutive deploys, and every client keeps being served the stale
        // cached shell/bundles until every tab is closed. skipWaiting lets
        // the new worker activate immediately; clientsClaim lets it take
        // control of already-open clients without a reload race.
        skipWaiting: true,
        clientsClaim: true,
        // Old precached entries (previous build's hashed CSS/icons/etc.) are
        // never purged otherwise — cleanupOutdatedCaches drops them once the
        // new SW activates, keeping the cache storage bounded to one build.
        cleanupOutdatedCaches: true,
        // Exclude server-owned paths from the SPA navigation fallback so full-page
        // navigations to them are NOT intercepted by the SW and silently served as
        // index.html. Two families must be excluded:
        //   1. /api/* — backend redirect endpoints (e.g. /api/auth/oidc/* → 302).
        //   2. Authentik's NATIVE paths, which the app Ingress reverse-proxies to
        //      the IdP (see values-prod authentik.oidc comment): /source/*,
        //      /application/*, /if/*, /outpost.goauthentik.io/*, /-/*. Social
        //      sign-in navigates the browser to /source/oauth/login/<provider>/;
        //      without these entries the SW served the cached SPA shell instead of
        //      letting the redirect reach Authentik → the "login just flickers"
        //      bug. This denylist MUST track the Ingress's Authentik path list.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/source\//,
          /^\/application\//,
          /^\/if\//,
          /^\/outpost\.goauthentik\.io\//,
          /^\/-\//,
        ],
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
