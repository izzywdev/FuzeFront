import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import json from '@rollup/plugin-json'
import dts from 'rollup-plugin-dts'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// Treat React, i18next and react-i18next as external so consumers share singletons.
const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'i18next',
  'react-i18next',
]

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
      json(),
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
    plugins: [json(), dts()],
    external,
  },
]
