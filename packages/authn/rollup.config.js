import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// `jose` is a peer-ish runtime dep; keep it external so the consumer shares a
// single copy and we don't bundle crypto into our artifact.
const external = ['jose']

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true },
      { file: pkg.module, format: 'esm', sourcemap: true },
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
    external,
  },
  {
    input: 'src/index.ts',
    output: { file: pkg.types, format: 'esm' },
    plugins: [dts()],
    external,
  },
]
