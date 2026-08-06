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
import { join, resolve } from 'node:path'

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
