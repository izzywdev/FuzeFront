#!/usr/bin/env node
// Vendors the publishable subset of @fuzefront/design-system into
// ./vendor-design-system so it can be installed as a `file:` dependency.
//
// Why vendored instead of a normal registry dependency: @fuzefront/design-system
// is an npm WORKSPACE package (root package.json `workspaces`), resolved via
// local symlinks when installed from the repo root — it has never been
// published to any registry (see the repo-root .npmrc: "@fuzefront/* names
// are npm WORKSPACES ... they never touch a registry"). fuzefront-website's
// Docker build runs `npm ci` from an ISOLATED context scoped to
// fuzefront-website/frontend/ only (release.yml: "no root workspace deps"),
// so it cannot see the root workspace symlinks. A `file:./vendor-design-system`
// dependency keeps the real design-system source as the single source of
// truth while staying resolvable inside that isolated build context.
//
// Run this BEFORE `npm ci`/`npm install` (it is not an npm lifecycle hook of
// this package, since the copy must exist before npm attempts to resolve the
// `file:` dependency). CI runs it as its own step in release.yml, immediately
// before the fuzefront-website frontend Docker build.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')
const repoRoot = path.resolve(frontendRoot, '..', '..')
const source = path.join(repoRoot, 'design-system')
const dest = path.join(frontendRoot, 'vendor-design-system')

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

console.log(`sync-design-system: vendored ${FILES_TO_VENDOR.join(', ')} -> ${path.relative(frontendRoot, dest)}`)
