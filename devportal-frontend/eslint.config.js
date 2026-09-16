import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    // vendor-design-system is a generated copy of @fuzefront/design-system
    // (see scripts/sync-design-system.mjs) — lint the real source in
    // design-system/, not this vendored snapshot.
    ignores: ['dist/**/*', 'vendor-design-system/**/*']
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // This plugin version's `recommended` config does not itself turn off
      // the base `no-undef` rule (some do), so it stays on from
      // `js.configs.recommended` and false-positives on ambient TS lib types
      // (RequestInit, HTMLElement, …) that only `tsc`/`@typescript-eslint`
      // can actually resolve — standard TS-ESLint guidance is to disable it.
      'no-undef': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ]
    }
  },
  {
    // Playwright configs and the e2e suite run under Node, not the browser —
    // they need `process`/`Buffer`, not `globals.browser`.
    files: ['playwright*.config.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  }
]
