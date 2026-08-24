#!/usr/bin/env node
/**
 * Ask the LIVE host, for every registered remote, the only question that matters:
 * would the browser actually get a working module here?
 *
 * WHY THIS EXISTS. Nothing in this repo checks federation against production.
 * `prod-smoke.yml` polls a health endpoint; `post-prod-e2e.yml` drives flows;
 * `e2e.yml` runs scripts/check-federated-assets.mjs but only against a locally
 * built preview. So the one failure the shell is most prone to — a remote whose
 * entry or chunks 404 in prod while every green check in the pipeline describes
 * a different artifact — had no detector at all. The portal reported these apps
 * as HEALTHY the whole time, because backend/src/routes/apps.ts:206 treats any
 * status < 500 as healthy, 404 included.
 *
 * WHAT IT DOES NOT ASSUME. The serve path is a free variable (see CLAUDE.md,
 * "slug, display name, and the federated serve path are THREE INDEPENDENT
 * questions"). Repos legitimately differ: most publish
 * `/apps/<slug>/remoteEntry.js` (Vite `assetsDir: ''`), while FuzeFront's own
 * fuzequality publishes `/apps/<slug>/assets/remoteEntry.js`. So each app is
 * probed at BOTH candidates and the report names which one answered — the probe
 * DISCOVERS the layout instead of re-asserting the convention it is meant to
 * check. An app answering at neither is the finding.
 *
 * Chunk verification is delegated to scripts/check-federated-assets.mjs, which
 * already encodes the two subtleties that make this test real rather than a
 * re-derivation of config: chunk specifiers resolve against remoteEntry.js's
 * OWN url, and an SPA fallback answering a missing chunk with 200 + HTML is the
 * 404 it really is.
 *
 *   node scripts/probe-prod-federation.mjs --base <url> --slugs a,b,c
 *
 * Exits non-zero if ANY app fails, or if ZERO apps were probed — a probe that
 * checks nothing must never report success.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHECKER = join(__dirname, 'check-federated-assets.mjs')

const args = process.argv.slice(2)
const argOf = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

const base = (argOf('--base') || 'https://app.fuzefront.com').replace(/\/+$/, '')
const slugs = (argOf('--slugs') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (slugs.length === 0) {
  console.error('::error title=Prod federation probe::No slugs given — refusing to report success on an empty probe.')
  process.exit(2)
}

const JS_CT = /(javascript|ecmascript|text\/jsx?)/i
const HTML_CT = /text\/html/i

async function head(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    const ct = res.headers.get('content-type') || ''
    // Read a small prefix: enough to tell a module from an SPA shell without
    // pulling whole bundles for 18 apps.
    const body = (await res.text()).slice(0, 400)
    return { status: res.status, ct, body }
  } catch (err) {
    return { status: 0, ct: '', body: '', error: err.message }
  }
}

function verdictFor({ status, ct, body, error }) {
  if (error) return { ok: false, why: `network error: ${error}` }
  if (status !== 200) return { ok: false, why: `HTTP ${status}` }
  if (HTML_CT.test(ct) || /^\s*<(!doctype|html)/i.test(body)) {
    return { ok: false, why: `HTTP 200 but HTML — SPA fallback, not a module` }
  }
  if (!JS_CT.test(ct)) return { ok: false, why: `HTTP 200 but content-type '${ct || 'none'}'` }
  return { ok: true, why: 'entry served as JS' }
}

function runChecker(entryUrl) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CHECKER, entryUrl, '--origin', base], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (out += d))
    p.on('close', code => resolve({ code, out: out.trim() }))
  })
}

const rows = []
let failures = 0

for (const slug of slugs) {
  // Both layouts are legitimate; discover which one this app uses.
  const candidates = [
    `${base}/apps/${slug}/remoteEntry.js`,
    `${base}/apps/${slug}/assets/remoteEntry.js`,
  ]

  let served = null
  const attempts = []
  for (const url of candidates) {
    const res = await head(url)
    const v = verdictFor(res)
    attempts.push(`${url.replace(base, '')} -> ${v.why}`)
    if (v.ok) {
      served = url
      break
    }
  }

  if (!served) {
    failures++
    rows.push({ slug, entry: '—', chunks: '—', status: '❌ entry', detail: attempts.join(' ; ') })
    console.error(`::error title=${slug}::no remoteEntry served. ${attempts.join(' ; ')}`)
    continue
  }

  const { code, out } = await runChecker(served)
  if (code === 0) {
    rows.push({ slug, entry: served.replace(base, ''), chunks: 'all 200 + JS', status: '✅', detail: '' })
  } else {
    failures++
    rows.push({
      slug,
      entry: served.replace(base, ''),
      chunks: 'BROKEN',
      status: '❌ chunks',
      detail: out.split('\n').slice(0, 4).join(' ; '),
    })
    console.error(`::error title=${slug}::entry serves but chunks fail. ${out.split('\n')[0] || ''}`)
  }
}

const table = [
  `### Prod federation probe — ${base}`,
  '',
  `Probed **${slugs.length}** app(s). **${slugs.length - failures} ok / ${failures} broken.**`,
  '',
  '| app | entry path served | chunks | result | detail |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| \`${r.slug}\` | \`${r.entry}\` | ${r.chunks} | ${r.status} | ${r.detail.slice(0, 180)} |`),
  '',
  '`❌ entry` = neither candidate path served a JS module — the remote is not being served at all.',
  '`❌ chunks` = the entry serves but something it imports 404s or returns HTML, which is the failure',
  'that renders a blank panel while every healthcheck stays green.',
].join('\n')

console.log(table)

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n')
}

if (failures > 0) {
  console.error(`::error title=Prod federation probe::${failures} of ${slugs.length} app(s) would not load in the browser.`)
  process.exit(1)
}
