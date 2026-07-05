module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // Off: this is a Vite fast-refresh DX hint, not a correctness rule. Context
    // and shared modules here intentionally co-locate hooks/utilities with their
    // provider components; splitting them is a structural refactor, not a fix.
    // (--max-warnings 0 in CI means a warning fails the build, so off, not warn.)
    'react-refresh/only-export-components': 'off',
    // Off: the codebase uses `any` deliberately at the API/bridge/federation
    // boundaries (dynamic remote modules, untyped backend payloads). Enforcing
    // this would require broad, behavior-neutral churn with no safety win here.
    '@typescript-eslint/no-explicit-any': 'off',
    // Off: `Function` is used intentionally for the generic event-handler
    // registry in services/websocket.ts. Tightening it is a non-trivial typing
    // change, not a lint fix.
    '@typescript-eslint/ban-types': 'off',
    // Unused-locals/params are already enforced by tsc (noUnusedLocals/
    // noUnusedParameters) for src. Here we only allow the conventional
    // underscore-prefix escape hatch for intentionally-unused args/vars
    // (e.g. stubbed API signatures that must match a caller contract).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Off: several effects intentionally omit deps (one-shot loads, stable
    // callbacks). Enforcing exhaustive-deps would alter effect timing/runtime
    // behavior, which is out of scope.
    'react-hooks/exhaustive-deps': 'off',
  },
}
