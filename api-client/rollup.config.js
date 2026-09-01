// Build config for @izzywdev/fuzefront-api-client.
//
// USES @rollup/plugin-typescript, NOT rollup-plugin-typescript2 — and that swap
// is the reason this package could be published at all.
//
// `src/index.ts` does `export * from './types'`, and `src/types/index.ts` is
// TYPE-ONLY (interfaces and unions, zero runtime exports). rollup-plugin-
// typescript2 emits nothing for such a module and then hands rollup an
// unresolved id, so every build died with:
//
//   [!] (plugin rpt2) RollupError: Could not resolve "./types" from "src/index.ts"
//
// The build had therefore NEVER produced a fresh bundle; the `dist/` committed
// to the tree was stale output from before the types module was split out.
// Publishing that would have shipped a tarball whose contents no longer match
// the source — the exact "published but wrong" failure mode that is worse than
// unpublished. @rollup/plugin-typescript (already a devDependency here, and the
// plugin sdk/rollup.config.js uses) emits an empty module for a type-only file,
// which rollup resolves and then tree-shakes away.
//
// `declaration: false` here on purpose: the second pass below generates the
// single rolled-up `dist/index.d.ts` via rollup-plugin-dts. Leaving the
// tsconfig's `declaration: true` on for the JS pass makes the plugin emit
// per-file .d.ts into dist/ as a side effect and warn about the outDir.
const typescript = require('@rollup/plugin-typescript')
const { nodeResolve } = require('@rollup/plugin-node-resolve')
const commonjs = require('@rollup/plugin-commonjs')
const dts = require('rollup-plugin-dts').default
const pkg = require('./package.json')

module.exports = [
  // Build the main bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: 'esm',
        exports: 'named',
        sourcemap: true,
      },
    ],
    plugins: [
      nodeResolve({
        preferBuiltins: false,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
      }),
    ],
    external: ['axios'],
  },
  // Generate TypeScript declarations
  {
    input: 'src/index.ts',
    output: {
      file: pkg.types,
      format: 'esm',
    },
    plugins: [dts()],
  },
]
