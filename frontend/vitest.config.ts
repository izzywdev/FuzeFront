import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Mirror vite.config.ts: resolve the @fuzefront/* workspace UI packages from source.
const identityUiSrc = fileURLToPath(
  new URL('../packages/identity-ui/src/index.ts', import.meta.url)
)
// @fuzefront/auth-ui (AuthPanel) — resolve from SOURCE, mirroring vite.config.ts.
// Without this, LoginPage.test.tsx (which imports LoginPage -> @fuzefront/auth-ui)
// fails to resolve, since the package's dist/ is not built in this test run.
const authUiSrc = fileURLToPath(
  new URL('../packages/auth-ui/src/index.ts', import.meta.url)
)
const designSystemSrc = fileURLToPath(
  new URL('../design-system/index.js', import.meta.url)
)
const i18nSrc = fileURLToPath(
  new URL('../packages/i18n/src/index.ts', import.meta.url)
)
const billingUiSrc = fileURLToPath(
  new URL('../packages/billing-ui/src/index.ts', import.meta.url)
)
const billingClientSrc = fileURLToPath(
  new URL('../billing-client/src/index.ts', import.meta.url)
)
const accountSecurityUiSrc = fileURLToPath(
  new URL('../packages/account-security-ui/src/index.ts', import.meta.url)
)
const configClientSrc = fileURLToPath(
  new URL('../config-client/src/index.ts', import.meta.url)
)
const configUiSrc = fileURLToPath(
  new URL('../packages/config-ui/src/index.ts', import.meta.url)
)
// @fuzefront/portal-client + @fuzefront/portal-branding-ui — same unbuilt-dist
// reasoning as account-security-ui/security-client above (FF-EPIC-10/13).
const portalClientSrc = fileURLToPath(
  new URL('../portal-client/src/index.ts', import.meta.url)
)
const portalBrandingUiSrc = fileURLToPath(
  new URL('../packages/portal-branding-ui/src/index.ts', import.meta.url)
)
// app-registry-client (apps-client/) is an unpublished file: workspace package
// whose dist/ is not built in CI — resolve from SOURCE, mirroring vite.config.ts.
// Without this, tests doing a real `import { AppRegistryClient } from
// '@fuzefront/app-registry-client'` (e.g. appRegistry.test.tsx) fail to resolve.
const appRegistryClientSrc = fileURLToPath(
  new URL('../apps-client/src/index.ts', import.meta.url)
)

// Intercept ALL .css imports (including out-of-root ones like billing-ui.css that
// BillingPage imports) and return an empty module BEFORE vite:css runs. This stops
// vite from routing any stylesheet through frontend/postcss.config.js →
// @tailwindcss/postcss → @tailwindcss/oxide (a native binary absent in CI), which
// otherwise crashes the test file during transform. jsdom tests assert DOM/logic,
// not visual output, so stubbing CSS is correct. Runs before @vitejs/plugin-react.
// Stub the virtual:__federation__ module that @originjs/vite-plugin-federation
// provides at build time — vitest does not load that plugin, so imports of
// loadFederatedApp.ts (which does `import ... from 'virtual:__federation__'`)
// fail to resolve. The stub exposes the three exports the loader uses.
const FEDERATION_STUB_ID = '\0federation-stub.js'
const stubFederation = {
  name: 'stub-federation-virtual',
  enforce: 'pre' as const,
  resolveId(id: string) {
    return id === 'virtual:__federation__' ? FEDERATION_STUB_ID : null
  },
  load(id: string) {
    if (id !== FEDERATION_STUB_ID) return null
    return `
      export const __federation_method_setRemote = () => {};
      export const __federation_method_getRemote = async () => ({});
      export const __federation_method_unwrapDefault = async (m) => m;
    `
  },
}

const CSS_STUB_ID = '\0css-stub.js'
const stubCss = {
  name: 'stub-css-imports',
  enforce: 'pre' as const,
  // Map every .css import to a virtual module whose id does NOT end in .css, so
  // vite:css's isCSSRequest(id) returns false and its transform (which would load
  // frontend/postcss.config.js -> @tailwindcss/postcss -> native @tailwindcss/oxide,
  // absent in CI) is skipped entirely. A load-only stub is insufficient: vite:css
  // re-checks the id by extension after load. jsdom tests assert DOM/logic, not CSS.
  resolveId(id: string) {
    return id.split('?')[0].endsWith('.css') ? CSS_STUB_ID : null
  },
  load(id: string) {
    return id === CSS_STUB_ID ? 'export default {}' : null
  },
}

export default defineConfig({
  plugins: [stubCss, stubFederation, react()],
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/auth-ui': authUiSrc,
      '@fuzefront/i18n': i18nSrc,
      '@fuzefront/design-system': designSystemSrc,
      // billing-ui + billing-client are resolved from SOURCE (unpublished file:
      // workspace packages whose dist is not built in CI), mirroring vite.config.ts.
      // Without these, BillingPage.test.tsx fails to resolve @fuzefront/billing-ui
      // (package.json main points to an unbuilt dist).
      '@fuzefront/billing-ui': billingUiSrc,
      '@fuzefront/billing-client': billingClientSrc,
      '@fuzefront/app-registry-client': appRegistryClientSrc,
      '@fuzefront/account-security-ui': accountSecurityUiSrc,
      '@fuzefront/portal-branding-ui': portalBrandingUiSrc,
      '@fuzefront/portal-client': portalClientSrc,
      // config-client + config-ui: same unbuilt-dist case as billing-* above.
      // package.json main points at a dist/ that CI never builds, so the Config
      // pages fail to resolve them unless aliased to SOURCE here too. vite.config.ts
      // already does this; vitest.config.ts is a SEPARATE config and needs its own.
      '@fuzefront/config-client': configClientSrc,
      '@fuzefront/config-ui': configUiSrc,
    },
    // @fuzefront/i18n is resolved from source and pulls react-i18next, which has
    // its own nested react copy under packages/i18n/node_modules. Without dedupe
    // the host renders with one React while react-i18next uses another → invalid
    // hook call ("Cannot read properties of null (reading 'useMemo')"). Force a
    // single instance of React and the i18n runtime.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-i18next', 'i18next'],
  },
  // Inline PostCSS config: per Vite docs, when css.postcss is an inline object
  // Vite does NOT search for / load frontend/postcss.config.js (which pulls
  // @tailwindcss/postcss -> @tailwindcss/oxide, a native binary absent in CI that
  // crashes the CSS transform the moment a test imports raw CSS). This is the
  // authoritative stop; the stub-css pre-plugin above is defence-in-depth.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'forks',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**'],
    testTimeout: 15000,
    // jsdom unit tests don't assert on real CSS. Disable CSS processing so raw
    // stylesheet imports (e.g. BillingPage importing billing-ui.css) become
    // no-ops instead of routing through PostCSS — which fails in CI on a missing
    // native binding (npm optional-deps bug) the moment a test imports raw CSS.
    css: false,
  },
})
