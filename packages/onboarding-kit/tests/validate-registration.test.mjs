import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  effectiveModes,
  validateSurfaces,
  validatePolicyWiring,
  validateSlugConvention,
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

// ---- slug convention ----------------------------------------------------------------
// The owner's rule: a Fuze product registers WITHOUT the prefix — slug `service`, name
// `Service`. Twelve of thirteen products got this wrong; FuzePicker (slug `picker`) shows
// the convention already existed and was simply never enforced.

test('a `fuze`-prefixed slug is REJECTED and the message names the replacement', () => {
  const errors = validateSlugConvention({ slug: 'fuzeservice', name: 'Service' })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /slug "fuzeservice" starts with "fuze"/)
  assert.match(errors[0], /use "service"/)
})

test('the message says the mistake is UNFIXABLE, because that is the whole point', () => {
  // A slug typo is normally a one-line edit. This one costs a register-then-delete
  // migration that orphans Permit grants and CASCADE-deletes installation rows, so the
  // error has to say so — otherwise it reads as pedantry and gets argued with.
  const [error] = validateSlugConvention({ slug: 'fuzeplan' })
  assert.match(error, /immutable/)
})

test('a `Fuze`-prefixed NAME is rejected too — the rule covers both halves', () => {
  const errors = validateSlugConvention({ slug: 'service', name: 'FuzeService' })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /name "FuzeService"/)
  assert.match(errors[0], /use "Service"/)
})

test('slug AND name both prefixed produces BOTH violations, not just the first', () => {
  // The real fuzeservice/FuzeService shape. Reporting one at a time means two build
  // cycles to fix one manifest.
  assert.equal(validateSlugConvention({ slug: 'fuzeservice', name: 'FuzeService' }).length, 2)
})

test('the conformant form passes', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'service', name: 'Service' }), [])
})

test('picker/FuzePicker: the slug is already right, only the name is flagged', () => {
  // Measured current state — FuzePicker registers as `picker`. Exactly one violation.
  const errors = validateSlugConvention({ slug: 'picker', name: 'FuzePicker' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /name "FuzePicker"/)
})

test('fuzecontact/Contact: the name is already right, only the slug is flagged', () => {
  const errors = validateSlugConvention({ slug: 'fuzecontact', name: 'Contact' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /slug "fuzecontact"/)
})

test('a hyphenated prefix (`fuze-market`) is caught too', () => {
  assert.equal(validateSlugConvention({ slug: 'fuze-market' }).length, 1)
})

test('bare `fuze` is rejected — no product de-prefixes to it', () => {
  // De-prefixing "FuzeX" yields "x", so there is no product for which `fuze` is the
  // correct short slug. Allowing it as "not really a prefix" would be a loophole.
  assert.equal(validateSlugConvention({ slug: 'fuze' }).length, 1)
})

test('a slug merely CONTAINING fuze is fine — the rule is anchored to the start', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'defuze', name: 'Defuze' }), [])
})

test('a missing slug/name is not this check\'s problem', () => {
  // Shape is the schema's job. Reporting "slug is absent" here would duplicate the
  // contract and produce two errors for one mistake.
  assert.deepEqual(validateSlugConvention({}), [])
})

test('THE SHIPPED TEMPLATE is itself conformant', () => {
  // templates/ is what every product copies, so a violation there propagates to the
  // whole fleet before anyone notices. It happens to be clean today (`myapp`, not
  // `fuzemyapp`) — this pins that, so the gate can never be undermined by the one
  // manifest it does not otherwise get run against.
  const templates = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
  assert.deepEqual(validateRegistrationDir(templates), [])
})

test('the slug rule is wired into the end-to-end directory check', () => {
  const dir = makeDir({
    'manifest.json': { ...PORTAL_STANDALONE, slug: 'fuzeservice', name: 'FuzeService' },
    'policy.json': { product: 'fuzeservice' },
  })
  const errors = validateRegistrationDir(dir)
  assert.equal(errors.length, 2, errors.join('\n'))
  assert.match(errors.join('\n'), /starts with "fuze"/)
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

test('a slug that de-prefixes below 3 chars keeps the prefix — FuzeBI', () => {
  // `fuzebi` -> `bi` is REJECTED by the contract's Slug pattern (min 3 chars),
  // so there is no conformant slug to move to and the prefix is load-bearing.
  assert.deepEqual(validateSlugConvention({ slug: 'fuzebi', name: 'FuzeBI' }), [])
})

test('the same exemption covers FuzeX', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'fuzex', name: 'FuzeX' }), [])
})

test('the exemption does NOT leak to slugs that de-prefix to 3+ chars', () => {
  const errors = validateSlugConvention({ slug: 'fuzebio', name: 'FuzeBio' })
  assert.equal(errors.length, 2, errors.join('\n'))
  assert.match(errors[0], /use "bio"/)
})

test('a 3-char de-prefixed slug is still held to the convention', () => {
  assert.match(validateSlugConvention({ slug: 'fuzehub' })[0], /use "hub"/)
})
