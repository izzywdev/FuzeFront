import { defineConfig } from 'tsup'

/**
 * Dual CJS + ESM output with declarations, mirroring `billing-client/`.
 *
 * Both formats ship because the consumers differ: the Vite/React 19 shell and
 * the UI packages are ESM, while the Node service tests are still CommonJS.
 * Publishing only one would force one of them into an interop shim.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  },
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Zero runtime dependencies: nothing to externalise, nothing to bundle in.
  external: [],
})
