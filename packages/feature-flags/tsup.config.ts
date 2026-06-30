import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts for BOTH entries:
//   index -> server surface (default)
//   web   -> browser surface (@fuzefront/feature-flags/web)
// ESM re-exports stay STATIC so host bundlers (vite/rollup) resolve named
// exports correctly (same fix as @fuzefront/billing-client / chat-client).
export default defineConfig({
  entry: ['src/index.ts', 'src/web.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Never bundle the SDKs/providers. The Unleash providers are optional + lazily
  // `import()`-ed inside init(), so they must stay external: the package builds
  // even when a provider isn't installed, and the dynamic import degrades to
  // defaults at runtime if it can't be resolved.
  external: [
    '@openfeature/server-sdk',
    '@openfeature/web-sdk',
    'unleash-openfeature-provider-server',
    '@openfeature/unleash-web-provider',
  ],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
