#!/usr/bin/env node
/**
 * Portal federation health census — "is each product's UI actually loading in
 * the FuzeFront portal, yes or no?", answered per app, automatically.
 *
 * WHY THIS EXISTS. Nothing in this repo could answer that question before this
 * script. Every prior signal was about WORKFLOW status (did the CI job go
 * green) — none of them asked the running product "does your module actually
 * load", and none of them noticed when a product silently stopped being
 * returned by the registry at all. The owner's own words: "only 13 of 18
 * products are listed [in the portal]" and "you should have a mechanism to
 * figure it out yourself if they are working or not."
 *
 * WHAT "HEALTHY" MEANS HERE, and why it goes one step further than
 * backend/src/routes/appHealth.ts (PR #806). That module fixed the check that
 * called a 404 "healthy" — a real improvement — but it still only proves the
 * ENTRY FILE is real JavaScript. It is entirely possible for remoteEntry.js to
 * return 200 + a correct JS content-type while every chunk it references
 * 404s: the four-layer path contract (manifest remoteEntry / build
 * base+assetsDir / Ingress path / nginx location+alias) can disagree in a way
 * that serves the entry correctly and breaks everything the entry imports.
 * That is THE signature failure of this system — a green healthcheck behind a
 * blank panel — and it is invisible to any check that fetches only one URL.
 * So this script does what scripts/check-federated-assets.mjs already proved
 * out for a single remote (commit ddf92349, "assert federated CHUNKS load"),
 * but for every app the registry returns, not one hardcoded remote, and adds
 * the fleet-level question that check never asked: which EXPECTED app is
 * simply not there any more.
 *
 * ENUMERATION SOURCE: GET /api/v1/app-registry/apps (backend/applications/src/
 * app-registry/service.ts — the system of record; CLAUDE.md is explicit that
 * this, not the legacy /api/apps route, is what stores `slug` verbatim). It
 * returns `slug` and the full manifest (including `integration.remoteEntry` /
 * `integration.url`) directly, so the same identity that already exists as a
 * GitHub secret for post-prod-e2e.yml (POST_PROD_EMAIL/POST_PROD_PASSWORD) can
 * be reused here with zero new secrets — see the coverage caveat below.
 *
 * RESOLUTION: frontend/src/utils/loadFederatedApp.ts:71 is the ENTIRE
 * mechanism the host uses to resolve a remote:
 *
 *     const resolved = new URL(remoteEntry, origin)
 *
 * This script resolves remote entries the exact same way, against the same
 * portal origin (--base-url, default https://app.fuzefront.com) a real
 * browser would use — anything else would let this script pass on a
 * resolution the browser cannot reproduce.
 *
 * COVERAGE CAVEAT — read before trusting a MISSING row as gospel. The v1
 * registry's visibility rule (canRead in service.ts) shows a caller only apps
 * that are public/marketplace, org-less, or owned by an org the caller
 * belongs to — UNLESS the caller is a platform admin, which bypasses all of
 * that. Every product manifest in this fleet registers as `organization` or
 * `private` visibility (docs/planning/production-conformance.md), so a caller
 * that is not a platform admin and not a member of every product's owning org
 * WILL under-enumerate the registry — indistinguishably from that app not
 * existing. This script cannot tell those two apart from outside; it can only
 * name the identity it authenticated as, print how many apps it saw, and let
 * a human judge a MISSING row against that. Full, unambiguous coverage needs
 * either: (a) the POST_PROD_EMAIL/POST_PROD_PASSWORD account granted the
 * platform `admin` role, or (b) a CONSUMER_REGISTRATION_SECRET-style bearer
 * (see backend/applications/src/middleware/consumer-auth.ts — currently unset
 * in prod per its own comment) supplied via --token. This script cannot grant
 * either from here — no prod DB/Permit access from this environment — so it
 * is named here rather than silently assumed away.
 *
 * USAGE
 *   node scripts/check-portal-federation-health.mjs \
 *     --base-url https://app.fuzefront.com \
 *     --api-url  https://app.fuzefront.com \
 *     --expected scripts/expected-portal-apps.json \
 *     [--email <e> --password <p> | --token <bearer>]
 *
 * Env fallbacks (no flag needed in CI): PORTAL_HEALTH_BASE_URL,
 * PORTAL_HEALTH_API_URL, PORTAL_HEALTH_EXPECTED, PORTAL_HEALTH_EMAIL /
 * PORTAL_HEALTH_PASSWORD (falling back to POST_PROD_EMAIL / POST_PROD_PASSWORD
 * so the existing post-prod-e2e secrets work with no new setup),
 * PORTAL_HEALTH_TOKEN.
 *
 * EXIT CODE: non-zero if ANY app fails its probe, ANY expected app is missing
 * from the registry, the registry returns zero apps at all (anti-vacuity —
 * matches check-federated-assets.mjs's stance that a check which examined
 * nothing must never print a pass), or the run could not authenticate /
 * enumerate at all. There is no `|| true` anywhere in this file or its caller;
 * a real failure here must fail the workflow.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const JS_CONTENT_TYPE = /\b(?:java|ecma)script\b/i
const HTML_CONTENT_TYPE = /text\/html/i
const LOOKS_LIKE_HTML = /^\s*(?:<!doctype\s+html|<html\b)/i
const MAX_CHUNKS_PER_APP = 20
// Mutable, set once from --timeout-ms/PORTAL_HEALTH_TIMEOUT_MS in main().
// 10s is tight for a cold prod login over GitHub-hosted egress, and being
// able to raise it is how an operator tells "slow" apart from "down" --
// which is exactly what the sign-in failure message tells them to do.
let FETCH_TIMEOUT_MS = 10_000

function fail(msg) {
  console.error(`::error title=Portal federation health::${msg}`)
}
function warn(msg) {
  console.error(`::warning title=Portal federation health::${msg}`)
}

function parseArgs(argv) {
  const a = {
    baseUrl: process.env.PORTAL_HEALTH_BASE_URL || 'https://app.fuzefront.com',
    apiUrl: process.env.PORTAL_HEALTH_API_URL || null, // defaults to baseUrl below
    expectedPath:
      process.env.PORTAL_HEALTH_EXPECTED ||
      path.join(__dirname, 'expected-portal-apps.json'),
    email: process.env.PORTAL_HEALTH_EMAIL || process.env.POST_PROD_EMAIL || null,
    password:
      process.env.PORTAL_HEALTH_PASSWORD || process.env.POST_PROD_PASSWORD || null,
    token: process.env.PORTAL_HEALTH_TOKEN || null,
    timeoutMs: Number(process.env.PORTAL_HEALTH_TIMEOUT_MS) || 10_000,
  }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    const next = () => argv[++i]
    if (v === '--base-url') a.baseUrl = next()
    else if (v === '--api-url') a.apiUrl = next()
    else if (v === '--expected') a.expectedPath = next()
    else if (v === '--email') a.email = next()
    else if (v === '--password') a.password = next()
    else if (v === '--token') a.token = next()
    else if (v === '--timeout-ms') a.timeoutMs = Number(next())
    else if (v === '--help' || v === '-h') {
      console.log(
        'usage: check-portal-federation-health.mjs --base-url <url> [--api-url <url>] [--expected <path>] [--email <e> --password <p> | --token <bearer>] [--timeout-ms <n>]'
      )
      process.exit(0)
    }
  }
  if (!a.apiUrl) a.apiUrl = a.baseUrl
  a.baseUrl = a.baseUrl.replace(/\/+$/, '')
  a.apiUrl = a.apiUrl.replace(/\/+$/, '')
  return a
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Same extraction approach as scripts/check-federated-assets.mjs, deliberately
 * kept in lock-step: broad regex over quoted `.js`/`.mjs` specifiers rather than
 * encoding one bundler's emit shape, because a false candidate costs one HTTP
 * request and a missed chunk costs the whole point of the check. */
function extractChunkSpecifiers(src) {
  const out = new Set()
  for (const m of src.matchAll(/['"`]([^'"`\s]+?\.m?js)['"`]/g)) {
    const spec = m[1]
    if (spec.startsWith('data:') || spec.startsWith('blob:')) continue
    out.add(spec)
  }
  return [...out]
}

/**
 * Fetch a URL and classify it as real JS, an HTML-disguised-as-200 ("the 200
 * that isn't" — an SPA fallback answering for a file that does not exist), or
 * broken. Returns { ok, status, detail }.
 */
async function probeJsAsset(url) {
  let response
  try {
    response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/javascript,text/javascript,*/*' },
    })
  } catch (err) {
    return { ok: false, status: null, detail: `network error: ${err.message}`, body: null }
  }

  if (response.status !== 200) {
    return { ok: false, status: response.status, detail: `HTTP ${response.status}`, body: null }
  }

  const contentType = response.headers.get('content-type') || ''

  if (HTML_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      status: 200,
      detail: `200 but content-type is '${contentType}' — SPA fallback answering for a file that does not exist`,
      body: null,
    }
  }

  let body = null
  if (JS_CONTENT_TYPE.test(contentType)) {
    // Content-type already settles it for the entry itself, but callers that
    // need to parse chunk specifiers out of the body still read it — reading
    // is on them; we do not download speculatively here.
    return { ok: true, status: 200, detail: 'OK', body: null, contentType }
  }

  // Inconclusive content-type: sniff the body, same rule as appHealth.ts /
  // check-federated-assets.mjs.
  try {
    body = await response.text()
  } catch (err) {
    return { ok: false, status: 200, detail: `200 but body unreadable: ${err.message}`, body: null }
  }
  if (LOOKS_LIKE_HTML.test(body)) {
    return {
      ok: false,
      status: 200,
      detail: `200 with content-type '${contentType || 'none'}' and an HTML body — SPA fallback`,
      body: null,
    }
  }
  return {
    ok: false,
    status: 200,
    detail: `200 with content-type '${contentType || 'none'}', not JavaScript`,
    body: null,
  }
}

/** Fetch + read body (for the entry, where we always need the body to find chunks). */
async function probeEntryWithBody(url) {
  let response
  try {
    response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/javascript,text/javascript,*/*' },
    })
  } catch (err) {
    return { ok: false, status: null, detail: `network error: ${err.message}`, body: null }
  }
  if (response.status !== 200) {
    return { ok: false, status: response.status, detail: `remoteEntry returned HTTP ${response.status}`, body: null }
  }
  const contentType = response.headers.get('content-type') || ''
  let body
  try {
    body = await response.text()
  } catch (err) {
    return { ok: false, status: 200, detail: `remoteEntry body unreadable: ${err.message}`, body: null }
  }
  if (HTML_CONTENT_TYPE.test(contentType) || LOOKS_LIKE_HTML.test(body)) {
    return {
      ok: false,
      status: 200,
      detail: `remoteEntry returned 200 but is HTML (content-type '${contentType || 'none'}') — SPA fallback answering a 404 with 200`,
      body: null,
    }
  }
  if (!JS_CONTENT_TYPE.test(contentType) && !/^\s*[({!\[]|^\s*(?:var|const|let|"use strict")/.test(body)) {
    // Neither the header nor a light body heuristic look like JS. Still treat
    // as a soft pass-through to chunk extraction rather than failing outright
    // here — extractChunkSpecifiers finding zero chunks is what fails a truly
    // non-JS body, and this avoids false negatives on unusual-but-valid
    // minified output that happens not to start with a familiar token.
  }
  return { ok: true, status: 200, detail: 'OK', body, contentType }
}

/**
 * Probe one app's rendering surface. Returns { result: 'PASS'|'FAIL', detail, checked }.
 */
async function probeApp(app, baseUrl) {
  const integration = app.manifest?.integration || {}
  const type = integration.type

  if (type === 'module-federation') {
    const raw = (integration.remoteEntry || '').trim()
    if (!raw) {
      return { result: 'FAIL', detail: 'module-federation app has no integration.remoteEntry', checked: [] }
    }
    let entryUrl
    try {
      // Same resolution as frontend/src/utils/loadFederatedApp.ts:71 —
      // `new URL(remoteEntry, origin)`.
      entryUrl = new URL(raw, baseUrl).toString()
    } catch (err) {
      return { result: 'FAIL', detail: `remoteEntry '${raw}' does not resolve against ${baseUrl}: ${err.message}`, checked: [] }
    }

    const entry = await probeEntryWithBody(entryUrl)
    if (!entry.ok) {
      return { result: 'FAIL', detail: `${entryUrl} — ${entry.detail}`, checked: [entryUrl] }
    }

    const specs = extractChunkSpecifiers(entry.body)
    if (specs.length === 0) {
      // Anti-vacuity, same stance as check-federated-assets.mjs: a
      // module-federation container that references zero loadable chunks
      // means the extractor broke or the remote exposes nothing — either
      // way this is not a pass.
      return {
        result: 'FAIL',
        detail: `remoteEntry loads (${entryUrl}) but references ZERO chunks — the module exposes nothing, or the extractor no longer recognises this bundler's emit shape`,
        checked: [entryUrl],
      }
    }

    const checked = [entryUrl]
    const toCheck = specs.slice(0, MAX_CHUNKS_PER_APP)
    const brokenChunks = []
    for (const spec of toCheck) {
      // Chunk specifiers are relative to remoteEntry.js's OWN url, not the app
      // base — the assetsDir:'' subtlety check-federated-assets.mjs exists to
      // enforce, reused verbatim here.
      let chunkUrl
      try {
        chunkUrl = new URL(spec, entryUrl).toString()
      } catch {
        continue
      }
      checked.push(chunkUrl)
      const chunk = await probeJsAsset(chunkUrl)
      if (!chunk.ok) {
        brokenChunks.push(`${spec} -> ${chunkUrl}: ${chunk.detail}`)
      }
    }

    if (brokenChunks.length > 0) {
      return {
        result: 'FAIL',
        detail: `remoteEntry loads but ${brokenChunks.length}/${toCheck.length} referenced chunk(s) do not: ${brokenChunks.join(' | ')}`,
        checked,
      }
    }
    return {
      result: 'PASS',
      detail: `remoteEntry + ${toCheck.length} chunk(s) all load as JavaScript`,
      checked,
    }
  }

  // iframe / spa / web-component: a document boundary, not a shared JS
  // runtime — require the app's own URL to answer with < 400, same rule as
  // backend/src/routes/appHealth.ts for non-federated apps.
  const raw = (integration.url || '').trim()
  if (!raw) {
    return { result: 'FAIL', detail: `${type} app has no integration.url`, checked: [] }
  }
  let target
  try {
    target = new URL(raw, baseUrl).toString()
  } catch (err) {
    return { result: 'FAIL', detail: `integration.url '${raw}' does not resolve: ${err.message}`, checked: [] }
  }
  let response
  try {
    response = await fetchWithTimeout(target, { headers: { Accept: 'text/html,application/json' } })
  } catch (err) {
    return { result: 'FAIL', detail: `${target} — network error: ${err.message}`, checked: [target] }
  }
  if (response.status >= 400) {
    return { result: 'FAIL', detail: `${target} returned HTTP ${response.status}`, checked: [target] }
  }
  return { result: 'PASS', detail: `${target} returned HTTP ${response.status}`, checked: [target] }
}

async function login(apiUrl, email, password) {
  const resp = await fetchWithTimeout(`${apiUrl}/api/v1/security/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (resp.status !== 200) {
    let bodyText = ''
    try {
      bodyText = await resp.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `POST /api/v1/security/session -> HTTP ${resp.status} (credential rejected or backend error). Body: ${bodyText.slice(0, 300)}`
    )
  }
  const body = await resp.json()
  if (!body.token) throw new Error('login succeeded but response carried no token')
  return { token: body.token, whoami: email }
}

/** Enumerate every app the registry returns for this caller, following the
 * keyset cursor to exhaustion (GET /api/v1/app-registry/apps, limit=200 —
 * the service's MAX_LIMIT). */
async function listAllApps(apiUrl, token) {
  const apps = []
  let cursor = null
  let pages = 0
  const MAX_PAGES = 25 // guard against a pagination bug looping forever
  do {
    const url = new URL(`${apiUrl}/api/v1/app-registry/apps`)
    url.searchParams.set('limit', '200')
    if (cursor) url.searchParams.set('cursor', cursor)
    const resp = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (resp.status !== 200) {
      let bodyText = ''
      try {
        bodyText = await resp.text()
      } catch {
        /* ignore */
      }
      throw new Error(`GET ${url} -> HTTP ${resp.status}. Body: ${bodyText.slice(0, 300)}`)
    }
    const body = await resp.json()
    apps.push(...(body.apps || []))
    cursor = body.nextCursor || null
    pages++
  } while (cursor && pages < MAX_PAGES)
  return apps
}

function loadExpected(expectedPath) {
  const raw = readFileSync(expectedPath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed.apps) || parsed.apps.length === 0) {
    throw new Error(`${expectedPath} declares zero expected apps — refusing to run with an empty roster (that would silently disable the missing-app check)`)
  }
  return parsed.apps
}

function printTable(rows) {
  const cols = ['SLUG', 'NAME', 'STATUS', 'RESULT', 'DETAIL']
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map(r => String(r[i] ?? '').length))
  )
  const line = arr => arr.map((v, i) => String(v).padEnd(widths[i])).join('  ')
  console.log(line(cols))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(r))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (Number.isFinite(args.timeoutMs) && args.timeoutMs > 0) {
    FETCH_TIMEOUT_MS = args.timeoutMs
  }
  const expected = loadExpected(args.expectedPath)

  let token = args.token
  let whoami = '(pre-supplied token)'
  if (!token) {
    if (!args.email || !args.password) {
      fail(
        'no credentials: set --token, or --email/--password (env PORTAL_HEALTH_EMAIL/PORTAL_HEALTH_PASSWORD, falling back to POST_PROD_EMAIL/POST_PROD_PASSWORD)'
      )
      process.exitCode = 1
      return
    }
    // Wrapped for the same reason listAllApps below is. An unwrapped failure
    // here reaches the bottom-of-file catch, which can only say
    // "AbortError: This operation was aborted" -- no phase, no URL, no timeout
    // value. That is what the first production run of this census actually
    // printed: it failed honestly, which is right, but told nobody WHAT failed,
    // which defeats the point of building it.
    try {
      const loggedIn = await login(args.apiUrl, args.email, args.password)
      token = loggedIn.token
      whoami = loggedIn.whoami
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      fail(
        aborted
          ? `could not sign in to ${args.apiUrl}: no response within ${FETCH_TIMEOUT_MS}ms. ` +
            'The portal API did not answer in time -- it is unreachable, or slower than the timeout. ' +
            'Raise --timeout-ms to distinguish "slow" from "down"; do not assume the apps are healthy.'
          : `could not sign in to ${args.apiUrl}: ${err.message}`
      )
      process.exitCode = 1
      return
    }
  }

  let apps
  try {
    apps = await listAllApps(args.apiUrl, token)
  } catch (err) {
    fail(`could not enumerate the registry: ${err.message}`)
    process.exitCode = 1
    return
  }

  console.log(
    `Portal federation health census — ${args.apiUrl} (resolving remotes against ${args.baseUrl}), authenticated as ${whoami}`
  )
  console.log(`Registry returned ${apps.length} app(s) visible to this identity.\n`)

  // Anti-vacuity: zero apps returned is never a silent pass, even before
  // consulting the expected list — a check that examined nothing must not
  // print green. (Matches check-federated-assets.mjs's zero-chunks stance.)
  if (apps.length === 0) {
    fail(
      'the registry returned ZERO apps for this identity. Either the registry is genuinely empty (very unlikely) or this identity cannot see anything — either way this is not evidence of health.'
    )
    process.exitCode = 1
  }

  const bySlug = new Map(apps.map(a => [a.slug, a]))
  const rows = []
  let anyFail = apps.length === 0

  for (const app of apps) {
    const name = app.manifest?.name || '(no name)'
    if (app.status !== 'activated') {
      rows.push([app.slug, name, app.status, 'FAIL', `registered but status='${app.status}' — not activated, so it is NOT shown in the portal menu`])
      anyFail = true
      fail(`${app.slug}: status='${app.status}', not activated — absent from the portal menu regardless of module health`)
      continue
    }
    const probe = await probeApp(app, args.baseUrl)
    rows.push([app.slug, name, app.status, probe.result, probe.detail])
    if (probe.result !== 'PASS') {
      anyFail = true
      fail(`${app.slug} (${name}): ${probe.detail}`)
    }
  }

  // Expected-but-absent: this is the '13 of 18' check. A slug in the roster
  // that never appeared in `apps` at all — regardless of status — is reported
  // as its own row rather than just being a shorter table.
  for (const exp of expected) {
    if (!bySlug.has(exp.slug)) {
      rows.push([exp.slug, exp.name, '(absent)', 'MISSING', `expected app not returned by the registry at all (confidence: ${exp.confidence}, source: ${exp.source})`])
      anyFail = true
      fail(`${exp.slug} (${exp.name}): expected but ABSENT from the registry response — this is the failure mode a hardcoded list cannot catch`)
    }
  }

  // Reverse direction: an app the registry has that the roster does not know
  // about. Not a failure — just a prompt to keep the checked-in list current.
  const expectedSlugs = new Set(expected.map(e => e.slug))
  for (const app of apps) {
    if (!expectedSlugs.has(app.slug)) {
      warn(`${app.slug} is in the registry but not in scripts/expected-portal-apps.json — if this is a real product, add it there`)
    }
  }

  console.log()
  printTable(rows)
  console.log()

  const passCount = rows.filter(r => r[3] === 'PASS').length
  const failCount = rows.filter(r => r[3] === 'FAIL').length
  const missingCount = rows.filter(r => r[3] === 'MISSING').length
  console.log(`${passCount} PASS, ${failCount} FAIL, ${missingCount} MISSING (of ${expected.length} expected).`)

  if (anyFail) {
    console.error('\nportal federation health: FAILED — see rows above and the ::error annotations.')
    process.exitCode = 1
  } else {
    console.log('\nportal federation health: OK — every expected app is registered, activated, and its module (+ at least one chunk) loads as JavaScript.')
  }
}

main().catch(err => {
  // Last resort only. Every EXPECTED failure path above reports its own phase,
  // URL and cause; reaching here means something genuinely unanticipated
  // happened, so print the stack rather than a one-line message.
  const aborted = err?.name === 'AbortError'
  fail(
    aborted
      ? `timed out with no phase reported (${FETCH_TIMEOUT_MS}ms). This is a gap in this script's own ` +
        'error handling -- whichever call aborted should be wrapped with a diagnostic naming it.\n' +
        (err.stack || '')
      : `unhandled error: ${err.stack || err.message}`
  )
  process.exitCode = 1
})
