import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts, plus the component stylesheet
// copied verbatim to dist. react/react-dom, the Stripe SDKs and the
// billing-client are peer deps and stay external so the host shell provides a
// single shared copy (Stripe.js is loaded once; multiple copies break Elements).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@fuzefront/billing-client',
    '@stripe/stripe-js',
    '@stripe/react-stripe-js',
  ],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // The design-system-token-only stylesheet ships alongside the JS so consumers
  // can `import '@fuzefront/billing-ui/styles.css'`.
  loader: { '.css': 'copy' },
  publicDir: false,
  onSuccess: 'node ./scripts/copy-css.mjs',
});
