import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts. The ESM output keeps the barrel
// `export * from './client'` re-exports STATIC so bundlers (vite/rollup in the
// host frontend + chat-ui) can resolve named exports like `ChatServiceClient`.
// Plain `tsc` emitted CJS `__exportStar(require(...))`, which rollup cannot
// statically analyse → "X is not exported" at host build time. deps stay
// external (declared in package.json) so they're installed, not bundled.
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
