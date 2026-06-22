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

// The "fuse seam" design system is published privately to GitHub Packages too.
// @fuzefront/i18n's LanguageSelector renders the DS <Select>, so the host must
// resolve @fuzefront/design-system as well. Mirror the i18n pattern: local
// monorepo source when present (host dev/build outside Docker), otherwise from
// node_modules (the @fuzefront registry) inside the ./frontend Docker context.
const dsLocalSrc = r('../design-system/index.js')
const dsLocalDir = r('../design-system')
const dsAlias = existsSync(dsLocalSrc)
  ? {
      // Subpath imports (e.g. styles.css, tokens/*) — must precede the exact
      // alias so the more specific prefix matches first.
      '@fuzefront/design-system/': `${dsLocalDir}/`,
      '@fuzefront/design-system': dsLocalSrc,
    }
  : {}

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      ...i18nAlias,
      ...dsAlias,
    },
    // The aliased i18n + design-system source lives outside ./frontend and has
    // no node_modules of its own; dedupe so their `import "react"` resolves to
    // the host's single React copy instead of failing to resolve.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'i18next', 'react-i18next'],
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
      // Share react/react-dom, the i18n runtime AND the design system as
      // singletons so every federated micro-frontend joins the host's single
      // i18next instance + direction manager and renders the same DS components
      // (one set of tokens/styles) instead of bundling its own.
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        // Explicit version avoids the plugin reading package.json from the alias
        // path (which is a source file, not a directory, and would ENOTDIR).
        '@fuzefront/i18n': { singleton: true, version: '1.0.0' },
        '@fuzefront/design-system': { singleton: true, version: '1.0.0' },
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
