#!/usr/bin/env node
// Validate a product's registration/ directory against FLEET POLICY — the rules the
// platform requires of every product but that no schema can express.
//
// WHY THIS EXISTS, and why it is NOT a schema tightening:
//
// The frozen contract already validates the SHAPE of a manifest. What it cannot know
// is what the fleet requires of a *product*. Two live examples, both of which pass
// every existing gate:
//
//   1. `mode: "portal"` with `modes` omitted is perfectly valid — the contract says
//      an absent `modes` falls back to `[mode]`. The product registers, appears in the
//      portal, and is silently incapable of EVER shipping a mobile app, because a TWA
//      can only wrap a `standalone` surface with a URL that stands on its own. Nothing
//      is broken; nothing is reported; the capability simply never exists.
//
//   2. A vendored `register.sh` that predates this kit has no policy step at all. The
//      product's policy.json is never submitted, so it gets no roles. Authorization
//      then fails closed for every user, which reads as a bug in the PRODUCT rather
//      than a gap in its registration.
//
//   3. A display name carrying the `Fuze` prefix (`FuzeService` rather than `Service`)
//      is valid against every schema and registers cleanly. It is also the only half of
//      the naming convention that is FREE to fix: `name` and `menuLabel` are ordinary
//      mutable fields, re-sent on every manifest refresh. Left alone, every tile in the
//      launcher opens with the same four letters and the list stops being scannable.
//
// All three failures are invisible by construction: they produce no error, no 4xx, and
// no log line anybody reads. They surface as "this product is mysteriously limited".
// This gate converts that whole class into a red build in the repo that owns the file.
//
// Usage:
//   node validate-registration.mjs [path/to/registration ...]
//
// With no arguments it validates ./registration.
// Exit code 0 = conformant, 1 = violation.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The surfaces every portal-destination product must serve. `portal` is how it appears
// in the shell; `standalone` is the only surface a mobile TWA/APK can wrap, because an
// app store needs a URL that stands on its own. Declaring one without the other is a
// product that is either invisible in the portal or permanently desktop-only.
const REQUIRED_SURFACES = ['portal', 'standalone']

// The family naming convention, CORRECTED 2026-08-19 by owner ruling.
//
// The prefix comes off the DISPLAY STRING, not the slug:
//
//   slug: "fuzeservice"      name: "Service"      menuLabel: "Service"
//
// The point of the convention was never the URL — it was that a launcher listing
// fifteen products all beginning "Fuze" is unreadable. That is a property of the
// rendered label, so that is where the rule belongs. The slug keeps the prefix, where
// it is doing useful work: `fuzeservice` is unambiguous in a Permit key, a billing
// product key and a `/app/<slug>` path, in a family where `deploy`, `market` and `call`
// are all generic enough to collide with something else one day.
//
// THIS FILE PREVIOUSLY ENFORCED THE OPPOSITE, and that was wrong in a way worth
// recording: it rejected a prefixed slug and told the author to migrate. Because `slug`
// is immutable, "migrate" means register-the-new-one-then-delete-the-old, which orphans
// the product's Permit grants and CASCADE-deletes its app_installations rows. A gate
// that pushes people toward a destructive migration is worse than no gate. See
// validateSlugConvention below for why the slug is now unchecked in BOTH directions.
const FUZE_PREFIX_RE = /^fuze/i

// The narrow, NAMED carve-out to the display-name rule below. Owner ruling (verbatim):
// the prefix should come off the display string "unless necessary like for fuzebi, and
// fuzeX". The test for "necessary" is that the remainder left after stripping `Fuze` does
// not identify a product on its own — "BI" and "X" are not names, they are letters; "Sales"
// or "Picker" are. That is a judgment call the owner made for exactly these two products,
// so it is encoded as an explicit list rather than a length/shape heuristic (e.g. "under
// three characters") that would silently make the same call for some future product nobody
// actually decided on. To exempt another product, add it here, by name, deliberately.
const FUZE_PREFIX_EXEMPT_DISPLAY_NAMES = new Set(['FuzeBI', 'FuzeX'])

/**
 * WHY THE SLUG IS NOT CHECKED HERE, IN EITHER DIRECTION.
 *
 * The convention says a NEW product should register with the prefix on the slug
 * (`fuzeservice`) and off the display name (`Service`). Only the second half is
 * enforced, and the asymmetry is deliberate:
 *
 *   `slug` is IMMUTABLE. `PUT /apps/{slug}` states that `slug`, `builtin` and
 *   `manifestVersion` must match, and there is no rename operation.
 *
 * So a slug error has no cheap fix — the only "correction" is to register a second app
 * and delete the first, which orphans the product's Permit grants and CASCADE-deletes
 * its app_installations rows. Failing a build over a value nobody can safely change
 * does not prevent the mistake; it just converts a cosmetic inconsistency into pressure
 * to run a destructive migration.
 *
 * And the field is already split across the fleet. Measured on default branches
 * 2026-08-19: `fuzex` and `fuzebi` carry the prefix; `deploy`, `call`, `executive`,
 * `finance`, `keys`, `market` and `picker` do not. All are live registrations that must
 * be left alone. An error in either direction reds a real repo whose only remedy is the
 * migration above.
 *
 * `name` and `menuLabel` are the opposite case in every respect: ordinary mutable
 * fields, re-sent on every manifest refresh by `register.sh`, fixable with a one-line
 * edit and no registry surgery. They are also the half the convention was actually
 * about — the launcher tile a person reads. So that is what this gate enforces.
 *
 * The prefixed-slug guidance for genuinely new products lives in the docs, not here.
 * A rule is only worth a red build when the author can act on it.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} human-readable violations; empty means conformant
 */
export function validateSlugConvention(manifest) {
  const errors = []
  const { name, menuLabel } = manifest

  // Both display fields, because they are rendered in different places — `menuLabel`
  // in the side menu, `name` in the launcher and app switcher — and fixing one while
  // leaving the other is the shape the fleet is actually in.
  for (const [field, value] of [['name', name], ['menuLabel', menuLabel]]) {
    if (typeof value !== 'string' || !FUZE_PREFIX_RE.test(value)) continue

    // The named carve-out: FuzeBI/FuzeX keep the prefix on EITHER field because the
    // remainder left after stripping it ("BI"/"X") does not identify a product on its
    // own. See the Set's definition above for why this is a fixed list, not a heuristic.
    if (FUZE_PREFIX_EXEMPT_DISPLAY_NAMES.has(value)) continue

    const stripped = value.replace(FUZE_PREFIX_RE, '')
    errors.push(
      `${field} ${JSON.stringify(value)} starts with "Fuze" — use ` +
        `${JSON.stringify(stripped || '<Product>')}. Every product in the launcher ` +
        'already sits inside FuzeFront, so prefixing each tile makes the list ' +
        'unscannable. Unlike `slug`, this is a plain edit: the field is mutable and ' +
        'register.sh re-sends it on the next pod start.'
    )
  }

  return errors
}

/**
 * Resolve the surfaces a manifest actually serves.
 *
 * Mirrors the contract's fallback rule: `modes` is the multi-valued form, and an
 * ABSENT `modes` falls back to `[mode]`. This distinction is the whole point of the
 * gate — an absent `modes` is legal, so it must be resolved, not rejected outright.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string[]}
 */
export function effectiveModes(manifest) {
  if (Array.isArray(manifest.modes) && manifest.modes.length > 0) return manifest.modes
  return typeof manifest.mode === 'string' ? [manifest.mode] : []
}

/**
 * @param {Record<string, unknown>} manifest  parsed manifest.json
 * @returns {string[]} human-readable violations; empty means conformant
 */
export function validateSurfaces(manifest) {
  const errors = []
  const modes = effectiveModes(manifest)

  if (modes.length === 0) {
    errors.push('manifest declares neither `mode` nor `modes` — no surface at all')
    return errors
  }

  // An embed-only product is a legitimate exemption, not an oversight: per the
  // contract it renders inside a THIRD-PARTY page with neither portal chrome nor
  // FuzeFront navigation, "is not a portal destination and may not register a menu
  // entry at all". Requiring a portal surface of it would be wrong.
  if (modes.includes('embed') && !modes.includes('portal')) return errors

  for (const surface of REQUIRED_SURFACES) {
    if (!modes.includes(surface)) {
      errors.push(
        `\`modes\` does not include "${surface}" (effective modes: [${modes.join(', ')}])` +
          (surface === 'standalone'
            ? ' — without it this product can never ship a mobile app, because a TWA can only wrap a standalone URL'
            : '')
      )
    }
  }

  // A standalone surface with no host is the same failure wearing a disguise: the mode
  // is declared, so it LOOKS conformant, but there is no URL for anything to reach.
  if (modes.includes('standalone')) {
    const host = manifest.routing && typeof manifest.routing === 'object'
      ? manifest.routing.host
      : undefined
    if (typeof host !== 'string' || host.trim() === '') {
      errors.push(
        '`modes` includes "standalone" but `routing.host` is missing or empty — ' +
          'a standalone surface with no host has no URL to serve or to wrap'
      )
    }
  }

  return errors
}

/**
 * The policy must not merely exist — it must actually be SUBMITTED. A vendored
 * register.sh that predates the kit will happily register the app and skip the policy,
 * which is the failure that produces a product whose users have no permissions.
 *
 * @param {string} dir  the registration/ directory
 * @returns {string[]}
 */
export function validatePolicyWiring(dir) {
  const errors = []
  const policyPath = join(dir, 'policy.json')
  const scriptPath = join(dir, 'register.sh')

  if (!existsSync(policyPath)) {
    errors.push(
      'policy.json is missing — the product will register with no product-specific ' +
        'roles, and authorization will fail closed for every user'
    )
  }

  // Only inspect a VENDORED script. A product consuming the kit from npm has no
  // register.sh of its own, and that is the preferred shape — absence is not a fault.
  if (existsSync(scriptPath)) {
    const script = readFileSync(scriptPath, 'utf8')
    // Match the submission itself, not the word "policy" — a comment mentioning policy
    // must not satisfy the check.
    const submits = /\/apps\/[^"'\s]*\/policy|apps\/\$\{?SLUG\}?\/policy/.test(script)
    if (!submits) {
      errors.push(
        'vendored register.sh has no policy submission step (no PUT to /apps/{slug}/policy) — ' +
          'this is the pre-kit script; policy.json will never reach the platform'
      )
    }
  }

  return errors
}

/**
 * WHY A *POLICY* GATE IS CHECKING AN ENUM — the one case where "the schema already
 * covers it" is exactly wrong.
 *
 * Everything else in this file guards a rule no schema can express. This one guards a
 * rule the schema expresses perfectly well — and that is the point: NOTHING IN A
 * PRODUCT'S REPOSITORY EVER RUNS THAT SCHEMA. The only thing that does is the
 * platform, at registration time, in the cluster:
 *
 *   registerAppRequestSchema.safeParse(req.body)   // routes/app-registry.ts
 *   navSchema.section = z.enum(NAV_SECTIONS)       // app-registry/manifest.schema.ts
 *
 * So an unknown section is not a lint warning. `POST /apps` answers 400, register.sh
 * treats any non-201/409 as fatal, and the init container CrashLoopBackOffs the
 * product's own pod — in production, on first deploy, with the failure appearing to
 * belong to the product rather than to its manifest.
 *
 * FuzeFinance shipped `nav.section: "business"` and this validator passed it, because
 * "business" is a perfectly plausible section name that simply is not in the list.
 * A one-word typo, free to catch here, expensive to discover in a CrashLoop.
 *
 * The enum is READ FROM manifest.schema.json rather than copied into a constant.
 * scripts/build-schema.mjs generates that file from the frozen openapi.yaml and CI
 * fails if it is stale, so reading it means this gate can never drift from the
 * contract — a hardcoded list would silently go wrong the day a section is added.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} human-readable violations; empty means conformant
 */
export function validateNavPlacement(manifest) {
  const errors = []

  const sections = navSections()
  if (sections === null) {
    // Deliberately an ERROR, not a skip. A gate that quietly does nothing when its
    // reference data is missing is worse than no gate: it reports success while
    // checking nothing, which is the exact failure class this whole kit exists to end.
    return [
      'cannot read NavSection from manifest.schema.json — the kit is installed ' +
        'incompletely, so nav placement went unchecked rather than passing',
    ]
  }

  const nav = manifest.nav
  if (nav === undefined) {
    errors.push(
      'manifest declares no `nav` — the platform defaults it to section "platform", ' +
        'order 999, so the product sorts LAST in the side menu by accident rather than ' +
        `by decision. Pick one of: ${sections.join(', ')}`
    )
    return errors
  }
  if (nav === null || typeof nav !== 'object' || Array.isArray(nav)) {
    return ['`nav` must be an object']
  }

  const { section, order } = nav

  if (section === undefined) {
    errors.push(
      '`nav.order` is set but `nav.section` is not — order ranks WITHIN a section, so ' +
        'on its own it does nothing and the product still sorts last, in "platform". ' +
        `Pick one of: ${sections.join(', ')}`
    )
  } else if (typeof section !== 'string' || !sections.includes(section)) {
    errors.push(
      `nav.section ${JSON.stringify(section)} is not a NavSection. The platform parses ` +
        'the manifest with `z.enum(NAV_SECTIONS)`, so `POST /apps` answers 400, ' +
        'register.sh treats that as fatal, and the pod CrashLoopBackOffs — the product ' +
        `never registers at all. Valid sections, in menu order: ${sections.join(', ')}`
    )
  }

  // Same failure mode, different field: the contract's Nav.order is
  // `integer, minimum 0, maximum 9999`, and the platform's zod mirror rejects anything
  // else with the same fatal 400.
  if (order !== undefined) {
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 9999) {
      errors.push(
        `nav.order ${JSON.stringify(order)} is not an integer in 0..9999 — the platform ` +
          'rejects the manifest with 400 and the pod CrashLoopBackOffs'
      )
    }
  }

  return errors
}

/**
 * The NavSection enum, read from the kit's generated copy of the frozen contract.
 * Returns null if it cannot be read, so the caller can report that rather than
 * silently skipping the check.
 *
 * @returns {string[] | null}
 */
function navSections() {
  try {
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'manifest.schema.json')
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const values = schema?.$defs?.NavSection?.enum
    return Array.isArray(values) && values.length > 0 ? values : null
  } catch {
    return null
  }
}

/**
 * @param {string} dir  path to a registration/ directory
 * @returns {string[]}
 */
export function validateRegistrationDir(dir) {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return [`${manifestPath}: not found`]

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    return [`${manifestPath}: not valid JSON — ${err.message}`]
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [`${manifestPath}: must be a JSON object`]
  }

  return [
    ...validateSlugConvention(manifest),
    ...validateSurfaces(manifest),
    ...validateNavPlacement(manifest),
    ...validatePolicyWiring(dir),
  ]
}

// ---- CLI ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).endsWith('validate-registration.mjs')

if (invokedDirectly) {
  const dirs = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const targets = dirs.length > 0 ? dirs : ['registration']

  let failed = 0
  for (const target of targets) {
    const errors = validateRegistrationDir(target)
    if (errors.length === 0) {
      console.log(`✔ ${target}: conformant`)
    } else {
      failed++
      console.error(`✘ ${target}:`)
      for (const e of errors) console.error(`    - ${e}`)
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} of ${targets.length} registration director${targets.length === 1 ? 'y' : 'ies'} ` +
        'violate fleet policy.'
    )
    process.exit(1)
  }
  process.exit(0)
}
