/* ESLint config for the FuzeFront backend (Node + TypeScript, CommonJS).
   ESLint 8 classic config to match the pinned toolchain. */
module.exports = {
  root: true,
  env: { node: true, es2021: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.eslintrc.cjs', 'scripts'],
  rules: {
    // Pragmatic for a service codebase with dynamic payloads / 3rd-party SDKs.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
    'no-undef': 'off', // TS handles this; avoids false positives on Node globals
    // Service code intentionally uses dynamic require() (lazy/optional deps)
    // and namespace augmentation (e.g. Express.Request) — allow both.
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-namespace': 'off',
  },
}
