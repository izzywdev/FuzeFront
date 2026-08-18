#!/usr/bin/env node
/**
 * Guards the AuthZ-policy half of FuzeFront registration. Zero dependencies —
 * runs on a bare `actions/setup-node` with no install step.
 *
 *   node scripts/check-registration.mjs
 *
 * Two checks, for the two ways this silently breaks:
 *
 * 1. `registration/policy.json` is VALID against FuzeFront's frozen ProductPolicy
 *    contract. An invalid policy is rejected with a 400 inside an init container at
 *    deploy time — an error in a pod log nobody tails. A policy that is *accepted*
 *    but whose role names an action the document never declares is worse: nothing
 *    errors anywhere, Permit creates the role, and it grants nothing. The symptom is
 *    "our users have no permissions", which reads as a bug in this app.
 *
 * 2. The registration ConfigMap actually SHIPS that policy, byte-equivalent. The
 *    ConfigMap inlines its own copies of the registration files, so the file in this
 *    repo is decorative unless the ConfigMap carries it — which is exactly how this
 *    app ended up with a committed, correct policy.json that no deploy ever sent.
 *
 * Mirrors bin/validate-policy.mjs in @fuzefront/onboarding-kit. Keep in step with it.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const POLICY_PATH = 'registration/policy.json'

// `_` is the `<slug>_<Key>` namespace separator FuzeFront prepends; a bare key
// containing one could not be split back apart.
const BARE_KEY_RE = /^[A-Za-z][A-Za-z0-9-]*$/
const PERMISSION_RE = /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/
const TOP_LEVEL = new Set(['product', 'name', 'resources', 'roles'])

const problems = []
const fail = m => problems.push(m)

// ── 1. the policy itself ──────────────────────────────────────────────────────
if (!existsSync(POLICY_PATH)) {
  fail(`${POLICY_PATH} is missing — this app declares no roles to FuzeFront`)
}

let policy = null
if (existsSync(POLICY_PATH)) {
  const raw = readFileSync(POLICY_PATH, 'utf8')
  try {
    policy = JSON.parse(raw)
  } catch (err) {
    fail(`${POLICY_PATH} is not valid JSON — ${err.message}`)
  }
}

if (policy) {
  for (const k of Object.keys(policy)) {
    if (!TOP_LEVEL.has(k)) {
      fail(
        `${POLICY_PATH}: unknown top-level key "${k}". FuzeFront's schema is strict ` +
          `(additionalProperties:false) — the whole PUT would 400.`
      )
    }
  }

  const resources = Array.isArray(policy.resources) ? policy.resources : []
  const roles = Array.isArray(policy.roles) ? policy.roles : []
  if (!Array.isArray(policy.resources)) fail(`${POLICY_PATH}: resources must be an array`)
  if (!Array.isArray(policy.roles)) fail(`${POLICY_PATH}: roles must be an array`)

  const actionsByResource = new Map()
  for (const [i, r] of resources.entries()) {
    if (!BARE_KEY_RE.test(r?.key ?? '')) {
      fail(`${POLICY_PATH}: resources[${i}].key "${r?.key}" must match ${BARE_KEY_RE} (no "_")`)
      continue
    }
    if (actionsByResource.has(r.key)) fail(`${POLICY_PATH}: duplicate resource "${r.key}"`)
    const actions = Object.keys(r.actions ?? {})
    if (actions.length === 0) fail(`${POLICY_PATH}: resource "${r.key}" declares no actions`)
    actionsByResource.set(r.key, new Set(actions))
  }

  const seenRoles = new Set()
  for (const [i, role] of roles.entries()) {
    if (!BARE_KEY_RE.test(role?.key ?? '')) {
      fail(`${POLICY_PATH}: roles[${i}].key "${role?.key}" must match ${BARE_KEY_RE} (no "_")`)
      continue
    }
    if (seenRoles.has(role.key)) fail(`${POLICY_PATH}: duplicate role "${role.key}"`)
    seenRoles.add(role.key)
    for (const perm of role.permissions ?? []) {
      if (!PERMISSION_RE.test(perm)) {
        fail(`${POLICY_PATH}: role "${role.key}" permission "${perm}" is malformed`)
        continue
      }
      const [resKey, action] = perm.split(':')
      const actions = actionsByResource.get(resKey)
      if (!actions) {
        fail(`${POLICY_PATH}: role "${role.key}" references undeclared resource "${resKey}"`)
      } else if (!actions.has(action)) {
        fail(`${POLICY_PATH}: role "${role.key}": resource "${resKey}" has no action "${action}"`)
      }
    }
  }
}

// ── 2. the ConfigMap actually ships it ────────────────────────────────────────
function findConfigMaps(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) findConfigMaps(p, found)
    else if (/registration.*\.ya?ml$|configmap.*registration.*\.ya?ml$/i.test(entry)) {
      const text = readFileSync(p, 'utf8')
      if (/kind:\s*ConfigMap/.test(text) && /manifest\.json:\s*\|/.test(text)) found.push([p, text])
    }
  }
  return found
}

const configMaps = [...findConfigMaps('helm'), ...findConfigMaps('deploy')]
if (configMaps.length === 0) {
  fail(
    'no registration ConfigMap found under helm/ or deploy/ — cannot prove the ' +
      'policy is mounted into the init container'
  )
}

const SUBMITS_POLICY = /apps\/\$\{?SLUG\}?\/policy|apps\/\$SLUG\/policy/

/**
 * Returns the text a ConfigMap key actually ships, resolving BOTH shapes seen in
 * the family: the content inlined as a literal block, or pulled in with
 * `{{ .Files.Get "files/registration/x" }}` from a second copy inside the chart.
 * Both are a duplicate of the file this repo edits, and both can drift from it —
 * which is the failure being guarded against, so either has to be followed.
 */
function shippedContent(cmPath, cmText, key) {
  const lines = cmText.split('\n')
  const start = lines.findIndex(l =>
    new RegExp(`^  ${key.replace('.', '\\.')}:\\s*\\|`).test(l)
  )
  if (start === -1) return null

  const chartDir = cmPath.replace(/[/\\]templates[/\\][^/\\]+$/, '')
  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    const ref = l.match(/\{\{-?\s*\.Files\.Get\s+"([^"]+)"/)
    if (ref) {
      const p = join(chartDir, ref[1])
      return existsSync(p)
        ? { from: p, text: readFileSync(p, 'utf8') }
        : { from: p, text: null }
    }
    if (l.trim() !== '' && !l.startsWith('    ')) break
    body.push(l.replace(/^ {4}/, ''))
  }
  return { from: `${cmPath} (inlined ${key})`, text: body.join('\n') }
}

for (const [path, text] of configMaps) {
  const shipped = shippedContent(path, text, 'policy.json')
  if (!shipped) {
    fail(
      `${path} mounts no policy.json key — registration/policy.json is never mounted ` +
        `into the init container, so it is never submitted to FuzeFront`
    )
    continue
  }
  if (shipped.text === null) {
    fail(`${path} references ${shipped.from}, which does not exist`)
  } else {
    // Compare parsed JSON, not text: indentation and the block-scalar chomp
    // indicator are formatting, the policy is what matters.
    try {
      if (JSON.stringify(JSON.parse(shipped.text)) !== JSON.stringify(policy)) {
        fail(
          `${shipped.from} has DRIFTED from ${POLICY_PATH}. That copy is what actually ` +
            `deploys — re-sync it.`
        )
      }
    } catch (err) {
      fail(`${shipped.from}: not valid JSON — ${err.message}`)
    }
  }

  const sh = shippedContent(path, text, 'register.sh')
  if (!sh || !SUBMITS_POLICY.test(sh.text ?? '')) {
    fail(
      `${path}: the register.sh it ships never PUTs to /apps/{slug}/policy — the ` +
        `policy is mounted but not submitted`
    )
  }
}

// The repo's own copy of the script must agree; it is what a human reads and edits.
if (existsSync('registration/register.sh')) {
  const sh = readFileSync('registration/register.sh', 'utf8')
  if (!SUBMITS_POLICY.test(sh)) {
    fail('registration/register.sh never PUTs the policy to /apps/{slug}/policy')
  }
}

// ── report ────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✖ registration checks failed (${problems.length}):`)
  for (const p of problems) console.error(`    - ${p}`)
  process.exit(1)
}
console.log(
  `✔ registration OK — ${policy.resources.length} resource(s), ${policy.roles.length} ` +
    `role(s), shipped by ${configMaps.length} ConfigMap(s) and submitted by register.sh`
)
