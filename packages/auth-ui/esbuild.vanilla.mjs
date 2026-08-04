#!/usr/bin/env node
// Builds dist/auth-ui.vanilla.js — a zero-dependency IIFE (no React/React-DOM
// in the bundle) exposing `window.FuzeFrontAuthUI.mount(container, opts)`.
// Run after the main `vite build` (see package.json `build` script); also
// copies styles.css into dist so `@fuzeone/auth-ui/styles.css` resolves.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(ROOT, 'src/vanilla/entry.ts')],
  outfile: join(ROOT, 'dist/auth-ui.vanilla.js'),
  bundle: true,
  format: 'iife',
  globalName: 'FuzeFrontAuthUI',
  target: 'es2020',
  minify: true,
  platform: 'browser',
})

mkdirSync(join(ROOT, 'dist'), { recursive: true })
copyFileSync(join(ROOT, 'src/styles.css'), join(ROOT, 'dist/styles.css'))

console.log('[auth-ui] vanilla IIFE + styles.css written to dist/')
