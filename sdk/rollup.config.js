import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

export default [
  // Build main bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: 'esm',
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
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  // Build type definitions
  {
    input: 'src/index.ts',
    output: {
      file: pkg.types,
      format: 'esm',
    },
    plugins: [dts()],
    external: ['react', 'react-dom'],
  },
]
