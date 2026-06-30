import { defineConfig } from 'tsup';

// Mirrors @fuzefront/billing-client: dual ESM (.js) + CJS (.cjs) + .d.ts so the
// host bundler can resolve named exports statically (avoids the
// __exportStar(require()) named-export failure plain tsc CJS produces).
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
