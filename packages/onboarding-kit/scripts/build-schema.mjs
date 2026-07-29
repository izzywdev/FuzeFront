#!/usr/bin/env node
// Derives manifest.schema.json from the FROZEN contract
// (services/app-registry-service/openapi.yaml).
//
// Hand-maintaining a second copy of AppManifest guarantees drift: the copy that
// consumers validate against would slowly stop matching the copy the server
// enforces, and the failure shows up at deploy time in someone else's repo. So the
// schema is GENERATED, committed, and re-checked in CI (`--check`).
//
// Usage: node scripts/build-schema.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const YAML = require('js-yaml')

const here = dirname(fileURLToPath(import.meta.url))
const kit = dirname(here)
const repoRoot = join(kit, '..', '..')
const OPENAPI = join(repoRoot, 'services', 'app-registry-service', 'openapi.yaml')
const OUT = join(kit, 'manifest.schema.json')

const doc = YAML.load(readFileSync(OPENAPI, 'utf8'))
const schemas = doc.components.schemas

// Everything AppManifest transitively references. Listed explicitly rather than
// crawled so an unexpected new $ref is a loud failure, not a silent omission.
const NEEDED = [
  'AppManifest',
  'Slug',
  'AppMode',
  'IntegrationType',
  'Visibility',
  'Icon',
  'Integration',
  'MenuItem',
  'Chrome',
  'Nav',
  'NavSection',
  'Suite',
  'Auth',
  'AuthOidc',
  'Routing',
  'Infra',
]

const defs = {}
for (const name of NEEDED) {
  if (!schemas[name]) {
    console.error(`build-schema: ${name} missing from ${OPENAPI} — contract changed?`)
    process.exit(1)
  }
  defs[name] = schemas[name]
}

// Rewrite OpenAPI-style refs to JSON-Schema $defs refs.
const retarget = node => {
  if (Array.isArray(node)) return node.map(retarget)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        out.$ref = v.replace('#/components/schemas/', '#/$defs/')
      } else {
        out[k] = retarget(v)
      }
    }
    return out
  }
  return node
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/izzywdev/FuzeFront/packages/onboarding-kit/manifest.schema.json',
  title: 'FuzeFront AppManifest',
  description:
    'GENERATED from services/app-registry-service/openapi.yaml by scripts/build-schema.mjs. Do not edit by hand.',
  ...retarget(defs.AppManifest),
  $defs: retarget(defs),
}

// The NEEDED list above is explicit so that a new $ref is a LOUD failure rather
// than a silent omission — but nothing was actually checking that, so adding
// Nav.suite emitted a schema with a dangling `#/$defs/Suite` that every consumer
// would fail to compile at *their* validate step, not ours. Close the loop: walk
// what we emitted and assert every internal ref resolves.
const collectRefs = (node, acc = new Set()) => {
  if (Array.isArray(node)) node.forEach(n => collectRefs(n, acc))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/')) {
        acc.add(v.slice('#/$defs/'.length))
      } else collectRefs(v, acc)
    }
  }
  return acc
}

const dangling = [...collectRefs(schema)].filter(name => !schema.$defs[name]).sort()
if (dangling.length) {
  console.error(
    `build-schema: ${OPENAPI} references ${dangling.join(', ')}, which ${
      dangling.length === 1 ? 'is' : 'are'
    } not in NEEDED.\n` +
      'Add it there so the generated schema is self-contained.'
  )
  process.exit(1)
}

const json = `${JSON.stringify(schema, null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = (() => {
    try {
      return readFileSync(OUT, 'utf8')
    } catch {
      return null
    }
  })()
  if (current !== json) {
    console.error(
      'manifest.schema.json is STALE relative to the contract.\n' +
        'Run: node packages/onboarding-kit/scripts/build-schema.mjs'
    )
    process.exit(1)
  }
  console.log('manifest.schema.json is up to date with the contract.')
} else {
  writeFileSync(OUT, json)
  console.log(`wrote ${OUT}`)
}
