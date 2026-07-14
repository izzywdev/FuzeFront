import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Mirror vite.config.ts: resolve the @fuzefront/* workspace UI packages from source.
const identityUiSrc = fileURLToPath(
  new URL('../packages/identity-ui/src/index.ts', import.meta.url)
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

// Remap ALL .css imports to a virtual JS module so vite:css never sees them.
//
// Why resolveId (not just load): vite:css uses a *transform* hook that fires
// AFTER load and re-checks the module ID via isCSSRequest(id). isCSSRequest
// matches any ID whose path ends with ".css" (regex: /\.(css|…)(?:$|\?)/). A
// load-only stub returns JS content but leaves the ".css" ID intact, so
// vite:css.transform still runs and triggers the PostCSS pipeline — which loads
// @tailwindcss/postcss → @tailwindcss/oxide, a native binary absent in CI
// (npm optional-deps bug). Remapping to "\0css-stub.js" in resolveId changes the
// module ID to one that does NOT end in ".css", so isCSSRequest() returns false
// and vite:css skips it entirely. jsdom tests assert DOM/logic, not styles.
const stubCss = {
  name: 'stub-css-imports',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.split('?')[0].endsWith('.css')) {
      return '\0css-stub.js'
    }
    return null
  },
  load(id: string) {
    if (id === '\0css-stub.js') {
      return 'export default {}'
    }
    return null
  },
}

export default defineConfig({
  plugins: [stubCss, react()],
  resolve: {
    alias: {
      '@fuzefront/identity-ui': identityUiSrc,
      '@fuzefront/i18n': i18nSrc,
      '@fuzefront/design-system': designSystemSrc,
      // billing-ui + billing-client are resolved from SOURCE (unpublished file:
      // workspace packages whose dist is not built in CI), mirroring vite.config.ts.
      // Without these, BillingPage.test.tsx fails to resolve @fuzefront/billing-ui
      // (package.json main points to an unbuilt dist).
      '@fuzefront/billing-ui': billingUiSrc,
      '@fuzefront/billing-client': billingClientSrc,
    },
    // @fuzefront/i18n is resolved from source and pulls react-i18next, which has
    // its own nested react copy under packages/i18n/node_modules. Without dedupe
    // the host renders with one React while react-i18next uses another → invalid
    // hook call ("Cannot read properties of null (reading 'useMemo')"). Force a
    // single instance of React and the i18n runtime.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-i18next', 'i18next'],
  },
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
