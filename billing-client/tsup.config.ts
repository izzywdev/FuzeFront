import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts. The ESM output keeps `export *`
// re-exports STATIC so the host bundler (vite/rollup, which bundles billing-ui
// with billing-client external) can resolve named exports. Plain tsc emitted CJS
// __exportStar(require()) → "X is not exported" at host build time (same fix as
// @fuzefront/chat-client).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
