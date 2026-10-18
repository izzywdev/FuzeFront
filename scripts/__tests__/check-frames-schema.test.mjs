// Unit tests for gate-frames-schema's pure logic (scripts/check-frames-schema.mjs).
// The point of these, per CLAUDE.md: a gate never shown to FAIL on the thing it
// was written for is not evidence of anything. So we assert both directions —
// a conforming manifest passes, and each defect the gate exists to catch fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSchema, flowMobileCoverage, mobileReport, missingManifestFeatures } from '../check-frames-schema.mjs'

const baseManifest = () => ({
  name: 'x', description: 'd', designSystem: 'fuse-seam', entry: 'index.html',
  frames: [{ id: '01', file: '01.html', label: 'L', summary: 'S', testHooks: ['[data-x]'], viewport: 'mobile', flow: 'f1' }],
  build: { flows: [{ id: 'f1', orchestrator: 'O', route: '/x' }], components: [], packages: [] },
})

test('a conforming manifest has no schema errors', () => {
  assert.equal(validateSchema('good', baseManifest()).length, 0)
})

test('missing required top-level keys are caught', () => {
  const errs = validateSchema('bad', { frames: [] })
  assert.ok(errs.some(e => e.includes('name')))
  assert.ok(errs.some(e => e.includes('description')))
  assert.ok(errs.some(e => e.includes('frames')))
})

test('a frame missing testHooks/label/summary is caught', () => {
  const m = baseManifest()
  m.frames = [{ id: '01', file: '01.html' }]
  const errs = validateSchema('bad', m)
  assert.ok(errs.some(e => e.includes('label')))
  assert.ok(errs.some(e => e.includes('summary')))
  assert.ok(errs.some(e => e.includes('testHooks')))
})

test('entry/file must end in .html', () => {
  const m = baseManifest(); m.entry = 'index'; m.frames[0].file = '01'
  const errs = validateSchema('bad', m)
  assert.ok(errs.some(e => e.includes('entry')))
  assert.ok(errs.some(e => e.includes('.html')))
})

test('an empty optional array (packages/components) is valid — schema sets no minItems', () => {
  const m = baseManifest(); m.build.packages = []; m.build.components = []
  assert.equal(validateSchema('ok', m).length, 0)
})

test('both @fuzefront and @fuzeone package scopes are accepted; others rejected', () => {
  const ok = baseManifest(); ok.build.packages = ['@fuzefront/a-ui', '@fuzeone/selection-list-client']
  assert.equal(validateSchema('ok', ok).filter(e => e.includes('packages')).length, 0)
  const bad = baseManifest(); bad.build.packages = ['lodash']
  assert.ok(validateSchema('bad', bad).some(e => e.includes('packages')))
})

test('a flow missing id/orchestrator/route is caught', () => {
  const m = baseManifest(); m.build.flows = [{}]
  const errs = validateSchema('bad', m)
  assert.ok(errs.some(e => e.includes('id')))
  assert.ok(errs.some(e => e.includes('orchestrator')))
  assert.ok(errs.some(e => e.includes('route')))
})

test('responsive.exempt requires exemptReason', () => {
  const m = baseManifest(); m.build.flows[0].responsive = { exempt: true }
  assert.ok(validateSchema('bad', m).some(e => e.includes('exemptReason')))
})

// ---- mobile coverage (the block-now rule) ----

test('a flow with a mobile frame is covered', () => {
  const m = baseManifest()
  assert.equal(flowMobileCoverage(m.build.flows[0], m.frames).covered, true)
})

test('a desktop-only flow is NOT covered — this is the defect the gate exists for', () => {
  const m = baseManifest(); m.frames[0].viewport = 'desktop'
  assert.equal(flowMobileCoverage(m.build.flows[0], m.frames).covered, false)
})

test('coveredViewports listing mobile counts as covered', () => {
  const m = baseManifest(); m.frames[0].viewport = 'desktop'
  m.build.flows[0].responsive = { coveredViewports: ['mobile', 'desktop'] }
  assert.equal(flowMobileCoverage(m.build.flows[0], m.frames).covered, true)
})

test('responsive.exempt with a reason is covered', () => {
  const m = baseManifest(); m.frames[0].viewport = 'desktop'
  m.build.flows[0].responsive = { exempt: true, exemptReason: 'desktop-only admin console' }
  assert.equal(flowMobileCoverage(m.build.flows[0], m.frames).covered, true)
})

test('responsive.mobileFrame pointing at a desktop frame is NOT covered, with a reason', () => {
  const m = baseManifest(); m.frames[0].viewport = 'desktop'
  m.build.flows[0].responsive = { mobileFrame: '01' }
  const r = flowMobileCoverage(m.build.flows[0], m.frames)
  assert.equal(r.covered, false)
  assert.match(r.reason, /not mobile\/responsive/)
})

// ---- robustness holes Codex found on the gate itself ----

test('an array where an object is required is rejected (build: [])', () => {
  const m = baseManifest(); m.build = []
  assert.ok(validateSchema('bad', m).some(e => e.includes('build')))
})

test('contract/implementation/responsive as arrays are rejected', () => {
  const m1 = baseManifest(); m1.contract = []
  assert.ok(validateSchema('b', m1).some(e => e.includes('contract')))
  const m2 = baseManifest(); m2.implementation = []
  assert.ok(validateSchema('b', m2).some(e => e.includes('implementation')))
  const m3 = baseManifest(); m3.build.flows[0].responsive = []
  assert.ok(validateSchema('b', m3).some(e => e.includes('responsive')))
})

test('a mobileFrame belonging to another flow does NOT cover this flow', () => {
  const m = baseManifest()
  m.frames = [{ id: '02', file: '02.html', label: 'L', summary: 'S', testHooks: ['[x]'], viewport: 'mobile', flow: 'other-flow' }]
  m.build.flows = [{ id: 'f1', orchestrator: 'O', route: '/x', responsive: { mobileFrame: '02' } }]
  const r = flowMobileCoverage(m.build.flows[0], m.frames)
  assert.equal(r.covered, false)
  assert.match(r.reason, /belongs to flow/)
})

test('missingManifestFeatures flags a changed feature dir with frames but no manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'frames-'))
  mkdirSync(join(root, 'has-manifest'))
  writeFileSync(join(root, 'has-manifest', 'manifest.json'), '{}')
  mkdirSync(join(root, 'no-manifest'))
  writeFileSync(join(root, 'no-manifest', '01.html'), '<html></html>')
  // "deleted" is a changed feature whose directory does not exist — legitimate removal.
  const changed = new Set(['has-manifest', 'no-manifest', 'deleted'])
  assert.deepEqual(missingManifestFeatures(changed, root), ['no-manifest'])
  // No changed set (report/all mode) → nothing flagged.
  assert.deepEqual(missingManifestFeatures(null, root), [])
})

test('mobileReport skips features with no flows and reports uncovered flows', () => {
  const noFlows = { feature: 'a', manifest: { frames: [] } }
  const desktopOnly = { feature: 'b', manifest: baseManifest() }
  desktopOnly.manifest.frames[0].viewport = 'desktop'
  const rep = mobileReport([noFlows, desktopOnly])
  assert.equal(rep.length, 1)
  assert.equal(rep[0].feature, 'b')
  assert.equal(rep[0].uncoveredFlows.length, 1)
})
