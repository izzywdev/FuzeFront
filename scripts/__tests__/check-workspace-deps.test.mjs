/**
 * Tests for the workspace-deps gate's range comparator.
 *
 * The case this file exists for is `0.x caret does not span minors`: the gate was
 * added because account-security-ui / identity-ui / portal-admin-ui declared a peer
 * range of ^0.5.0 / ^0.6.0 / ^0.7.0 on @fuzefront/security-client while the workspace
 * shipped 0.8.0. Under npm's caret rule a 0.x range is pinned to its minor, so all
 * three were unsatisfiable — and a comparator that treated 0.x like 1.x would call
 * every one of them fine and reproduce the exact bug it was written to catch.
 *
 * `unparseable specs return null, never true` is the vacuity guard: this comparator
 * is deliberately partial (no `semver` in CI — see the script header), so the one
 * thing it must never do is report a range it cannot read as satisfied.
 *
 * Run with:  node --test scripts/__tests__/check-workspace-deps.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { satisfies, parseVersion } from '../check-workspace-deps.mjs'

/* ------------------------------------------------------------------ versions */

test('parseVersion: reads x.y.z and tolerates prerelease/build suffixes', () => {
  assert.deepEqual(parseVersion('0.8.0'), [0, 8, 0])
  assert.deepEqual(parseVersion('1.2.3-rc.1'), [1, 2, 3])
  assert.deepEqual(parseVersion('1.2.3+build5'), [1, 2, 3])
})

test('parseVersion: returns null rather than guessing at a non-semver string', () => {
  assert.equal(parseVersion('latest'), null)
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion(''), null)
})

/* -------------------------------------------------------- the defect it catches */

test('0.x caret does not span minors — the security-client drift', () => {
  // The three real violations, measured 2026-08-27 against @fuzefront/security-client 0.8.0.
  assert.equal(satisfies('^0.5.0', '0.8.0'), false)
  assert.equal(satisfies('^0.6.0', '0.8.0'), false)
  assert.equal(satisfies('^0.7.0', '0.8.0'), false)
  // ...and the fix.
  assert.equal(satisfies('^0.8.0', '0.8.0'), true)
  assert.equal(satisfies('^0.8.0', '0.8.4'), true)
  assert.equal(satisfies('^0.8.0', '0.9.0'), false)
})

test('1.x caret spans minors, so the in-repo ^1.0.0 ranges stay green', () => {
  assert.equal(satisfies('^1.0.0', '1.0.0'), true)
  assert.equal(satisfies('^1.0.0', '1.0.1'), true)
  assert.equal(satisfies('^1.1.0', '1.1.0'), true)
  assert.equal(satisfies('^1.0.0', '2.0.0'), false)
  assert.equal(satisfies('^1.2.0', '1.1.9'), false) // below the floor
})

test('0.0.x caret admits only that exact patch', () => {
  assert.equal(satisfies('^0.0.3', '0.0.3'), true)
  assert.equal(satisfies('^0.0.3', '0.0.4'), false)
})

/* ------------------------------------------------------------ other spec forms */

test('exact pins must match exactly', () => {
  assert.equal(satisfies('0.8.0', '0.8.0'), true)
  assert.equal(satisfies('0.8.0', '0.8.1'), false)
  assert.equal(satisfies('1.0.0', '1.0.0'), true)
})

test('tilde admits patches within the minor and nothing beyond', () => {
  assert.equal(satisfies('~1.2.3', '1.2.9'), true)
  assert.equal(satisfies('~1.2.3', '1.2.0'), false) // below the floor
  assert.equal(satisfies('~1.2.3', '1.3.0'), false)
})

test('wildcards admit anything parseable', () => {
  assert.equal(satisfies('*', '0.0.1'), true)
  assert.equal(satisfies('x', '9.9.9'), true)
})

/* ------------------------------------------------------------- vacuity guard */

test('unparseable specs return null, never true', () => {
  // The comparator is partial by design. Anything it cannot read must surface as
  // UNCHECKED in the summary — reporting it as satisfied is the failure mode that
  // would let this gate go quietly vacuous.
  for (const spec of ['>=1.0.0 <2.0.0', '1.x', 'latest', 'npm:other@^1.0.0', '1.0.0 || 2.0.0']) {
    assert.equal(satisfies(spec, '1.5.0'), null, `spec ${spec} must be UNCHECKED, not satisfied`)
  }
})

test('an unparseable local version is never silently satisfied', () => {
  assert.equal(satisfies('^1.0.0', 'latest'), null)
})
