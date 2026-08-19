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
//   3. A slug carrying the `Fuze` prefix (`fuzeservice` rather than `service`) is valid
//      against every schema and registers cleanly. What makes it worth a gate is that
//      it is UNFIXABLE afterwards: `slug` is immutable and there is no rename, so the
//      only correction is register-the-new-one-then-delete-the-old, which orphans the
//      product's Permit grants and CASCADE-deletes its installation rows. A rule whose
//      violation is free to prevent and expensive to undo belongs at authoring time.
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

// The family naming convention: a Fuze product registers on FuzeFront WITHOUT the
// `Fuze` prefix — slug `service`, name `Service`. FuzeFront is the platform, so the
// prefix is already implied by the fact that you are registering here at all;
// repeating it gives every tile in the launcher the same first four letters and the
// slug that shows up in `/app/<slug>` URLs, Permit keys and billing product keys
// carries four characters of pure noise. FuzePicker already registered as `picker`,
// so the convention existed — it was simply never enforced, and twelve products
// registered against it.
//
// Matched with an anchor and no length exemption: there is no product for which
// bare `fuze` is the correct de-prefixed slug, because de-prefixing "FuzeX" yields
// "x". Case-insensitive is belt-and-braces — the contract's Slug pattern is already
// lowercase-only, but `name` is free text and `Fuze` is exactly how it is written
// there.
const FUZE_PREFIX_RE = /^fuze/i

/**
 * WHY THIS IS A BUILD-TIME GATE AND NOT A `pattern` ON THE CONTRACT'S `Slug`.
 *
 * It is tempting to add `(?!fuze)` to `Slug` in
 * services/app-registry-service/openapi.yaml and be done. That would be actively
 * harmful, and the reason is the whole shape of this problem:
 *
 *   `slug` is IMMUTABLE — `PUT /apps/{slug}` states that `slug`, `builtin` and
 *   `manifestVersion` must match, and there is no rename operation. Correcting a
 *   prefixed registration is therefore a TWO-STEP migration: register the short
 *   slug, then delete the prefixed one (see bin/migrate-slug.mjs).
 *
 * Both of those steps talk to the registry ABOUT the prefixed slug. A contract-level
 * ban would reject the very requests that repair the damage: `register.sh` re-PUTs
 * the manifest on every pod start, so twelve live products would start failing their
 * manifest refresh, and the migration tool could no longer look up — or in the worst
 * case delete — the row it exists to remove. Banning a value at the API is only safe
 * when no existing row holds it. Twelve do.
 *
 * So the registry must keep ACCEPTING `fuzeservice` for exactly as long as the
 * migration is in flight, while no product is allowed to AUTHOR a new one. Those are
 * different questions, they need different enforcement points, and this is the
 * authoring one: it fails in the product's own repo, at build time, where the
 * manifest is written and where somebody can fix it.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} human-readable violations; empty means conformant
 */
export function validateSlugConvention(manifest) {
  const errors = []
  const { slug, name } = manifest

  // SHORT-NAME EXEMPTION. The contract's Slug pattern is
  // ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$ — a minimum of THREE characters. So for a
  // product whose de-prefixed slug would be shorter than that, the prefix is not
  // a style violation, it is load-bearing: `fuzebi` -> `bi` and `fuzex` -> `x`
  // are both REJECTED by the platform, so there is no conformant slug to move to.
  //
  // This is a rule, not an allowlist. Anything that de-prefixes to 3+ characters
  // is still held to the convention; only the products the schema makes
  // impossible are exempt, and they are exempt on both `slug` and `name` so the
  // launcher tile and the URL agree with each other.
  // The remainder must be NON-EMPTY: bare `fuze` de-prefixes to nothing, which is
  // not a short product name, it is a missing one. Exempting it would let the
  // placeholder slug through the very check that exists to catch it.
  const deprefixed = typeof slug === 'string' ? slug.replace(FUZE_PREFIX_RE, '') : ''
  if (
    typeof slug === 'string' &&
    FUZE_PREFIX_RE.test(slug) &&
    deprefixed.length > 0 &&
    deprefixed.length < 3
  ) {
    return errors
  }

  if (typeof slug === 'string' && FUZE_PREFIX_RE.test(slug)) {
    errors.push(
      `slug "${slug}" starts with "fuze" — Fuze products register WITHOUT the prefix ` +
        `(use "${slug.replace(FUZE_PREFIX_RE, '') || '<product>'}"). The prefix is implied ` +
        'by registering on FuzeFront at all, and the slug is user-visible in /app/<slug>. ' +
        'Note this is not fixable after the fact: `slug` is immutable, so a wrong slug ' +
        'costs a register-then-delete migration, not an edit.'
    )
  }

  if (typeof name === 'string' && FUZE_PREFIX_RE.test(name)) {
    errors.push(
      `name "${name}" starts with "Fuze" — use "${name.replace(FUZE_PREFIX_RE, '') || '<Product>'}". ` +
        'The launcher already sits inside FuzeFront; prefixing every tile makes them ' +
        'indistinguishable at a glance.'
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
