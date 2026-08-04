import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts for BOTH entries:
//   index -> server surface (default)
//   web   -> browser surface (@fuzeone/feature-flags/web)
// ESM re-exports stay STATIC so host bundlers (vite/rollup) resolve named
// exports correctly (same fix as @fuzeone/billing-client / chat-client).
export default defineConfig({
  entry: ['src/index.ts', 'src/web.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Never bundle the SDKs/providers. `unleash-client` is lazily `import()`-ed
  // inside the provider's initialize() and the web provider inside web init(),
  // so they stay external: the package builds even when they are not installed,
  // and an unresolvable import degrades to caller-supplied defaults at runtime.
  //
  // NOTE: this list previously externalized `unleash-openfeature-provider-server`
  // — a package that does not exist on npm. It has been replaced by the real,
  // Unleash-maintained `unleash-client` that the in-repo provider wraps.
  external: [
    '@openfeature/server-sdk',
    '@openfeature/web-sdk',
    'unleash-client',
    '@openfeature/unleash-web-provider',
  ],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
