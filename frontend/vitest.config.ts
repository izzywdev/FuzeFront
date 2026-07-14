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

// Intercept ALL .css imports (including out-of-root ones like billing-ui.css that
// BillingPage imports) and return an empty module BEFORE vite:css runs. This stops
// vite from routing any stylesheet through frontend/postcss.config.js →
// @tailwindcss/postcss → @tailwindcss/oxide (a native binary absent in CI), which
// otherwise crashes the test file during transform. jsdom tests assert DOM/logic,
// not visual output, so stubbing CSS is correct. Runs before @vitejs/plugin-react.
const stubCss = {
  name: 'stub-css-imports',
  enforce: 'pre' as const,
  load(id: string) {
    return id.split('?')[0].endsWith('.css') ? 'export default {}' : null
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
