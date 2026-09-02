/**
 * Tests for the deployable-paths gate (release.yml `on.push.paths` vs
 * deploy/deployable-paths.json).
 *
 * The load-bearing cases are the DRIFT ones. A gate that has only ever been seen to
 * pass proves nothing: the whole reason this mirror rotted five times is that its
 * failure mode is silent (a missing path means the release workflow does not run at
 * all — no red run, no run). So this suite feeds the checker deliberately mismatched
 * blocks and asserts it notices, including:
 *   - a path dropped from the workflow but declared in the manifest (the real bug),
 *   - a build step whose source dir nothing covers (the #432 chat-service bug, which a
 *     pure round-trip comparison CANNOT see, since manifest and workflow agree),
 *   - the vacuous-pass shapes: no `on:`, no `push:`, no `paths:`, empty `paths:`.
 *
 * It also pins the round-trip against the REAL repo files, so a generator bug is
 * distinguishable from real drift.
 *
 * Run with:  node --test scripts/__tests__/deployable-paths.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  readManifest,
  renderPathsBlock,
  extractPathsBlock,
  globCovers,
  uncoveredBuildInputs,
  MANIFEST_PATH,
  WORKFLOW_PATH,
} from '../deployable-paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const realManifest = readManifest(readFileSync(resolve(root, MANIFEST_PATH), 'utf8'))
const realWorkflow = readFileSync(resolve(root, WORKFLOW_PATH), 'utf8')

/** A minimal workflow with the same shape as release.yml. */
const wf = (pathsBlock, extra = '') => `name: Release

on:
  workflow_dispatch:
  push:
    branches: [master]
    paths:
${pathsBlock}

jobs:
  build-and-bump:
    runs-on: ubuntu-latest
    steps:
      - name: Build & push backend
        uses: docker/build-push-action@v7
        with:
          context: .
          file: backend/Dockerfile
${extra}`

const BLOCK = ["      - 'backend/**'", "      # why sms", "      - 'services/sms-service/**'"].join('\n')

const MANIFEST = {
  paths: [{ path: 'backend/**' }, { path: 'services/sms-service/**', why: ['why sms'] }],
}

test('round-trips the REAL repo files (generator fidelity, not just self-consistency)', () => {
  const rendered = renderPathsBlock(realManifest)
  const found = extractPathsBlock(realWorkflow)
  assert.equal(
    rendered,
    found.text,
    'the committed release.yml block is not what the manifest renders — run ' +
      '`npm run deployable-paths:write`'
  )
  assert.ok(found.paths.length > 0)
})

test('every Dockerfile the real release.yml builds is covered by the real manifest', () => {
  assert.deepEqual(uncoveredBuildInputs(realWorkflow, realManifest), [])
})

test('renders comments above their entry, blank `why` lines as bare #', () => {
  assert.equal(
    renderPathsBlock({ paths: [{ path: 'a/**', why: ['one', '', 'two'] }] }),
    ['      # one', '      #', '      # two', "      - 'a/**'"].join('\n')
  )
})

test('header renders inside the compared block', () => {
  const out = renderPathsBlock({ header: ['GENERATED'], paths: [{ path: 'a/**' }] })
  assert.equal(out, ['      # GENERATED', "      - 'a/**'"].join('\n'))
})

test('extracts the block and its paths', () => {
  const found = extractPathsBlock(wf(BLOCK))
  assert.deepEqual(found.paths, ['backend/**', 'services/sms-service/**'])
  assert.equal(found.text, BLOCK)
})

// --- DRIFT: the cases the gate exists for -----------------------------------------

test('DRIFT: a path dropped from the workflow is detected and nameable', () => {
  const drifted = extractPathsBlock(wf("      - 'backend/**'"))
  assert.notEqual(renderPathsBlock(MANIFEST), drifted.text)
  const missing = MANIFEST.paths.map((p) => p.path).filter((p) => !drifted.paths.includes(p))
  assert.deepEqual(missing, ['services/sms-service/**'])
})

test('DRIFT: a path added to the workflow but not declared is detected', () => {
  const drifted = extractPathsBlock(wf([BLOCK, "      - 'services/ghost/**'"].join('\n')))
  const extra = drifted.paths.filter((p) => !MANIFEST.paths.some((e) => e.path === p))
  assert.deepEqual(extra, ['services/ghost/**'])
})

test('DRIFT: same path set, changed comment text still fails the byte comparison', () => {
  const drifted = extractPathsBlock(wf(BLOCK.replace('# why sms', '# edited by hand')))
  assert.deepEqual(drifted.paths, MANIFEST.paths.map((p) => p.path))
  assert.notEqual(renderPathsBlock(MANIFEST), drifted.text)
})

test('DRIFT: reordering the paths fails the byte comparison', () => {
  const reordered = ["      - 'services/sms-service/**'", '      # why sms', "      - 'backend/**'"].join('\n')
  assert.notEqual(renderPathsBlock(MANIFEST), extractPathsBlock(wf(reordered)).text)
})

test('DRIFT: a build step whose source dir nothing covers (#432 chat-service)', () => {
  // Manifest and workflow AGREE here — the round-trip comparison is green. Only the
  // build-input coverage check can see this one.
  const source = wf(
    BLOCK,
    `      - name: Build & push chat-service
        uses: docker/build-push-action@v7
        with:
          context: .
          file: services/chat-service/Dockerfile
`
  )
  assert.equal(renderPathsBlock(MANIFEST), extractPathsBlock(source).text)
  assert.deepEqual(uncoveredBuildInputs(source, MANIFEST), [
    { dockerfile: 'services/chat-service/Dockerfile', dir: 'services/chat-service/' },
  ])
})

// --- VACUOUS PASSES: the shapes that must throw, not silently return nothing --------

test('throws when there is no top-level `on:` (the YAML-1.1 `on`->true trap)', () => {
  assert.throws(() => extractPathsBlock('name: Release\njobs: {}\n'), /exactly one top-level/)
})

test('throws when `on.push` is missing', () => {
  assert.throws(
    () => extractPathsBlock('name: R\n\non:\n  workflow_dispatch:\n\njobs: {}\n'),
    /no `push:` trigger/
  )
})

test('throws when `on.push.paths` is missing', () => {
  assert.throws(
    () => extractPathsBlock('name: R\n\non:\n  push:\n    branches: [master]\n\njobs: {}\n'),
    /has no `paths:` key/
  )
})

test('throws — loudly — when the paths list is EMPTY rather than passing vacuously', () => {
  assert.throws(
    () => extractPathsBlock('name: R\n\non:\n  push:\n    branches: [master]\n    paths:\n\njobs: {}\n'),
    /NO deployable paths/
  )
})

test('throws on an unrecognised line inside the block instead of skipping it', () => {
  assert.throws(() => extractPathsBlock(wf('      - "double quoted/**"')), /unrecognised line/)
})

test('throws when the workflow builds no images (detection silently broken)', () => {
  assert.throws(
    () => uncoveredBuildInputs('name: R\n\non:\n  push:\n', MANIFEST),
    /found no `file: …Dockerfile` build steps/
  )
})

// --- manifest validation ------------------------------------------------------------

test('rejects an empty manifest rather than emptying the trigger', () => {
  assert.throws(() => readManifest('{"paths":[]}'), /declares no `paths`/)
})

test('rejects duplicate and malformed entries', () => {
  assert.throws(() => readManifest('{"paths":[{"path":"a/**"},{"path":"a/**"}]}'), /duplicate path/)
  assert.throws(() => readManifest('{"paths":[{}]}'), /non-empty string/)
  assert.throws(() => readManifest('{"paths":[{"path":"a/**","why":"nope"}]}'), /array of comment lines/)
})

test('globCovers: `dir/**` covers files beneath it, exact paths match exactly', () => {
  assert.equal(globCovers('backend/**', 'backend/Dockerfile'), true)
  assert.equal(globCovers('backend/**', 'backend/security/Dockerfile'), true)
  assert.equal(globCovers('services/chat-service/**', 'services/chat-ui/Dockerfile'), false)
  assert.equal(globCovers('.github/workflows/release.yml', '.github/workflows/release.yml'), true)
  assert.equal(globCovers('.github/workflows/release.yml', '.github/workflows/ci.yml'), false)
})

test('EOL-agnostic: a CRLF checkout is not reported as drift', () => {
  assert.equal(extractPathsBlock(wf(BLOCK).replace(/\n/g, '\r\n')).text, BLOCK)
})
