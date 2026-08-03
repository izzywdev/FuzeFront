import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  effectiveModes,
  validateSurfaces,
  validatePolicyWiring,
  validateRegistrationDir,
} from '../bin/validate-registration.mjs'

const PORTAL_STANDALONE = {
  mode: 'portal',
  modes: ['portal', 'standalone'],
  routing: { path: '/app/x', host: 'x.fuzefront.com' },
}

/** Build a registration/ dir on disk. `files` maps filename -> string|object. */
function makeDir(files) {
  const dir = join(mkdtempSync(join(tmpdir(), 'reg-')), 'registration')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return dir
}

test('effectiveModes falls back to [mode] when modes is ABSENT', () => {
  // This is the crux: an absent `modes` is LEGAL per the contract. The gate exists
  // because that legality hides a permanent capability gap, not because it is invalid.
  assert.deepEqual(effectiveModes({ mode: 'portal' }), ['portal'])
})

test('effectiveModes prefers modes when present', () => {
  assert.deepEqual(effectiveModes({ mode: 'portal', modes: ['portal', 'standalone'] }), [
    'portal',
    'standalone',
  ])
})

test('effectiveModes treats an empty modes array as a fallback, not as no surfaces', () => {
  assert.deepEqual(effectiveModes({ mode: 'standalone', modes: [] }), ['standalone'])
})

test('portal-only manifest is REJECTED — the real FuzeHub/FuzeContact shape', () => {
  // Exactly ONE violation: `portal` is present, so only the missing `standalone` is
  // reported. The routing.host check deliberately does not fire here — it is scoped to
  // manifests that DO declare standalone, so a portal-only product gets one clear
  // reason rather than a second, confusing complaint about a host it never needed.
  const errors = validateSurfaces({ mode: 'portal', routing: { path: '/app/fuzehub' } })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /does not include "standalone"/)
  assert.match(errors[0], /never ship a mobile app/)
})

test('portal + standalone with a host is accepted', () => {
  assert.deepEqual(validateSurfaces(PORTAL_STANDALONE), [])
})

test('standalone WITHOUT routing.host is rejected', () => {
  const errors = validateSurfaces({
    mode: 'portal',
    modes: ['portal', 'standalone'],
    routing: { path: '/app/x' },
  })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /routing\.host/)
})

test('standalone with a blank routing.host is rejected', () => {
  const errors = validateSurfaces({
    mode: 'portal',
    modes: ['portal', 'standalone'],
    routing: { path: '/app/x', host: '   ' },
  })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /missing or empty/)
})

test('embed-only product is EXEMPT — it is not a portal destination', () => {
  assert.deepEqual(validateSurfaces({ mode: 'embed', modes: ['embed'] }), [])
})

test('embed alongside portal is NOT exempt — it is still a portal destination', () => {
  const errors = validateSurfaces({ mode: 'portal', modes: ['portal', 'embed'] })
  assert.match(errors.join('\n'), /does not include "standalone"/)
})

test('a manifest with no mode and no modes is rejected outright', () => {
  const errors = validateSurfaces({})
  assert.equal(errors.length, 1)
  assert.match(errors[0], /neither/)
})

test('missing policy.json is reported', () => {
  const dir = makeDir({ 'manifest.json': PORTAL_STANDALONE })
  const errors = validatePolicyWiring(dir)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /policy\.json is missing/)
})

test('a vendored pre-kit register.sh with no policy step is reported', () => {
  const dir = makeDir({
    'manifest.json': PORTAL_STANDALONE,
    'policy.json': { product: 'x' },
    'register.sh': '#!/bin/sh\ncurl -X POST "$API/apps" -d @manifest.json\n',
  })
  const errors = validatePolicyWiring(dir)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /no policy submission step/)
})

test('a register.sh that only MENTIONS policy in a comment does not pass', () => {
  const dir = makeDir({
    'manifest.json': PORTAL_STANDALONE,
    'policy.json': { product: 'x' },
    'register.sh': '#!/bin/sh\n# TODO: submit the authz policy one day\ncurl "$API/apps"\n',
  })
  assert.match(validatePolicyWiring(dir).join('\n'), /no policy submission step/)
})

test('a kit register.sh that submits the policy passes', () => {
  const dir = makeDir({
    'manifest.json': PORTAL_STANDALONE,
    'policy.json': { product: 'x' },
    'register.sh': '#!/bin/sh\nhttp PUT "${API}/apps/${SLUG}/policy" "$BODY" "$POLICY"\n',
  })
  assert.deepEqual(validatePolicyWiring(dir), [])
})

test('no register.sh at all is fine — consuming the kit from npm is preferred', () => {
  const dir = makeDir({ 'manifest.json': PORTAL_STANDALONE, 'policy.json': { product: 'x' } })
  assert.deepEqual(validatePolicyWiring(dir), [])
})

test('a fully conformant registration dir passes end to end', () => {
  const dir = makeDir({
    'manifest.json': PORTAL_STANDALONE,
    'policy.json': { product: 'x' },
    'register.sh': 'http PUT "${API}/apps/${SLUG}/policy" "$BODY" "$POLICY"\n',
  })
  assert.deepEqual(validateRegistrationDir(dir), [])
})

test('a missing manifest.json is reported, not thrown', () => {
  const dir = makeDir({})
  const errors = validateRegistrationDir(dir)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /not found/)
})

test('malformed manifest JSON is reported, not thrown', () => {
  const dir = makeDir({ 'manifest.json': '{ not json' })
  const errors = validateRegistrationDir(dir)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /not valid JSON/)
})
