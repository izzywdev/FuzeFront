#!/usr/bin/env node
/**
 * gate-route-ownership — every API path must be implemented by the service the
 * ingress actually routes it to.
 *
 * THE BUG THIS EXISTS TO CATCH
 * ----------------------------
 * The chart's ingress splits `/api` across services by LONGEST-PREFIX match:
 *
 *     /api/apps  ->  fuzefront-applications
 *     /api       ->  fuzefront-backend
 *
 * The app-installation endpoints (`/api/apps/installed`, `/api/apps/:id/install`)
 * were implemented on fuzefront-backend. Every unit test passed, because unit
 * tests mount the router directly into a bare express app and never traverse the
 * ingress. In production nginx handed those paths to fuzefront-applications,
 * which did not implement them, so the entire feature answered 404 — silently,
 * for as long as nobody clicked it.
 *
 * No existing check could see this: type-checking, linting, unit tests and even
 * `helm template | kubeconform` are each individually happy. The defect lives in
 * the SEAM between the chart and the code, so the gate has to look at both.
 *
 * WHAT IT DOES
 * ------------
 *   1. Renders the chart for each values file in deploy/route-ownership.json.
 *   2. Extracts every (path -> service) pair from the rendered Ingress objects.
 *   3. Resolves each contract path by longest-prefix match, exactly as nginx
 *      does, and asserts the winner is the declared `servedBy`.
 *   4. Asserts the declared `implementedIn` router exists and is actually
 *      mounted by the declared `mountedIn` entrypoint.
 *
 * Step 3 alone would catch an ingress edit that moves a prefix. Step 4 alone
 * would catch a router being deleted or unmounted. Only together do they catch
 * the original bug, which was neither of those individually — it was the two
 * drifting apart.
 *
 * Usage:
 *   node scripts/check-route-ownership.mjs
 *   node scripts/check-route-ownership.mjs --rendered <file>   # skip helm
 *
 * `--rendered` checks an already-rendered manifest instead of shelling out to
 * helm. CI uses the helm path; the fixture tests in
 * scripts/__tests__/check-route-ownership.test.mjs use this one, so the parsing
 * and longest-prefix logic is verified on a machine without helm installed.
 *
 * Exit 0 = every contract route is owned and implemented; 1 = mismatch.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const CONTRACT = path.join(REPO_ROOT, 'deploy/route-ownership.json')
const CHART = path.join(REPO_ROOT, 'deploy/helm/fuzefront')

const RED = s => `\x1b[31m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`

/**
 * Extract (path -> serviceName) from rendered chart YAML.
 *
 * Deliberately a line scanner rather than a YAML parse: this script must run
 * with zero npm dependencies (it is a gate; it should not be able to fail
 * because a transitive dep moved). The rendered ingress shape is fixed and
 * machine-generated, so the pairing of a `- path:` with the next `name:` under
 * its `backend.service` is stable.
 */
function extractIngressRoutes(renderedYaml) {
  const docs = renderedYaml.split(/^---$/m)
  const routes = []

  for (const doc of docs) {
    if (!/^\s*kind:\s*Ingress\s*$/m.test(doc)) continue

    // metadata.name renders at indent 2; service names sit deeper, so the
    // anchored two-space match cannot pick one up by accident.
    const ingressName = doc.match(/^ {2}name:\s*(\S+)\s*$/m)?.[1] ?? '(unnamed)'

    const lines = doc.split('\n')
    let pendingPath = null
    let currentHost = null
    for (const line of lines) {
      const hostMatch = line.match(/^\s*-?\s*host:\s*"?([^"\s]+)"?\s*$/)
      if (hostMatch) {
        currentHost = hostMatch[1]
        continue
      }
      const pathMatch = line.match(/^\s*-?\s*path:\s*(\S+)\s*$/)
      if (pathMatch) {
        pendingPath = pathMatch[1]
        continue
      }
      // The first `name:` after a path, inside backend.service, is the target.
      const nameMatch = line.match(/^\s*name:\s*(\S+)\s*$/)
      if (nameMatch && pendingPath !== null) {
        routes.push({
          path: pendingPath,
          service: nameMatch[1],
          host: currentHost,
          ingress: ingressName,
        })
        pendingPath = null
      }
    }
  }
  return routes
}

/**
 * The host the app's own API is served on — the host of the main `fuzefront`
 * Ingress.
 *
 * Resolution MUST be scoped to it. The Authentik ingress publishes `/api/v3`
 * (and `/-`, `/if`, …) pointing at authentik-server; matching paths across
 * hosts would let an unrelated ingress appear to win a prefix it can never
 * actually receive, and report a confident, wrong owner. nginx matches host
 * first, then longest path — so this does too.
 */
function appHost(routes) {
  return routes.find(r => r.ingress === 'fuzefront')?.host ?? null
}

/**
 * Resolve a request path the way the nginx ingress controller does: among all
 * Prefix rules that match, the LONGEST one wins. This is the exact semantic
 * that made `/api/apps/installed` land on applications-service rather than the
 * backend, so it must be modelled faithfully rather than approximated.
 */
function resolveOwner(requestPath, routes, host = undefined) {
  const scope = host === undefined ? appHost(routes) : host
  let best = null
  for (const r of routes) {
    // Only rules published on the app's own host can serve its API.
    if (scope !== null && r.host !== undefined && r.host !== scope) continue
    // Skip regex-style paths (the per-app ingresses use captures); the contract
    // only pins plain `/api/...` prefixes.
    if (/[()\\*$]/.test(r.path)) continue
    if (requestPath === r.path || requestPath.startsWith(r.path.endsWith('/') ? r.path : r.path + '/')) {
      if (!best || r.path.length > best.path.length) best = r
    }
  }
  return best
}

function renderChart(valuesFile) {
  try {
    return execFileSync(
      'helm',
      [
        'template',
        'fuzefront',
        CHART,
        '-f',
        path.join(REPO_ROOT, valuesFile),
        // The chart refuses to render when authentik.oidc is enabled without a
        // client secret, which is a real guard — values-local.yaml relies on a
        // secret supplied at deploy time. Same placeholder helm-validate.yml
        // passes. It touches no Ingress, so it cannot affect what this gate
        // measures; without it the local overlay simply fails to render and the
        // gate reports a helm error instead of a routing answer.
        '--set',
        'secret.authentikClientSecret=ci-placeholder',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (err) {
    console.error(RED(`helm template failed for ${valuesFile}:`))
    console.error(err.stderr?.toString?.() || err.message)
    process.exit(1)
  }
}

// Static patterns. Both were once built with `new RegExp` interpolating the
// contract's file names, which Semgrep flagged as non-literal-regexp / ReDoS.
// The inputs are repo-controlled rather than attacker-controlled, so it was not
// exploitable — but a fixed pattern plus plain string comparison is simply the
// better way to write this, so the finding is removed rather than suppressed.
const IMPORT_LINE = /^\s*import\s+(\w+)[^\n]*?from\s+['"]([^'"]+)['"]/
const APP_USE_CALL = /app\.use\(([^)]*)\)/g

/** Split a call's arguments into identifier-ish tokens for whole-word matching. */
function tokens(text) {
  return text.split(/[^\w$]+/).filter(Boolean)
}

/** Is `routerFile` imported AND mounted by `entrypoint`? */
function isMounted(entrypoint, routerFile) {
  const abs = path.join(REPO_ROOT, entrypoint)
  if (!existsSync(abs)) return { ok: false, reason: `entrypoint ${entrypoint} does not exist` }
  const src = readFileSync(abs, 'utf8')

  // Match the import by module-specifier basename, e.g. './routes/app-installations'.
  const base = path.basename(routerFile).replace(/\.tsx?$/, '')
  let identifier = null
  for (const line of src.split('\n')) {
    const m = line.match(IMPORT_LINE)
    if (m && (m[2] === base || m[2].endsWith('/' + base))) {
      identifier = m[1]
      break
    }
  }
  if (!identifier) return { ok: false, reason: `${entrypoint} does not import ${base}` }

  // The imported identifier must actually be handed to app.use(...).
  for (const call of src.matchAll(APP_USE_CALL)) {
    if (tokens(call[1]).includes(identifier)) return { ok: true }
  }
  return { ok: false, reason: `${entrypoint} imports ${identifier} but never app.use()s it` }
}

function main() {
  if (!existsSync(CONTRACT)) {
    console.error(RED(`missing contract file: ${CONTRACT}`))
    process.exit(1)
  }
  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))
  const failures = []
  let checks = 0

  const renderedIdx = process.argv.indexOf('--rendered')
  const preRendered = renderedIdx !== -1 ? readFileSync(process.argv[renderedIdx + 1], 'utf8') : null
  const valuesFiles = preRendered ? [process.argv[renderedIdx + 1]] : contract.valuesFiles

  for (const valuesFile of valuesFiles) {
    const rendered = preRendered ?? renderChart(valuesFile)
    const routes = extractIngressRoutes(rendered)
    if (routes.length === 0) {
      failures.push(`${valuesFile}: no ingress paths found — the chart shape changed and this gate can no longer see it`)
      continue
    }

    console.log(DIM(`\n${valuesFile} — ${routes.length} ingress path(s)`))

    for (const route of contract.routes) {
      checks++
      const owner = resolveOwner(route.path, routes)
      if (!owner) {
        failures.push(`${valuesFile}: ${route.path} matches no ingress rule (expected ${route.servedBy})`)
        continue
      }
      if (owner.service !== route.servedBy) {
        failures.push(
          `${valuesFile}: ${route.path}\n` +
            `    ingress sends it to : ${RED(owner.service)}  (via prefix "${owner.path}")\n` +
            `    contract expects    : ${route.servedBy}\n` +
            `    implemented in      : ${route.implementedIn}\n` +
            `    -> the route is implemented by a service that does NOT own this path: 404 in every deployed environment.`
        )
        continue
      }
      console.log(`  ${GREEN('ok')} ${route.path} -> ${owner.service} ${DIM(`(prefix "${owner.path}")`)}`)
    }
  }

  // Implementation checks are values-file independent, so run them once.
  console.log(DIM('\nimplementation + mount'))
  for (const route of contract.routes) {
    checks++
    const implAbs = path.join(REPO_ROOT, route.implementedIn)
    if (!existsSync(implAbs)) {
      failures.push(`${route.path}: implementedIn "${route.implementedIn}" does not exist`)
      continue
    }
    const mounted = isMounted(route.mountedIn, route.implementedIn)
    if (!mounted.ok) {
      failures.push(`${route.path}: ${mounted.reason}`)
      continue
    }
    console.log(`  ${GREEN('ok')} ${route.implementedIn} ${DIM(`mounted by ${route.mountedIn}`)}`)
  }

  console.log('')
  if (failures.length) {
    console.error(RED(`gate-route-ownership FAILED (${failures.length} problem(s), ${checks} checks)\n`))
    for (const f of failures) console.error(RED('  ✗ ') + f + '\n')
    console.error(
      DIM(
        'A route must be implemented by the service whose ingress prefix owns its path.\n' +
          'Either move the router to the owning service, or add a more specific ingress\n' +
          'rule — and update deploy/route-ownership.json to match.\n'
      )
    )
    process.exit(1)
  }

  console.log(GREEN(`gate-route-ownership passed — ${checks} checks, every contract route owned and implemented.`))
}

// Exported for scripts/__tests__/check-route-ownership.test.mjs. `main()` runs
// only when this file is executed directly, so importing it has no side effects.
export { extractIngressRoutes, resolveOwner, isMounted, appHost }

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (invokedDirectly) main()
