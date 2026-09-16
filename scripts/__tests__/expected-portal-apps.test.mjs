/**
 * Guards scripts/expected-portal-apps.json — the roster the portal-federation
 * census diffs the live registry against.
 *
 * WHY THIS EXISTS. Every defect this roster has produced so far was the SAME
 * shape: an entry naming a slug no product has ever registered. That yields a
 * MISSING row identical to the one a real outage produces, so the signal the
 * roster exists to give ("a product dropped out") becomes unreadable. It has
 * happened five times — 'fuzecontact', 'fuzehub-ventures', 'keys',
 * 'merchandize', and 'fuzeplan' — each caught by hand, months apart, by
 * someone re-reading a product's manifest.
 *
 * Nothing offline can prove a slug IS registered (that needs prod + credentials,
 * which is the census's job). What IS checkable here:
 *
 *   1. the file is well-formed and every entry carries a real confidence level
 *      and a citation, so "where did this slug come from" is always answerable;
 *   2. no slug that has already been CORRECTED AWAY comes back — the specific
 *      regression, pinned by name;
 *   3. every built-in app is listed. Built-ins are provisioned on boot by
 *      BUILTIN_MANIFESTS, so they are the one group guaranteed to be in the
 *      registry. If one is absent from this roster, the census cannot notice it
 *      disappearing — a hole in exactly the mechanism this file provides.
 *
 * The checks run against the real file AND against deliberately-broken fixtures,
 * so a validator that silently accepts everything fails this suite rather than
 * passing it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROSTER_PATH = path.join(__dirname, '..', 'expected-portal-apps.json')
const BUILTINS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'backend',
  'applications',
  'src',
  'app-registry',
  'builtins.ts'
)

/**
 * Slugs this roster has previously named that NO product has ever registered.
 * Each was corrected in place, and the correction is recorded in the entry's own
 * `source`. Re-adding one silently reintroduces a permanent phantom MISSING row.
 */
const CORRECTED_AWAY = Object.freeze({
  fuzecontact: "corrected to 'contact' (census 32949523555, 2026-08-26)",
  'fuzehub-ventures': "corrected to 'fuzehub' (census 32949523555, 2026-08-26)",
  keys: "corrected to 'fuzekeys' (census 32949523555, 2026-08-26)",
  merchandize:
    "corrected to 'fuzemerchandize' (2026-09-07, per FuzeMerchandize registration/manifest.json)",
  fuzeplan:
    "corrected to 'plan' (2026-09-08, per FuzePlan registration/manifest.json; the old value came only from the RETIRED app-slug-deprefix-migration runbook)",
})

/** Returns an array of human-readable defects. Empty array = valid. */
function validateRoster(roster, builtinSlugs) {
  const problems = []

  if (!roster || typeof roster !== 'object') {
    return ['roster is not an object']
  }
  const levels = Object.keys(roster._meta?.confidenceLevels ?? {})
  if (levels.length === 0) {
    problems.push('_meta.confidenceLevels is missing or empty')
  }

  const apps = roster.apps
  if (!Array.isArray(apps) || apps.length === 0) {
    // An empty roster would make the census vacuously green: nothing expected,
    // so nothing can be reported missing.
    return [...problems, 'apps is missing or empty']
  }

  const seen = new Set()
  for (const app of apps) {
    const slug = app?.slug
    if (typeof slug !== 'string' || slug.length === 0) {
      problems.push(`entry has no slug: ${JSON.stringify(app)}`)
      continue
    }
    if (seen.has(slug)) problems.push(`duplicate slug: ${slug}`)
    seen.add(slug)

    if (slug !== slug.toLowerCase()) {
      problems.push(`slug is not lowercase: ${slug}`)
    }
    if (Object.hasOwn(CORRECTED_AWAY, slug)) {
      problems.push(
        `slug '${slug}' was already ${CORRECTED_AWAY[slug]} — no product registers it, so this entry can only produce a phantom MISSING row`
      )
    }
    if (typeof app.name !== 'string' || app.name.length === 0) {
      problems.push(`${slug}: missing name`)
    }
    if (!levels.includes(app.confidence)) {
      problems.push(
        `${slug}: confidence '${app.confidence}' is not one of _meta.confidenceLevels (${levels.join(', ')})`
      )
    }
    if (typeof app.source !== 'string' || app.source.trim().length === 0) {
      problems.push(
        `${slug}: empty source — every slug must cite where it was read from`
      )
    }
  }

  const sorted = [...seen].sort()
  if (JSON.stringify([...seen]) !== JSON.stringify(sorted)) {
    problems.push('apps are not sorted by slug, which makes the diff hard to review')
  }

  for (const builtin of builtinSlugs) {
    if (!seen.has(builtin)) {
      problems.push(
        `built-in app '${builtin}' (BUILTIN_MANIFESTS) is absent from the roster — the census could not notice it disappearing`
      )
    }
  }

  return problems
}

/**
 * Reads the slugs out of BUILTIN_MANIFESTS. Deliberately a regex over the
 * source rather than an import: builtins.ts is TypeScript and pulls in the
 * database layer, which this test must not need.
 */
function readBuiltinSlugs(source) {
  const start = source.indexOf('BUILTIN_MANIFESTS')
  assert.notEqual(start, -1, 'BUILTIN_MANIFESTS not found in builtins.ts')
  const slugs = [...source.slice(start).matchAll(/^\s*slug:\s*'([^']+)'/gm)].map(
    m => m[1]
  )
  return slugs
}

const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'))
const builtinSlugs = readBuiltinSlugs(fs.readFileSync(BUILTINS_PATH, 'utf8'))

test('the checked-in roster is valid', () => {
  assert.deepEqual(validateRoster(roster, builtinSlugs), [])
})

test('BUILTIN_MANIFESTS actually parsed — the built-in check is not comparing against an empty set', () => {
  // Without this, a regex that silently matched nothing would make the
  // "every built-in is listed" assertion above trivially true.
  //
  // THREE built-ins, not the four CLAUDE.md still lists: the `fuzequality`
  // entry was removed from BUILTIN_MANIFESTS on 2026-08-25 as a phantom tile
  // (see the comment in builtins.ts) and applications migration 011 suspended
  // the row it had seeded. `fuzequality` is still in the roster because the
  // LIVE REGISTRY returns it — that is a measurement, not a built-in.
  for (const expected of ['fuzesocial', 'fuzeagent', 'clock']) {
    assert.ok(
      builtinSlugs.includes(expected),
      `built-in '${expected}' not parsed out of builtins.ts`
    )
  }
  assert.ok(
    !builtinSlugs.includes('fuzequality'),
    'fuzequality is back in BUILTIN_MANIFESTS — re-adding it requires reverting migration 011 too (see builtins.ts)'
  )
})

test("FuzePlan is rostered under 'plan', the slug its own manifest declares", () => {
  const slugs = roster.apps.map(a => a.slug)
  assert.ok(
    slugs.includes('plan'),
    "roster must name 'plan' — izzywdev/FuzePlan registration/manifest.json declares \"slug\": \"plan\""
  )
  assert.ok(
    !slugs.includes('fuzeplan'),
    "'fuzeplan' is a slug no product has ever registered; census 34261472714 returns neither it nor 'plan'"
  )
})

test('REGRESSION: reintroducing any corrected-away slug is rejected', () => {
  for (const [slug, why] of Object.entries(CORRECTED_AWAY)) {
    const broken = structuredClone(roster)
    broken.apps.push({
      slug,
      name: 'Regression',
      confidence: 'verified',
      source: 'test fixture',
    })
    const problems = validateRoster(broken, builtinSlugs)
    assert.ok(
      problems.some(p => p.includes(`'${slug}'`)),
      `validator accepted corrected-away slug '${slug}' (${why}); problems were: ${JSON.stringify(problems)}`
    )
  }
})

test('ANTI-VACUITY: the validator rejects each defect class it claims to catch', () => {
  const cases = [
    [
      'empty roster',
      r => {
        r.apps = []
      },
      'apps is missing or empty',
    ],
    [
      'duplicate slug',
      r => {
        r.apps.push(structuredClone(r.apps[0]))
      },
      'duplicate slug',
    ],
    [
      'unknown confidence level',
      r => {
        r.apps[0].confidence = 'vibes'
      },
      'is not one of _meta.confidenceLevels',
    ],
    [
      'empty source',
      r => {
        r.apps[0].source = '   '
      },
      'empty source',
    ],
    [
      'missing built-in',
      r => {
        r.apps = r.apps.filter(a => a.slug !== 'clock')
      },
      "built-in app 'clock'",
    ],
    [
      'unsorted',
      r => {
        r.apps.reverse()
      },
      'not sorted by slug',
    ],
  ]

  for (const [label, mutate, expectedFragment] of cases) {
    const broken = structuredClone(roster)
    mutate(broken)
    const problems = validateRoster(broken, builtinSlugs)
    assert.ok(
      problems.some(p => p.includes(expectedFragment)),
      `validator did not catch '${label}'; problems were: ${JSON.stringify(problems)}`
    )
  }
})
