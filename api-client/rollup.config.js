const typescript = require('rollup-plugin-typescript2')
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
        typescript: require('typescript'),
        rollupCommonJSResolveHack: true,
        clean: true,
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
