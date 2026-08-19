import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  effectiveModes,
  validateSurfaces,
  validatePolicyWiring,
  validateSlugConvention,
  validateNavPlacement,
  validateRegistrationDir,
} from '../bin/validate-registration.mjs'

// The shape of a manifest that is conformant on every axis EXCEPT whatever the test
// using it is probing. `nav` is part of that baseline: an absent `nav` is itself a
// violation now (the product sorts last in the menu by accident rather than by
// decision), so a fixture without one is no longer a neutral starting point — it
// would add an unrelated error to every end-to-end assertion.
const PORTAL_STANDALONE = {
  mode: 'portal',
  modes: ['portal', 'standalone'],
  nav: { section: 'build', order: 10 },
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

// ---- naming convention -------------------------------------------------------------
// CORRECTED 2026-08-19 by owner ruling. The prefix comes off the DISPLAY STRING, not the
// slug: `slug: "fuzeservice"`, `name: "Service"`. These tests previously asserted the
// exact opposite and passed, which is the point worth remembering — a green suite proves
// the code matches the tests, never that either matches the intent.

test('a `Fuze`-prefixed NAME is rejected, and the message names the replacement', () => {
  const errors = validateSlugConvention({ slug: 'fuzeservice', name: 'FuzeService' })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /name "FuzeService"/)
  assert.match(errors[0], /use "Service"/)
})

test('menuLabel is checked too — FuzeBI is the live half-fix this catches', () => {
  // Measured on FuzeBI's default branch: menuLabel "BI" (already right) with name
  // "FuzeBI" (not). Checking only one display field would call that conformant.
  const errors = validateSlugConvention({ slug: 'fuzebi', name: 'FuzeBI', menuLabel: 'BI' })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /name "FuzeBI"/)
})

test('both display fields prefixed produces BOTH violations, not just the first', () => {
  // FuzeX's measured shape. Reporting one at a time costs two build cycles for one file.
  const errors = validateSlugConvention({ slug: 'fuzex', name: 'FuzeX', menuLabel: 'FuzeX' })
  assert.equal(errors.length, 2, errors.join('\n'))
  assert.match(errors.join('\n'), /name "FuzeX"/)
  assert.match(errors.join('\n'), /menuLabel "FuzeX"/)
})

// ---- the slug is NOT checked, in either direction -----------------------------------
// This is the load-bearing half of the correction. `slug` is immutable, so the only way
// to "fix" one is to register a second app and delete the first, which orphans Permit
// grants and CASCADE-deletes app_installations rows. A red build over a value nobody can
// safely change does not prevent the mistake, it pressures someone into the migration.

test('a PREFIXED slug is accepted — this is the convention for new products', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'fuzeservice', name: 'Service' }), [])
})

test('a DE-PREFIXED slug is accepted too — seven live products have one', () => {
  // deploy, call, executive, finance, keys, market, picker. All registered, all
  // immutable. Flagging them would red seven repos with no safe remedy.
  for (const slug of ['deploy', 'call', 'executive', 'finance', 'keys', 'market', 'picker']) {
    assert.deepEqual(validateSlugConvention({ slug }), [], slug)
  }
})

test('bare `fuze` as a slug is NOT this gate\'s problem either', () => {
  // It is a bad slug, but it is an immutable one. Shape belongs to the contract.
  assert.deepEqual(validateSlugConvention({ slug: 'fuze' }), [])
})

test('the conformant form passes', () => {
  assert.deepEqual(
    validateSlugConvention({ slug: 'fuzeservice', name: 'Service', menuLabel: 'Service' }),
    []
  )
})

test('a name merely CONTAINING fuze is fine — the rule is anchored to the start', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'defuze', name: 'Defuze' }), [])
})

test('a missing slug/name is not this check\'s problem', () => {
  // Shape is the schema's job. Reporting "name is absent" here would duplicate the
  // contract and produce two errors for one mistake.
  assert.deepEqual(validateSlugConvention({}), [])
})

test('THE SHIPPED TEMPLATE is itself conformant', () => {
  // templates/ is what every product copies, so a violation there propagates to the
  // whole fleet before anyone notices.
  const templates = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
  assert.deepEqual(validateRegistrationDir(templates), [])
})

test('the naming rule is wired into the end-to-end directory check', () => {
  const dir = makeDir({
    'manifest.json': { ...PORTAL_STANDALONE, slug: 'fuzeservice', name: 'FuzeService' },
    'policy.json': { product: 'fuzeservice' },
  })
  const errors = validateRegistrationDir(dir)
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors.join('\n'), /name "FuzeService"/)
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

// The SHORT-NAME EXEMPTION that used to live here is GONE, and its absence is the
// correction. It existed because the contract's Slug pattern needs 3+ characters, so
// `fuzebi` -> `bi` and `fuzex` -> `x` had no conformant slug to move to and the prefix
// was load-bearing. With the slug no longer checked at all, there is nothing to exempt.
//
// It does not transfer to the display fields either: `name` and `menuLabel` are free
// text with no length floor, so "BI" and "X" are perfectly good labels. The two repos
// the exemption was written for are exactly the two the display rule now catches.

test('the retired short-name exemption does NOT protect a prefixed display name', () => {
  // `fuzebi`/`fuzex` were the exemption's whole reason to exist. Both are flagged now —
  // on the name, which is mutable, not the slug, which is not.
  assert.match(validateSlugConvention({ slug: 'fuzebi', name: 'FuzeBI' })[0], /use "BI"/)
  assert.match(validateSlugConvention({ slug: 'fuzex', name: 'FuzeX' })[0], /use "X"/)
})

test('their slugs stay accepted — the exemption is retired, not inverted', () => {
  assert.deepEqual(validateSlugConvention({ slug: 'fuzebi', name: 'BI' }), [])
  assert.deepEqual(validateSlugConvention({ slug: 'fuzex', name: 'X' }), [])
})

// ---- nav placement ------------------------------------------------------------------
// The regression these guard is FuzeFinance shipping `nav.section: "business"`. It read
// as a perfectly sensible section name, passed every check this kit had, and would have
// been rejected by the platform with a 400 that register.sh treats as fatal — so the
// product's own pod CrashLoopBackOffs in production and the failure looks like the
// product's, not the manifest's.

test('an unknown nav.section is REJECTED, and the message names the valid set', () => {
  const errors = validateNavPlacement({ nav: { section: 'business', order: 20 } })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /"business" is not a NavSection/)
  // The remedy has to be in the message: the whole failure is that "business" is
  // plausible, so telling someone it is wrong without telling them what is right just
  // moves the guessing.
  assert.match(errors[0], /executive, plan, build, revenue, customer, insight, platform/)
  // And why it matters, not merely that it is invalid.
  assert.match(errors[0], /400|CrashLoop/)
})

test('every section the CONTRACT declares is accepted — the list is not hardcoded here', () => {
  // Read from the same generated schema the validator reads, so this test fails if the
  // two ever disagree rather than encoding a second copy that can drift.
  const schema = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'manifest.schema.json'),
      'utf8'
    )
  )
  const sections = schema.$defs.NavSection.enum
  assert.ok(sections.length > 0)
  for (const section of sections) {
    assert.deepEqual(validateNavPlacement({ nav: { section, order: 0 } }), [], section)
  }
})

test('an ABSENT nav is rejected — sorting last must be a decision, not an accident', () => {
  const errors = validateNavPlacement({})
  assert.equal(errors.length, 1)
  assert.match(errors[0], /declares no `nav`/)
  assert.match(errors[0], /sorts LAST/)
})

test('nav.order without nav.section is rejected — order ranks WITHIN a section', () => {
  const errors = validateNavPlacement({ nav: { order: 10 } })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /`nav.order` is set but `nav.section` is not/)
})

test('nav.order outside 0..9999 is rejected, same fatal 400 as a bad section', () => {
  assert.match(validateNavPlacement({ nav: { section: 'build', order: 10000 } })[0], /0\.\.9999/)
  assert.match(validateNavPlacement({ nav: { section: 'build', order: -1 } })[0], /0\.\.9999/)
  assert.match(validateNavPlacement({ nav: { section: 'build', order: 1.5 } })[0], /0\.\.9999/)
})

test('nav.order may be omitted entirely — the platform defaults it', () => {
  assert.deepEqual(validateNavPlacement({ nav: { section: 'build' } }), [])
})

test('a non-object nav is rejected rather than crashing the validator', () => {
  assert.match(validateNavPlacement({ nav: 'build' })[0], /must be an object/)
  assert.match(validateNavPlacement({ nav: ['build'] })[0], /must be an object/)
  assert.match(validateNavPlacement({ nav: null })[0], /must be an object/)
})

test('the nav rule is wired into the end-to-end directory check', () => {
  // A unit test on the exported function proves nothing about the CLI if the function
  // is never called by it — which is exactly how this gap existed in the first place.
  const dir = makeDir({
    'manifest.json': { ...PORTAL_STANDALONE, slug: 'thing', name: 'Thing', nav: { section: 'business' } },
    'policy.json': { name: 'Thing', resources: [], roles: [] },
  })
  const errors = validateRegistrationDir(dir)
  assert.ok(
    errors.some(e => /not a NavSection/.test(e)),
    'nav violation did not reach validateRegistrationDir: ' + errors.join('\n')
  )
})
