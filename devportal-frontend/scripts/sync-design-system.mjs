#!/usr/bin/env node
// Vendors the publishable subset of @fuzefront/design-system into
// ./vendor-design-system so it can be installed as a `file:` dependency.
//
// Mirrors fuzefront-website/frontend/scripts/sync-design-system.mjs — see
// that file's header for the full rationale (vendored because
// @fuzefront/design-system is a root npm WORKSPACE package that never
// touches a registry, and this app's Docker build runs `npm ci` from an
// ISOLATED context scoped to devportal-frontend/ only, so it cannot see the
// root workspace symlinks). Only the repo-root depth differs:
// devportal-frontend/ sits ONE level below repo root (fuzefront-website/
// frontend/ sits two).
//
// Run this BEFORE `npm ci`/`npm install`. CI runs it as its own step in
// release.yml, immediately before the devportal-frontend Docker build.
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const repoRoot = path.resolve(appRoot, '..')
const source = path.join(repoRoot, 'design-system')
const dest = path.join(appRoot, 'vendor-design-system')

if (!existsSync(source)) {
  console.error(`sync-design-system: source not found at ${source}`)
  process.exit(1)
}

// Matches design-system/package.json's own `files` field — the publishable
// surface, not its tests/harness/guidelines/node_modules.
const FILES_TO_VENDOR = ['components', 'tokens', 'index.js', 'index.d.ts', 'styles.css', '_ds_manifest.json', 'package.json']

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

for (const entry of FILES_TO_VENDOR) {
  const src = path.join(source, entry)
  if (!existsSync(src)) continue
  cpSync(src, path.join(dest, entry), { recursive: true })
}

// scripts/check-workspace-deps.mjs (root CI gate) builds a repo-wide name -> package
// map keyed by each tracked package.json's own `name` field. Renaming the vendored
// copy's name avoids colliding with the REAL design-system's own workspace entry;
// it doesn't affect what devportal-frontend imports it as, since a `file:`
// dependency installs under the KEY used in the consumer's package.json
// ("@fuzefront/design-system": "file:./vendor-design-system").
const pkgJsonPath = path.join(dest, 'package.json')
if (existsSync(pkgJsonPath)) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  pkg.name = '@fuzefront/design-system-vendored'
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

console.log(`sync-design-system: vendored ${FILES_TO_VENDOR.join(', ')} -> ${path.relative(appRoot, dest)}`)
