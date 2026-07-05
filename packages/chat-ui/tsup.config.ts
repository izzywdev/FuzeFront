import { defineConfig } from 'tsup';

// Dual build: ESM (.js) + CJS (.cjs) + .d.ts, plus the component stylesheet
// copied verbatim to dist. React/react-dom and the chat-client are peer deps and
// must stay external so the host shell provides a single shared copy.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', '@fuzefront/chat-client'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // The design-system-token-only stylesheet ships alongside the JS so consumers
  // can `import '@fuzefront/chat-ui/styles.css'`.
  loader: { '.css': 'copy' },
  publicDir: false,
  onSuccess: 'node ./scripts/copy-css.mjs',
});
