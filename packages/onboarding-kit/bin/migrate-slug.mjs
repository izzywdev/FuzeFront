#!/usr/bin/env node
// Correct an app registered under a `Fuze`-prefixed slug: register it under the short
// slug, verify the replacement is live, then delete the prefixed original.
//
// THIS IS AN OWNER TOOL, NOT AN INIT-CONTAINER TOOL. register.sh runs unattended on
// every pod start; this runs once per product, by hand, against a registry the operator
// has an admin token for. It is deliberately NOT wired into any deploy path.
//
// ---------------------------------------------------------------------------------
// WHY A TOOL AT ALL — the shape of the problem
// ---------------------------------------------------------------------------------
//
// `slug` is IMMUTABLE. `PUT /apps/{slug}` (services/app-registry-service/openapi.yaml)
// states that `slug`, `builtin` and `manifestVersion` "are immutable and must match",
// and the contract has no rename operation. So de-prefixing is not an edit — it is:
//
//     1. POST /apps            with the short slug     (the replacement)
//     2. DELETE /apps/{old}    the prefixed original   (the correction)
//
// `register.sh` performs step 1 and only step 1. If a product de-prefixes its manifest
// and redeploys, the init container happily registers `service` and the old `fuzeservice`
// row simply stays — registered, activated, and still in the launcher. Twelve products
// doing that produces twelve ghost tiles, each pointing at a remoteEntry that may or may
// not still be served. Nobody gets an error. That is the failure this tool prevents, and
// it is why the two steps must be driven together rather than left to "someone will
// remember to clean up".
//
// ---------------------------------------------------------------------------------
// THE SAFETY PROPERTY, stated precisely
// ---------------------------------------------------------------------------------
//
// The only unrecoverable outcome is a product with NO registration: the tile vanishes,
// the remote cannot mount, and the manifest may only exist in a repo nobody can deploy
// right now. Everything else is recoverable by re-running something.
//
// Therefore DELETE is the LAST operation, it is guarded, and every failure path aborts
// BEFORE it. If anything at all goes wrong, the run ends with both rows present — a
// duplicate tile, which is visible, harmless and fixed by re-running this tool. The tool
// will never trade "duplicate" for a risk of "none".
//
// Concretely, `--apply` refuses to DELETE unless, at that moment:
//   - GET /apps/{new} returns 200,
//   - its status equals the status the OLD app had (activated stays activated; a
//     suspended app is not silently switched on by migrating it),
//   - its manifest's slug really is the new slug,
//   - the old app is not `builtin` (the contract 403s those; only suspend applies), and
//   - the operator has answered for the Permit grants and the installation rows below.
//
// ---------------------------------------------------------------------------------
// WHAT THE CONTRACT CANNOT GIVE BACK — read this before using --apply
// ---------------------------------------------------------------------------------
//
// (a) PERMIT GRANTS. Product authorization is namespaced by the REGISTRY SLUG, not by
//     whatever `product` the policy file claims: sync-permit-schema.ts builds each
//     policy as `{ ...raw, product: row.slug }`, and product-policy.ts namespaces every
//     resource and role as `<slug>_<Key>`. Migrating `fuzeservice` -> `service` therefore
//     renames every key: `fuzeservice_Ticket` -> `service_Ticket`,
//     `fuzeservice_agent` -> `service_agent`.
//
//     Existing role assignments still point at `fuzeservice_agent`. `syncPermitSchema`
//     is get-or-create/update and NEVER deletes, so that role continues to exist in
//     Permit after the registry row is gone — the assignment stays valid, stays
//     un-erroring, and grants permissions on a resource type nothing checks any more.
//     Runtime checks go through `namespaceKey(product, resource)` with the NEW slug, find
//     no matching grant, and deny. Authorization fails closed, which is the correct
//     behaviour and precisely why nothing reports it: the user simply loses their role.
//
//     This tool talks to the app registry, not to Permit, and giving a registry migration
//     an admin Permit credential is a blast radius nobody wants. So it does not remap
//     grants — it REFUSES to delete until the operator states, with --permit-grants, that
//     they have dealt with them. See docs/runbooks/app-slug-deprefix-migration.md for the
//     remap procedure and why the overlap window (both slugs registered, both namespaces
//     present in Permit, no key collision) is the safe place to run it.
//
// (b) INSTALLATION ROWS. `app_installations.app_id` references `apps.id` ON DELETE
//     CASCADE (backend/src/migrations/017_app_scope_levels_and_installations.ts). Deleting
//     the old app row destroys every personal and organization install of that product.
//     Installs are not part of the frozen `/api/v1/app-registry` contract at all — they
//     live on the legacy `/api/apps/:id/install` surface — so this tool can neither read
//     them nor recreate them. --installs is the same kind of explicit acknowledgement.
//
// (c) POLICY AND BILLING PROFILE. `GET /apps/{slug}` returns an `App`, whose schema is
//     `additionalProperties: false` over `[slug, status, mode, builtin, manifest,
//     createdAt, updatedAt]`. The stored policy and billing profile are NOT readable
//     through the contract, so they cannot be copied from old to new. They must be
//     re-submitted from the product's own `registration/` directory, which is why
//     --registration is required whenever those files exist.
//
// ---------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------
//
//   node bin/migrate-slug.mjs --from fuzeservice --to service \
//     --api https://app.fuzefront.com --token "$TOKEN" \
//     --registration ../fuzeservice/registration
//
// Dry run by DEFAULT — it reads, plans and prints, and touches nothing. Add --apply to
// execute. Idempotent: re-running a completed migration is a no-op that exits 0, and
// re-running a half-finished one resumes at the verify/delete step.
//
// Exit codes: 0 = migrated, or already migrated, or dry run planned cleanly.
//             1 = refused, or failed. On any 1, the product is still registered.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Mirrors `Slug` in the frozen contract. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const FUZE_PREFIX_RE = /^fuze/i

export class MigrationRefused extends Error {}

// ---- planning (pure, unit-testable) ------------------------------------------------

/**
 * Rewrite a manifest from the old slug to the new one.
 *
 * The manifest is taken from the LIVE REGISTRY RECORD by default, not from the product
 * repo. That is deliberate: the repo copy is being changed concurrently by whoever is
 * de-prefixing the product, and a migration that also swaps in an unrelated manifest
 * revision makes a bad outcome impossible to attribute. Deriving from the live record
 * means the replacement is byte-identical to what is serving today except for the slug
 * and the strings that must follow it.
 *
 * Only fields that DEMONSTRABLY encode the slug are touched, and each only when it
 * matches the old slug exactly — a manifest whose `routing.path` is a hand-written
 * `/app/support-desk` is left alone rather than guessed at.
 *
 * @param {Record<string, any>} manifest  the old app's manifest
 * @param {string} from
 * @param {string} to
 * @returns {{ manifest: Record<string, any>, notes: string[] }}
 */
export function rewriteManifest(manifest, from, to) {
  const next = structuredClone(manifest)
  const notes = []

  next.slug = to
  notes.push(`slug: ${from} -> ${to}`)

  // `name` follows the same convention as the slug (Service, not FuzeService). Only
  // stripped when it is literally the prefixed form; a product whose display name is
  // already correct is not second-guessed.
  if (typeof next.name === 'string' && FUZE_PREFIX_RE.test(next.name)) {
    const stripped = next.name.replace(FUZE_PREFIX_RE, '')
    if (stripped) {
      notes.push(`name: ${next.name} -> ${stripped}`)
      next.name = stripped
    }
  }
  if (typeof next.menuLabel === 'string' && FUZE_PREFIX_RE.test(next.menuLabel)) {
    const stripped = next.menuLabel.replace(FUZE_PREFIX_RE, '')
    if (stripped) {
      notes.push(`menuLabel: ${next.menuLabel} -> ${stripped}`)
      next.menuLabel = stripped
    }
  }

  // The portal mounts a `portal` surface at /app/:slug. A path that still says
  // /app/fuzeservice after the slug is `service` is a 404 waiting to happen.
  if (next.routing && typeof next.routing === 'object' && next.routing.path === `/app/${from}`) {
    notes.push(`routing.path: /app/${from} -> /app/${to}`)
    next.routing.path = `/app/${to}`
  }

  // routing.host is a real DNS name with a certificate and an ingress behind it. It is
  // NOT derived from the slug and must not be rewritten here — changing it would point
  // the replacement at a hostname that does not resolve. Reported so the operator sees
  // it and can decide separately.
  if (next.routing && typeof next.routing.host === 'string' && next.routing.host.includes(from)) {
    notes.push(
      `NOTE routing.host "${next.routing.host}" contains "${from}" and was NOT changed — ` +
        'a hostname needs DNS, a certificate and an ingress, none of which this tool owns'
    )
  }

  // Module-Federation `scope` is the global the remote publishes itself under at
  // runtime. It must keep matching the deployed bundle, so it is likewise left alone.
  if (next.integration && typeof next.integration.scope === 'string' &&
      FUZE_PREFIX_RE.test(next.integration.scope)) {
    notes.push(
      `NOTE integration.scope "${next.integration.scope}" was NOT changed — it must keep ` +
        'matching the global the deployed remoteEntry actually publishes'
    )
  }

  return { manifest: next, notes }
}

/**
 * Decide what to do from the two GET results. Separated from all I/O so every branch —
 * including the ones that are awkward to provoke against a real registry — is directly
 * testable.
 *
 * @param {{status:number, app?:any}} oldRes  result of GET /apps/{from}
 * @param {{status:number, app?:any}} newRes  result of GET /apps/{to}
 * @returns {{ action: 'noop'|'absent'|'register'|'verify-and-delete', reason: string }}
 */
export function planFrom(oldRes, newRes) {
  const oldExists = oldRes.status === 200
  const newExists = newRes.status === 200

  if (!oldExists && newExists) {
    return { action: 'noop', reason: 'already migrated — the short slug is registered and the prefixed one is gone' }
  }
  if (!oldExists && !newExists) {
    // Neither row exists. This tool corrects a registration; it does not create one from
    // nothing, and a product that is simply not deployed yet must not be conjured into
    // the registry by a migration run.
    //
    // Reported as a FAILURE, not a quiet success. "Nothing to do" and "you typed the slug
    // wrong" produce exactly the same reading of the registry, and exiting 0 on the
    // second one is how a migration gets ticked off a list without having happened.
    return { action: 'absent', reason: `NEITHER "${oldRes.slug ?? '--from'}" nor the target is registered — nothing to migrate (check the slugs, or deploy the product first)` }
  }
  if (oldExists && newExists) {
    return { action: 'verify-and-delete', reason: 'both slugs are registered — a previous run registered the replacement but did not remove the original' }
  }
  return { action: 'register', reason: 'only the prefixed slug is registered — register the replacement, then remove it' }
}

/**
 * Preflight the arguments. Throws MigrationRefused with a reason the operator can act on.
 * @param {{from:string, to:string}} args
 */
export function validateSlugs({ from, to }) {
  if (!from || !to) throw new MigrationRefused('both --from and --to are required')
  if (from === to) throw new MigrationRefused(`--from and --to are both "${from}" — nothing to migrate`)
  if (!SLUG_RE.test(to)) {
    throw new MigrationRefused(`--to "${to}" is not a valid slug (contract pattern ${SLUG_RE})`)
  }
  if (FUZE_PREFIX_RE.test(to)) {
    throw new MigrationRefused(
      `--to "${to}" still starts with "fuze" — that is the thing being corrected`
    )
  }
  if (!FUZE_PREFIX_RE.test(from)) {
    throw new MigrationRefused(
      `--from "${from}" does not start with "fuze". This tool exists for the de-prefix ` +
        'migration; using it as a general rename would delete a registration for a reason ' +
        'nobody has reviewed.'
    )
  }
}

/**
 * A suite parent is SCOPED OUT, on purpose.
 *
 * FuzeHub registers five rows: the parent plus four sibling surfaces
 * (`fuzehub-talent`, `fuzehub-recruiter`, …), grouped in the menu by an identical
 * `nav.suite.id`. Migrating the parent alone does three bad things at once: the siblings
 * keep the old `nav.suite.id` and split into a second menu group, their own slugs stay
 * prefixed, and the product-level policy and billing profile — which bind to the PRIMARY
 * slug only (see register.sh) — move to a row the siblings no longer relate to.
 *
 * Doing it correctly means registering five replacements, re-pointing five suite ids and
 * deleting five originals as one atomic operation, with a rollback for a partial failure
 * in the middle. The contract offers no transaction, so "atomic" would have to be
 * simulated, and a simulated transaction over five deletes is exactly where a tool
 * quietly leaves a product with three tiles. Better to refuse and hand it to a human with
 * a maintenance window than to ship something that half-works on the one product with
 * the most surfaces to lose.
 *
 * @param {string} from
 * @param {Array<{slug:string, manifest?:any}>} allApps  every app in the registry
 * @returns {string[]} related slugs; non-empty means REFUSE
 */
export function detectSuiteMembers(from, allApps) {
  const related = new Set()
  const fromSuite =
    allApps.find(a => a.slug === from)?.manifest?.nav?.suite?.id ?? undefined

  for (const app of allApps) {
    if (app.slug === from) continue
    if (app.slug.startsWith(`${from}-`)) related.add(app.slug)
    const suite = app.manifest?.nav?.suite?.id
    if (suite !== undefined && (suite === from || (fromSuite !== undefined && suite === fromSuite))) {
      related.add(app.slug)
    }
  }
  return [...related].sort()
}

// ---- registry client ---------------------------------------------------------------

/** Thin, dependency-free client over the frozen `/api/v1/app-registry` contract. */
export class RegistryClient {
  /**
   * @param {string} apiUrl base URL, e.g. https://app.fuzefront.com
   * @param {string} token  bearer token with apps:write + apps:activate
   * @param {(m:string)=>void} log
   */
  constructor(apiUrl, token, log = console.error) {
    this.base = `${apiUrl.replace(/\/+$/, '')}/api/v1/app-registry`
    this.token = token
    this.log = log
  }

  async request(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, body: json, text }
  }

  async getApp(slug) {
    const r = await this.request('GET', `/apps/${encodeURIComponent(slug)}`)
    return { status: r.status, app: r.status === 200 ? r.body : undefined, text: r.text }
  }

  async listApps() {
    // The contract's list is filtered by `status`; omitting it returns all non-suspended.
    // Suite detection wants EVERY row, so both pages are merged.
    const seen = new Map()
    for (const qs of ['', '?status=suspended']) {
      const r = await this.request('GET', `/apps${qs}`)
      if (r.status !== 200) continue
      const items = Array.isArray(r.body) ? r.body : (r.body?.items ?? r.body?.apps ?? [])
      for (const a of items) if (a?.slug) seen.set(a.slug, a)
    }
    return [...seen.values()]
  }

  registerApp(manifest) {
    return this.request('POST', '/apps', { manifest })
  }
  putManifest(slug, manifest) {
    return this.request('PUT', `/apps/${encodeURIComponent(slug)}`, manifest)
  }
  activateApp(slug) {
    return this.request('POST', `/apps/${encodeURIComponent(slug)}/activate`)
  }
  putPolicy(slug, policy) {
    return this.request('PUT', `/apps/${encodeURIComponent(slug)}/policy`, policy)
  }
  putBilling(slug, profile) {
    return this.request('PUT', `/apps/${encodeURIComponent(slug)}/billing-profile`, profile)
  }
  deleteApp(slug) {
    return this.request('DELETE', `/apps/${encodeURIComponent(slug)}`)
  }
}

// ---- the migration -----------------------------------------------------------------

/**
 * @typedef {Object} MigrateOptions
 * @property {string}  from
 * @property {string}  to
 * @property {boolean} apply           false = dry run (default)
 * @property {string} [registration]   product's registration/ dir, for policy + billing
 * @property {boolean} permitGrants    operator has handled the Permit grant remap
 * @property {boolean} installs        operator accepts losing the install rows
 * @property {(m:string)=>void} [log]
 */

/**
 * @param {RegistryClient} registry
 * @param {MigrateOptions} opts
 * @returns {Promise<{ ok: boolean, action: string, steps: string[], refusal?: string }>}
 */
export async function migrate(registry, opts) {
  const log = opts.log ?? (m => console.error(m))
  const steps = []
  const say = m => {
    steps.push(m)
    log(m)
  }

  validateSlugs(opts)
  const { from, to, apply } = opts

  say(`${apply ? 'APPLY' : 'DRY RUN'}: ${from} -> ${to}`)

  const oldRes = await registry.getApp(from)
  const newRes = await registry.getApp(to)
  const plan = planFrom(oldRes, newRes)
  say(`plan: ${plan.action} — ${plan.reason}`)

  if (plan.action === 'noop') return { ok: true, action: 'noop', steps }
  if (plan.action === 'absent') return { ok: false, action: 'absent', steps, refusal: plan.reason }

  const oldApp = oldRes.app

  // Built-ins cannot be deleted (the contract 403s), so the migration can never
  // complete for one. Refuse UP FRONT rather than after registering a replacement and
  // leaving a permanent duplicate.
  if (oldApp?.builtin === true) {
    const refusal =
      `"${from}" is a BUILT-IN app. DELETE /apps/{slug} returns 403 for built-ins, so the ` +
      'prefixed row can never be removed and this migration would only ever add a duplicate. ' +
      'Built-ins are de-prefixed by changing the platform seed and re-seeding, not by this tool.'
    say(`REFUSED: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }

  // Suite detection needs the full list. A registry that will not list is a registry we
  // cannot prove is safe to delete from, so treat an unreadable list as a refusal rather
  // than as "no siblings".
  const allApps = await registry.listApps()
  if (allApps.length === 0) {
    const refusal =
      'GET /apps returned nothing — cannot rule out sibling suite surfaces. Refusing, ' +
      'because a suite parent migrated alone splits the menu group and strands its siblings.'
    say(`REFUSED: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }
  const siblings = detectSuiteMembers(from, allApps)
  if (siblings.length > 0) {
    const refusal =
      `"${from}" is a SUITE PARENT — related surfaces: ${siblings.join(', ')}. Migrating a ` +
      'suite means registering, re-pointing nav.suite.id on, and deleting every member as ' +
      'one operation, and the contract offers no transaction to make that atomic. SCOPED ' +
      'OUT: do it by hand in a maintenance window (see the runbook).'
    say(`REFUSED: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }

  // ---- the two acknowledgements ----------------------------------------------------
  // These are not ceremony. Both are silent, irreversible losses that this tool provably
  // cannot repair, so the only honest gate is that a human states they have handled them.
  //
  // They gate the DELETE, not the preview. A dry run that stopped here would be useless
  // for its actual purpose — you could not see the plan without first passing the flags,
  // which trains the operator to type them reflexively to get any output at all. A
  // confirmation you have to bypass in order to do your job stops being a decision and
  // becomes a habit. So a dry run WARNS in full and carries on planning; only --apply
  // refuses.
  const unacknowledged = []
  if (!opts.permitGrants) {
    unacknowledged.push(
      `--permit-grants not given. Deleting "${from}" leaves every Permit role assignment ` +
        `pointing at \`${from}_<Role>\`, while runtime checks move to \`${to}_<Role>\`. The old ` +
        'role is never deleted (syncPermitSchema only creates/updates), so nothing errors — ' +
        'affected users just silently lose the role. Remap the grants during the overlap ' +
        'window, then pass --permit-grants to confirm. See the runbook.'
    )
  }
  if (!opts.installs) {
    unacknowledged.push(
      `--installs not given. app_installations.app_id references apps.id ON DELETE CASCADE, ` +
        `so deleting "${from}" destroys every personal and organization install of the product. ` +
        'Installs are not in the frozen contract, so this tool can neither read nor restore ' +
        'them. Capture them first, then pass --installs to confirm. See the runbook.'
    )
  }
  if (unacknowledged.length > 0) {
    if (apply) {
      const refusal = unacknowledged.join('\n')
      say(`REFUSED: ${refusal}`)
      return { ok: false, action: plan.action, steps, refusal }
    }
    for (const w of unacknowledged) say(`WARNING (would block --apply): ${w}`)
  }

  // ---- step 1: register the replacement --------------------------------------------
  const targetStatus = oldApp?.status ?? 'activated'

  if (plan.action === 'register') {
    const { manifest: nextManifest, notes } = rewriteManifest(oldApp.manifest, from, to)
    for (const n of notes) say(`  ${n}`)

    if (!apply) {
      say(`DRY RUN: would POST /apps with slug "${to}", then re-attach policy/billing, ` +
          `then activate to reach status "${targetStatus}", verify, and DELETE /apps/${from}`)
      return { ok: true, action: plan.action, steps }
    }

    const reg = await registry.registerApp(nextManifest)
    if (reg.status === 201) say(`registered ${to}`)
    else if (reg.status === 409) say(`${to} already registered (409) — continuing`)
    else {
      const refusal = `register failed: HTTP ${reg.status} ${reg.text}. NOTHING deleted; "${from}" is still live.`
      say(`ABORT: ${refusal}`)
      return { ok: false, action: plan.action, steps, refusal }
    }
  } else if (apply) {
    // Replacement already exists from an earlier run. Refresh its manifest so a resumed
    // migration does not leave a half-rewritten record behind.
    const { manifest: nextManifest } = rewriteManifest(oldApp.manifest, from, to)
    const put = await registry.putManifest(to, nextManifest)
    say(`refreshed ${to} manifest (HTTP ${put.status})`)
  }

  // ---- step 2: re-attach policy + billing ------------------------------------------
  // These CANNOT be copied from the old row — `App` in the contract does not expose them.
  // They come from the product's registration/ directory or not at all, and "not at all"
  // is a product whose users have no roles, so it is a refusal rather than a warning.
  const attach = await reattach(registry, to, opts, say, apply)
  if (!attach.ok) return { ok: false, action: plan.action, steps, refusal: attach.refusal }

  // ---- step 3: reach the old app's status ------------------------------------------
  // Preserve, do not assume. Migrating a SUSPENDED app must not switch it on.
  if (apply) {
    if (targetStatus === 'activated') {
      const act = await registry.activateApp(to)
      if (act.status !== 200 && act.status !== 204) {
        const refusal = `activate ${to} failed: HTTP ${act.status} ${act.text}. NOTHING deleted; "${from}" is still live.`
        say(`ABORT: ${refusal}`)
        return { ok: false, action: plan.action, steps, refusal }
      }
      say(`activated ${to}`)
    } else {
      say(`"${from}" was "${targetStatus}", not activated — leaving ${to} unactivated to match`)
    }
  }

  if (!apply) {
    say(`DRY RUN: would verify ${to} is "${targetStatus}", then DELETE /apps/${from}`)
    return { ok: true, action: plan.action, steps }
  }

  // ---- step 4: VERIFY, and only then delete ----------------------------------------
  // Re-read from the server. Not "the POST returned 201" — the actual current state, at
  // the moment of deciding to delete. This check is the entire safety property.
  const check = await registry.getApp(to)
  if (check.status !== 200) {
    const refusal = `verification failed: GET /apps/${to} returned ${check.status}. REFUSING to delete "${from}".`
    say(`ABORT: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }
  if (check.app.status !== targetStatus) {
    const refusal =
      `verification failed: ${to} is "${check.app.status}" but "${from}" was "${targetStatus}". ` +
      `REFUSING to delete "${from}" — the replacement is not equivalent.`
    say(`ABORT: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }
  if (check.app.manifest?.slug !== to) {
    const refusal =
      `verification failed: ${to}'s manifest.slug is "${check.app.manifest?.slug}". ` +
      `REFUSING to delete "${from}".`
    say(`ABORT: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }
  say(`verified: ${to} is registered, status "${check.app.status}", manifest.slug "${to}"`)

  const del = await registry.deleteApp(from)
  if (del.status === 204 || del.status === 200) say(`deleted ${from}`)
  else if (del.status === 404) say(`${from} already gone (404)`)
  else {
    // The replacement is live and verified, so the product is NOT unregistered — this is
    // the recoverable outcome the design trades for. Report it as a failure so it is not
    // mistaken for a completed migration, and say plainly what state things are in.
    const refusal =
      `delete failed: HTTP ${del.status} ${del.text}. The replacement "${to}" IS live and ` +
      `verified, so the product still works — but "${from}" remains as a duplicate tile. ` +
      'Re-run this tool to retry the delete.'
    say(`INCOMPLETE: ${refusal}`)
    return { ok: false, action: plan.action, steps, refusal }
  }

  // Final assertion: the replacement survived the delete. Cheap, and the one thing that
  // would make this catastrophic rather than merely wrong.
  const post = await registry.getApp(to)
  if (post.status !== 200) {
    const refusal =
      `CRITICAL: after deleting "${from}", GET /apps/${to} returns ${post.status}. The product ` +
      'may be UNREGISTERED. Re-register it immediately from its registration/ directory.'
    say(refusal)
    return { ok: false, action: plan.action, steps, refusal }
  }

  say(`OK — ${from} corrected to ${to}`)
  return { ok: true, action: plan.action, steps }
}

/**
 * Re-submit policy.json / billing-profile.json under the new slug.
 * @returns {Promise<{ok:boolean, refusal?:string}>}
 */
async function reattach(registry, to, opts, say, apply) {
  const dir = opts.registration
  if (!dir) {
    say(
      'no --registration given — assuming this product has no policy.json and no ' +
        'billing-profile.json. If it has either, STOP: the new slug will have no roles ' +
        'and cannot take payment.'
    )
    return { ok: true }
  }
  if (!existsSync(dir)) {
    return { ok: false, refusal: `--registration ${dir} does not exist` }
  }

  for (const [file, verb, put] of [
    ['policy.json', 'authz policy', (s, b) => registry.putPolicy(s, b)],
    ['billing-profile.json', 'billing profile', (s, b) => registry.putBilling(s, b)],
  ]) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      say(`no ${file} in ${dir} — skipping ${verb}`)
      continue
    }
    let body
    try {
      body = JSON.parse(readFileSync(path, 'utf8'))
    } catch (err) {
      return { ok: false, refusal: `${path} is not valid JSON — ${err.message}` }
    }
    // The platform namespaces by the REGISTRY SLUG regardless of what `product` says
    // (sync-permit-schema.ts forces `product: row.slug`), but the ingress schema rejects
    // a body whose `product` disagrees with the path slug. Align it.
    if (body && typeof body === 'object' && 'product' in body) body.product = to

    if (!apply) {
      say(`DRY RUN: would submit ${verb} from ${file}`)
      continue
    }
    const res = await put(to, body)
    if ([200, 201, 204].includes(res.status)) {
      say(`submitted ${verb}`)
    } else {
      return {
        ok: false,
        refusal:
          `${verb} submission failed: HTTP ${res.status} ${res.text}. NOTHING deleted; ` +
          'the prefixed registration is still live.',
      }
    }
  }
  return { ok: true }
}

// ---- CLI ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { apply: false, permitGrants: false, installs: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const take = () => argv[++i]
    if (a === '--from') out.from = take()
    else if (a === '--to') out.to = take()
    else if (a === '--api') out.api = take()
    else if (a === '--token') out.token = take()
    else if (a === '--registration') out.registration = take()
    else if (a === '--apply') out.apply = true
    else if (a === '--permit-grants') out.permitGrants = true
    else if (a === '--installs') out.installs = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new MigrationRefused(`unknown argument "${a}"`)
  }
  return out
}

const USAGE = `
fuzefront-migrate-slug — correct a Fuze-prefixed app registration (OWNER TOOL)

  --from <slug>          the prefixed slug to remove, e.g. fuzeservice
  --to <slug>            the short slug to register, e.g. service
  --api <url>            registry base URL (or FUZEFRONT_API_URL)
  --token <token>        bearer token (or FUZEFRONT_REGISTRATION_TOKEN)
  --registration <dir>   product's registration/ dir, for policy + billing re-submit
  --apply                actually do it (DEFAULT IS A DRY RUN)
  --permit-grants        confirm the Permit role-assignment remap is handled
  --installs             confirm the loss of app_installations rows is accepted

Both --permit-grants and --installs are required before anything is deleted. They
acknowledge two silent, irreversible losses this tool cannot repair; see
docs/runbooks/app-slug-deprefix-migration.md.
`

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith('migrate-slug.mjs')

if (invokedDirectly) {
  ;(async () => {
    let args
    try {
      args = parseArgs(process.argv.slice(2))
    } catch (err) {
      console.error(`migrate-slug: ${err.message}`)
      console.error(USAGE)
      process.exit(1)
    }
    if (args.help) {
      console.log(USAGE)
      process.exit(0)
    }

    const api = args.api || process.env.FUZEFRONT_API_URL
    const token = args.token || process.env.FUZEFRONT_REGISTRATION_TOKEN
    if (!api || !token) {
      console.error('migrate-slug: --api/FUZEFRONT_API_URL and --token/FUZEFRONT_REGISTRATION_TOKEN are required')
      process.exit(1)
    }

    try {
      const registry = new RegistryClient(api, token)
      const result = await migrate(registry, { ...args, log: m => console.error(m) })
      process.exit(result.ok ? 0 : 1)
    } catch (err) {
      console.error(`migrate-slug: ${err.message}`)
      process.exit(1)
    }
  })()
}
