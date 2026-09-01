// Build config for @izzywdev/fuzefront-sdk-react.
//
// EXTERNALS ARE DERIVED FROM THE MANIFEST, NOT HAND-LISTED. The hand-list used
// to be `['react', 'react-dom', 'react/jsx-runtime']`, which left
// `socket.io-client` — a declared runtime `dependency` — INLINED into the
// bundle. dist/index.js was 277 kB of mostly vendored socket.io. A consumer
// installing this package got socket.io twice: once bundled, once from the
// declared dependency, with two separate module instances and no way to share
// a connection. Anything a package declares as a dependency or peerDependency
// must be left external; bundling it is a packaging bug, not an optimisation.
//
// `exports: 'named'` on the CJS output is deliberate too. src/index.ts has both
// named exports and a default, and rollup's default `auto` mode warns and picks
// an interop shape that varies with the export set — `require()` semantics
// should not shift because someone added an export.
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// Every declared dependency + peerDependency, and any deep import of one
// (`react/jsx-runtime`, `socket.io-client/debug`, ...), stays external.
const declared = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]
const externals = (id) => declared.some((d) => id === d || id.startsWith(`${d}/`))

export default [
  // Build main bundle
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
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
      }),
    ],
    external: externals,
  },
  // Build type definitions
  {
    input: 'src/index.ts',
    output: {
      file: pkg.types,
      format: 'esm',
    },
    plugins: [dts()],
    external: externals,
  },
]
