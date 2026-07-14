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

export default defineConfig({
  plugins: [react()],
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
  // Override PostCSS with an inline empty config so vite does NOT auto-load
  // frontend/postcss.config.js (which pulls @tailwindcss/postcss). That plugin's
  // native binding is absent in CI and crashes the CSS transform the moment a
  // test imports raw CSS (BillingPage -> billing-ui.css). Tests don't build real
  // CSS, so an empty pipeline is correct here. test.css:false alone is not enough
  // — vite still loads the external postcss config to process the import.
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
