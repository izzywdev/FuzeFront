#!/usr/bin/env node
// Validate a product's registration/policy.json against the FROZEN ProductPolicy
// contract (services/app-registry-service/openapi.yaml, mirrored by the Zod schema
// in backend/applications/src/app-registry/onboarding.schema.ts).
//
// WHY THIS EXISTS: the platform accepts a policy at PUT /apps/{slug}/policy and
// rejects a bad one with a 400 — but that rejection happens at DEPLOY time, inside an
// init container, in a pod log nobody is watching. Worse, a policy that is never
// submitted at all produces no error anywhere: the product simply has no roles, which
// looks exactly like a product bug. Running this in the product's own CI turns both
// into a red build in the repo that owns the file.
//
// Usage:
//   node validate-policy.mjs [path/to/policy.json ...]
//   node validate-policy.mjs --slug fuzeservice registration/policy.json
//
// With no arguments it validates ./registration/policy.json.
// Exit code 0 = valid, 1 = invalid / missing.

import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

// Keep these THREE regexes in lock-step with the frozen contract. A bare key may not
// contain `_` because `_` is the namespace separator: the platform stores the key as
// `<slug>_<BareKey>` and has to split it back at the FIRST underscore. `Vault_Asset`
// would namespace to `fuzekeys_Vault_Asset` and split as resource `Vault_Asset` under
// product `fuzekeys` only by luck of the first-underscore rule — but every consumer
// that splits on the LAST underscore, or validates the halves, disagrees. Banning it
// outright is the only unambiguous rule.
const BARE_KEY_RE = /^[A-Za-z][A-Za-z0-9-]*$/
const PERMISSION_RE = /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const POLICY_KEYS = new Set(['product', 'name', 'resources', 'roles'])
const RESOURCE_KEYS = new Set(['key', 'name', 'actions'])
const ROLE_KEYS = new Set(['key', 'name', 'permissions'])

/**
 * @param {unknown} policy  parsed policy.json
 * @param {string} [slug]   the app slug from manifest.json, when known
 * @returns {string[]} human-readable errors; empty means valid
 */
export function validatePolicyDocument(policy, slug) {
  const errors = []
  const fail = m => errors.push(m)

  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    return ['policy must be a JSON object']
  }

  // The platform's schema is `additionalProperties: false` / Zod `.strict()`, so an
  // unknown top-level key is a hard 400 — including well-meant ones like `$comment`.
  for (const k of Object.keys(policy)) {
    if (!POLICY_KEYS.has(k)) {
      fail(`unknown top-level key "${k}" — the contract is strict (allowed: ${[...POLICY_KEYS].join(', ')})`)
    }
  }

  if (policy.product !== undefined) {
    if (typeof policy.product !== 'string' || !SLUG_RE.test(policy.product)) {
      fail(`product "${policy.product}" is not a valid slug (${SLUG_RE})`)
    } else if (slug && policy.product !== slug) {
      fail(`product "${policy.product}" disagrees with the manifest slug "${slug}" — the platform rejects this with a 400`)
    }
  }
  if (policy.name !== undefined && typeof policy.name !== 'string') {
    fail('name must be a string')
  }

  if (!Array.isArray(policy.resources)) {
    fail('resources must be an array')
  }
  if (!Array.isArray(policy.roles)) {
    fail('roles must be an array')
  }
  if (errors.length && (!Array.isArray(policy.resources) || !Array.isArray(policy.roles))) {
    return errors
  }

  /** @type {Map<string, Set<string>>} */
  const actionsByResource = new Map()

  policy.resources.forEach((r, i) => {
    const at = `resources[${i}]`
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      fail(`${at} must be an object`)
      return
    }
    for (const k of Object.keys(r)) {
      if (!RESOURCE_KEYS.has(k)) fail(`${at}: unknown key "${k}"`)
    }
    if (typeof r.key !== 'string' || !BARE_KEY_RE.test(r.key)) {
      fail(
        `${at}.key "${r.key}" is invalid — must match ${BARE_KEY_RE} ` +
          `(no "_": it is the <slug>_<Key> namespace separator)`
      )
      return
    }
    if (actionsByResource.has(r.key)) {
      fail(`${at}: duplicate resource key "${r.key}"`)
      return
    }
    if (typeof r.name !== 'string' || r.name.length === 0) {
      fail(`${at}.name must be a non-empty string`)
    }
    if (r.actions === null || typeof r.actions !== 'object' || Array.isArray(r.actions)) {
      fail(`${at}.actions must be an object mapping action key -> { name }`)
      actionsByResource.set(r.key, new Set())
      return
    }
    const actionKeys = Object.keys(r.actions)
    if (actionKeys.length === 0) {
      fail(`${at} ("${r.key}") declares no actions — a resource with no action grants nothing`)
    }
    for (const ak of actionKeys) {
      const a = r.actions[ak]
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        fail(`${at}.actions.${ak} must be an object { name }`)
        continue
      }
      for (const k of Object.keys(a)) {
        if (k !== 'name') fail(`${at}.actions.${ak}: unknown key "${k}"`)
      }
      if (typeof a.name !== 'string' || a.name.length === 0) {
        fail(`${at}.actions.${ak}.name must be a non-empty string`)
      }
    }
    actionsByResource.set(r.key, new Set(actionKeys))
  })

  const roleKeys = new Set()
  policy.roles.forEach((role, i) => {
    const at = `roles[${i}]`
    if (role === null || typeof role !== 'object' || Array.isArray(role)) {
      fail(`${at} must be an object`)
      return
    }
    for (const k of Object.keys(role)) {
      if (!ROLE_KEYS.has(k)) fail(`${at}: unknown key "${k}"`)
    }
    if (typeof role.key !== 'string' || !BARE_KEY_RE.test(role.key)) {
      fail(`${at}.key "${role.key}" is invalid — must match ${BARE_KEY_RE} (no "_")`)
      return
    }
    if (roleKeys.has(role.key)) {
      fail(`${at}: duplicate role key "${role.key}"`)
      return
    }
    roleKeys.add(role.key)
    if (typeof role.name !== 'string' || role.name.length === 0) {
      fail(`${at}.name must be a non-empty string`)
    }
    if (!Array.isArray(role.permissions)) {
      fail(`${at}.permissions must be an array`)
      return
    }
    role.permissions.forEach((perm, pi) => {
      const pat = `${at}.permissions[${pi}]`
      if (typeof perm !== 'string' || !PERMISSION_RE.test(perm)) {
        fail(`${pat} "${perm}" is malformed — expected "<Resource>:<action>" matching ${PERMISSION_RE}`)
        return
      }
      const [resKey, action] = perm.split(':')
      const actions = actionsByResource.get(resKey)
      if (!actions) {
        // A role referencing a resource this document does not declare does not fail
        // loudly at runtime — it just never grants. That is the whole silent-denial
        // class this validator exists to make noisy.
        fail(`${pat} references resource "${resKey}" which this policy does not declare`)
      } else if (!actions.has(action)) {
        fail(`${pat}: resource "${resKey}" declares no action "${action}"`)
      }
    })
  })

  // Not a contract violation, but almost always a mistake worth surfacing: a resource
  // no role can touch is dead weight, and an action no role grants is unreachable.
  return errors
}

/** Advisory (non-failing) observations about an otherwise-valid policy. */
export function policyWarnings(policy) {
  const warnings = []
  if (!Array.isArray(policy?.resources) || !Array.isArray(policy?.roles)) return warnings
  const granted = new Set()
  for (const role of policy.roles) {
    for (const p of role?.permissions ?? []) granted.add(p)
  }
  for (const r of policy.resources) {
    const acts = Object.keys(r?.actions ?? {})
    const unreachable = acts.filter(a => !granted.has(`${r.key}:${a}`))
    if (unreachable.length === acts.length && acts.length > 0) {
      warnings.push(`resource "${r.key}" is granted to no role at all — nobody can use it`)
    } else if (unreachable.length > 0) {
      warnings.push(`resource "${r.key}": action(s) ${unreachable.join(', ')} are granted to no role`)
    }
  }
  if (policy.roles.length === 0) {
    warnings.push('policy declares no roles — registering it grants nothing')
  }
  return warnings
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function slugFromSiblingManifest(policyPath) {
  const manifest = join(dirname(resolve(policyPath)), 'manifest.json')
  if (!existsSync(manifest)) return undefined
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).slug
  } catch {
    return undefined
  }
}

function main(argv) {
  const args = [...argv]
  let slug
  const si = args.indexOf('--slug')
  if (si !== -1) {
    slug = args[si + 1]
    args.splice(si, 2)
  }
  const paths = args.length ? args : ['registration/policy.json']

  let bad = 0
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`✖ ${p}: file not found`)
      bad++
      continue
    }
    let doc
    try {
      doc = JSON.parse(readFileSync(p, 'utf8'))
    } catch (err) {
      console.error(`✖ ${p}: not valid JSON — ${err.message}`)
      bad++
      continue
    }
    const errors = validatePolicyDocument(doc, slug ?? slugFromSiblingManifest(p))
    if (errors.length) {
      console.error(`✖ ${p}: ${errors.length} error(s)`)
      for (const e of errors) console.error(`    - ${e}`)
      bad++
      continue
    }
    const warnings = policyWarnings(doc)
    const counts = `${doc.resources.length} resource(s), ${doc.roles.length} role(s)`
    console.log(`✔ ${p}: valid — ${counts}`)
    for (const w of warnings) console.log(`    ! ${w}`)
  }

  if (bad > 0) {
    console.error(`\n${bad} policy file(s) failed validation.`)
    return 1
  }
  return 0
}

// Only run the CLI when executed directly, so the validators stay importable.
const invokedDirectly =
  process.argv[1] && basename(process.argv[1]) === basename(new URL(import.meta.url).pathname)
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
