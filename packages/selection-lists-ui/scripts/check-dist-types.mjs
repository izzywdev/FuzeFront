#!/usr/bin/env node
/**
 * Published-declarations guard.
 *
 * Every bare specifier that appears in `dist/**\/*.d.ts` (and `.d.mts`/`.d.cts`)
 * is something a consumer's TypeScript must be able to resolve from the INSTALLED
 * package. If it is not listed in `dependencies` or `peerDependencies`, the
 * published types are broken outside this monorepo — it only works here because
 * of the tsconfig `paths` mapping and the `file:` devDependency. Without a
 * resolvable package the public types (e.g. `SharedList`) silently degrade to
 * `any` under `skipLibCheck`, or fail to compile without it.
 *
 * Run after the declaration build (`npm run build` does). Exit 1 lists each
 * offending file + specifier.
 *
 *   node scripts/check-dist-types.mjs [distDir] [packageJson]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DECLARATION = /\.d\.[cm]?ts$/

// `from 'x'`, bare `import 'x'`, `import('x')` and `/// <reference types="x" />`.
const SPECIFIER_PATTERNS = [
  /\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  /\/\/\/\s*<reference\s+types\s*=\s*(['"])([^'"\n]+)\1/g,
]

/** `@scope/name/deep/path` -> `@scope/name`; `name/deep` -> `name`. */
export function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function isBare(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/')
}

function declarationFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...declarationFiles(full))
    else if (DECLARATION.test(entry)) out.push(full)
  }
  return out
}

/**
 * @returns {{ file: string, specifier: string, packageName: string }[]} one entry
 *   per declaration file + package that the manifest does not declare.
 */
export function findUndeclaredTypeReferences(distDir, manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const found = []
  for (const file of declarationFiles(distDir)) {
    const text = readFileSync(file, 'utf8')
    const seen = new Set()
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[2]
        if (!isBare(specifier)) continue
        const packageName = packageNameOf(specifier)
        if (declared.has(packageName) || seen.has(packageName)) continue
        seen.add(packageName)
        found.push({ file, specifier, packageName })
      }
    }
  }
  return found
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const distDir = resolve(process.argv[2] ?? join(root, 'dist'))
  const manifestPath = resolve(process.argv[3] ?? join(root, 'package.json'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const missing = findUndeclaredTypeReferences(distDir, manifest)
  if (missing.length === 0) {
    console.log(`check-dist-types: ${manifest.name} declarations only reference declared packages`)
    return
  }
  console.error(
    `check-dist-types: ${manifest.name} publishes declarations that reference packages it does not declare.\n` +
      `A consumer outside this monorepo cannot resolve them. Add each to "dependencies" or "peerDependencies":\n`,
  )
  for (const { file, specifier, packageName } of missing) {
    console.error(`  ${packageName}  (via '${specifier}' in ${file})`)
  }
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
