#!/usr/bin/env node
/**
 * Self-test for check-portal-federation-health.mjs.
 *
 * WHY THIS FILE EXISTS. Production is not reachable from a dev/CI sandbox for
 * this change (this session's egress proxy 403s CONNECT to app.fuzefront.com),
 * so "it passes against a clean tree" is not available as evidence and would
 * not be evidence anyway — a vacuous check passes against everything. What
 * this proves instead: the checker actually goes RED on inputs it is
 * specifically supposed to catch. Each fixture below is a tiny local HTTP
 * server standing in for the registry API + the federated remotes it
 * describes — no network egress, no prod credentials.
 *
 * Covers, per the task's hard requirement:
 *   - a 404 remoteEntry                              -> FAIL, exit 1
 *   - an HTML body served WITH a JS content-type      -> FAIL, exit 1
 *   - an expected app missing from the registry       -> FAIL, exit 1
 * plus a healthy baseline (PASS, exit 0) — proving this doesn't just always
 * fail, which would be exactly as useless as never failing.
 *
 * Run: node scripts/check-portal-federation-health.selftest.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, 'check-portal-federation-health.mjs')

/** Minimal fixture server: fakes the app-registry list + login endpoints, and
 * serves arbitrary fixed responses for any other path from `routes`. */
function startFixtureServer({ apps, routes, buildSha }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')

    if (req.method === 'POST' && url.pathname === '/api/v1/security/session') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', token: 'selftest-token' }))
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/app-registry/apps') {
      // `buildSha: undefined` deliberately sends NO header at all, standing in
      // for a service that predates build stamping — a distinct case from a
      // service reporting the literal string 'unknown'.
      const headers = { 'Content-Type': 'application/json' }
      if (buildSha !== undefined) headers['X-Fuze-Build'] = buildSha
      res.writeHead(200, headers)
      res.end(JSON.stringify({ apps, nextCursor: null }))
      return
    }

    const route = routes[url.pathname]
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found in fixture')
      return
    }
    res.writeHead(route.status, { 'Content-Type': route.contentType ?? 'application/octet-stream' })
    res.end(route.body ?? '')
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function writeExpected(dir, apps) {
  const p = path.join(dir, 'expected.json')
  writeFileSync(p, JSON.stringify({ _meta: { purpose: 'selftest fixture' }, apps }), 'utf8')
  return p
}

/**
 * MUST be async `spawn`, not `spawnSync`. The fixture server lives in this
 * same process/event loop; `spawnSync` blocks that event loop synchronously
 * until the child exits, which means the child's requests back to our own
 * fixture server would never be serviced — a self-deadlock that resolves only
 * when the child's own fetch timeout fires. (Caught by running this exact
 * setup during development: every test hung for exactly FETCH_TIMEOUT_MS
 * before failing, which is the tell.)
 */
function runChecker({ baseUrl, expectedPath, useToken, expectedBuild }) {
  const args = [SCRIPT, '--base-url', baseUrl, '--api-url', baseUrl, '--expected', expectedPath]
  if (expectedBuild) args.push('--expected-build', expectedBuild)
  if (useToken) {
    args.push('--token', 'selftest-token')
  } else {
    args.push('--email', 'selftest@example.test', '--password', 'irrelevant')
  }
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => (stdout += c))
    child.stderr.on('data', c => (stderr += c))
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

let tmpDir
test.beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'portal-fed-health-'))
})
test.afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('HEALTHY baseline: a real MF app (entry + chunk) and a real iframe app both PASS, exit 0', async () => {
  const server = await startFixtureServer({
    apps: [
      {
        slug: 'demo-mf',
        status: 'activated',
        manifest: { name: 'Demo MF', integration: { type: 'module-federation', remoteEntry: '/apps/demo-mf/remoteEntry.js' } },
      },
      {
        slug: 'demo-iframe',
        status: 'activated',
        manifest: { name: 'Demo Iframe', integration: { type: 'iframe', url: '/apps/demo-iframe/' } },
      },
    ],
    routes: {
      '/apps/demo-mf/remoteEntry.js': {
        status: 200,
        contentType: 'application/javascript',
        body: 'import("./chunk-abc.js");',
      },
      '/apps/demo-mf/chunk-abc.js': { status: 200, contentType: 'application/javascript', body: 'console.log(1)' },
      '/apps/demo-iframe/': { status: 200, contentType: 'text/html', body: '<html>ok</html>' },
    },
  })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'demo-mf', name: 'Demo MF', confidence: 'verified', source: 'selftest' },
      { slug: 'demo-iframe', name: 'Demo Iframe', confidence: 'verified', source: 'selftest' },
    ])
    const { status, stdout } = await runChecker({ baseUrl, expectedPath })
    assert.equal(status, 0, `expected exit 0 on a healthy fixture, got ${status}. stdout:\n${stdout}`)
    assert.match(stdout, /demo-mf\s+Demo MF\s+activated\s+PASS/)
    assert.match(stdout, /demo-iframe\s+Demo Iframe\s+activated\s+PASS/)
    assert.match(stdout, /0 FAIL, 0 MISSING/)
  } finally {
    server.close()
  }
})

test('BROKEN INPUT 1/3: a 404 remoteEntry FAILS the app and exits non-zero', async () => {
  const server = await startFixtureServer({
    apps: [
      {
        slug: 'demo-404',
        status: 'activated',
        manifest: { name: 'Demo 404', integration: { type: 'module-federation', remoteEntry: '/apps/demo-404/remoteEntry.js' } },
      },
    ],
    routes: {}, // nothing registered -> the fixture server 404s everything
  })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'demo-404', name: 'Demo 404', confidence: 'verified', source: 'selftest' },
    ])
    const { status, stdout, stderr } = await runChecker({ baseUrl, expectedPath, useToken: true })
    assert.notEqual(status, 0, 'a 404 remoteEntry must fail the run, not pass it')
    assert.match(stdout, /demo-404\s+Demo 404\s+activated\s+FAIL/)
    assert.match(stdout + stderr, /HTTP 404/)
  } finally {
    server.close()
  }
})

test('BROKEN INPUT 2/3: an HTML body served WITH a JS content-type FAILS (the header lied)', async () => {
  const server = await startFixtureServer({
    apps: [
      {
        slug: 'demo-spoof',
        status: 'activated',
        manifest: { name: 'Demo Spoof', integration: { type: 'module-federation', remoteEntry: '/apps/demo-spoof/remoteEntry.js' } },
      },
    ],
    routes: {
      // The header says JavaScript; the bytes are an HTML fallback page. A
      // checker that trusts content-type alone would call this healthy.
      '/apps/demo-spoof/remoteEntry.js': {
        status: 200,
        contentType: 'application/javascript',
        body: '<!doctype html><html><body>portal shell fallback</body></html>',
      },
    },
  })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'demo-spoof', name: 'Demo Spoof', confidence: 'verified', source: 'selftest' },
    ])
    const { status, stdout } = await runChecker({ baseUrl, expectedPath, useToken: true })
    assert.notEqual(status, 0, 'an HTML body behind a JS content-type must fail, not pass')
    assert.match(stdout, /demo-spoof\s+Demo Spoof\s+activated\s+FAIL/)
    assert.match(stdout, /is HTML|SPA fallback/i)
  } finally {
    server.close()
  }
})

test('BROKEN INPUT 3/3: an expected app absent from the registry is reported MISSING and fails the run', async () => {
  const server = await startFixtureServer({
    apps: [
      {
        slug: 'present-app',
        status: 'activated',
        manifest: { name: 'Present', integration: { type: 'module-federation', remoteEntry: '/apps/present-app/remoteEntry.js' } },
      },
      // 'ghost-app' is intentionally never returned — simulating a product
      // that quietly dropped out of the registry (the 13-of-18 symptom).
    ],
    routes: {
      '/apps/present-app/remoteEntry.js': { status: 200, contentType: 'application/javascript', body: 'import("./c.js")' },
      '/apps/present-app/c.js': { status: 200, contentType: 'application/javascript', body: '1' },
    },
  })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'present-app', name: 'Present', confidence: 'verified', source: 'selftest' },
      { slug: 'ghost-app', name: 'Ghost', confidence: 'verified', source: 'selftest' },
    ])
    const { status, stdout } = await runChecker({ baseUrl, expectedPath, useToken: true })
    assert.notEqual(status, 0, 'a missing expected app must fail the run, not produce a silently shorter table')
    assert.match(stdout, /present-app\s+Present\s+activated\s+PASS/)
    assert.match(stdout, /ghost-app\s+Ghost\s+\(absent\)\s+MISSING/)
    assert.match(stdout, /1 MISSING/)
  } finally {
    server.close()
  }
})

test('ANTI-VACUITY: a registry returning zero apps is a FAIL, never a silent pass', async () => {
  const server = await startFixtureServer({ apps: [], routes: {} })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'anything', name: 'Anything', confidence: 'verified', source: 'selftest' },
    ])
    const { status, stdout, stderr } = await runChecker({ baseUrl, expectedPath, useToken: true })
    assert.notEqual(status, 0, 'zero apps returned must never exit 0')
    assert.match(stdout + stderr, /ZERO apps/)
  } finally {
    server.close()
  }
})

// ---------------------------------------------------------------------------
// DEPLOY DRIFT (--expected-build)
//
// The 2026-09-07 finding this was built for: migrations 012 (merged 09-01) and
// 013 (merged 09-07) had both still not executed, because the applications-
// service pods were never replaced with the image values-prod.yaml had been
// requesting for six days. Every existing probe stayed green — the OLD pods
// were healthy — so the drift was invisible and the registry rows looked like
// a migration bug instead of a stalled rollout.
//
// A single healthy fixture is used for all four cases so the ONLY variable is
// the build identity: every one of these would exit 0 without the drift check.
// ---------------------------------------------------------------------------

const DRIFT_APPS = [
  {
    slug: 'demo-mf',
    status: 'activated',
    manifest: { name: 'Demo MF', integration: { type: 'module-federation', remoteEntry: '/apps/demo-mf/remoteEntry.js' } },
  },
]
const DRIFT_ROUTES = {
  '/apps/demo-mf/remoteEntry.js': {
    status: 200,
    contentType: 'application/javascript',
    body: 'import("./chunk-abc.js");',
  },
  '/apps/demo-mf/chunk-abc.js': { status: 200, contentType: 'application/javascript', body: 'console.log(1)' },
}

async function runDriftCase({ buildSha, expectedBuild }) {
  const server = await startFixtureServer({ apps: DRIFT_APPS, routes: DRIFT_ROUTES, buildSha })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const expectedPath = writeExpected(tmpDir, [
      { slug: 'demo-mf', name: 'Demo MF', confidence: 'verified', source: 'selftest' },
    ])
    return await runChecker({ baseUrl, expectedPath, useToken: true, expectedBuild })
  } finally {
    server.close()
  }
}

test('DRIFT 1/4: a pod reporting a DIFFERENT build than values-prod.yaml requests FAILS, exit 1', async () => {
  const { status, stdout, stderr } = await runDriftCase({ buildSha: 'aaaaaaaaaaaa', expectedBuild: 'bbbbbbbbbbbb' })
  const out = stdout + stderr
  assert.equal(status, 1, `expected exit 1 for drifted build, got ${status}.\n${out}`)
  assert.match(out, /DEPLOY DRIFT/, `expected a DEPLOY DRIFT report.\n${out}`)
  // Both sides must be named: "they differ" without the two values sends the
  // reader back to the cluster to find out which is which.
  assert.match(out, /aaaaaaaaaaaa/, `expected the REPORTED build in the message.\n${out}`)
  assert.match(out, /bbbbbbbbbbbb/, `expected the REQUESTED tag in the message.\n${out}`)
})

test('DRIFT 2/4: a pod sending NO build header is reported, never treated as matching, exit 1', async () => {
  const { status, stdout, stderr } = await runDriftCase({ buildSha: undefined, expectedBuild: 'bbbbbbbbbbbb' })
  const out = stdout + stderr
  assert.equal(status, 1, `an unstamped service must not pass vacuously, got exit ${status}.\n${out}`)
  assert.match(out, /no X-Fuze-Build reached this census/, `expected the unstamped-service message.\n${out}`)
  // The message must offer BOTH causes. Asserting only that it complains would
  // let it drift back to naming just one, which is the mistake this wording
  // exists to prevent: a dropped header read as proof of a stalled rollout.
  assert.match(out, /predates build stamping/, `expected cause (a) to be named.\n${out}`)
  assert.match(out, /dropped in transit/, `expected cause (b) — the proxy relay — to be named.\n${out}`)
  assert.match(
    out,
    /backend\/src\/routes\/app-registry\.ts/,
    `expected the message to name the relay to check first.\n${out}`
  )
})

test("DRIFT 3/4: a pod reporting build 'unknown' (built with no --build-arg) FAILS, exit 1", async () => {
  const { status, stdout, stderr } = await runDriftCase({ buildSha: 'unknown', expectedBuild: 'bbbbbbbbbbbb' })
  const out = stdout + stderr
  assert.equal(status, 1, `expected exit 1 for an unstamped image, got ${status}.\n${out}`)
  assert.match(out, /reports build 'unknown'/, `expected the unknown-build message.\n${out}`)
})

test('DRIFT 4/4: ANTI-VACUITY — a MATCHING build passes, so the check is not just always-red', async () => {
  const { status, stdout, stderr } = await runDriftCase({ buildSha: 'bbbbbbbbbbbb', expectedBuild: 'bbbbbbbbbbbb' })
  const out = stdout + stderr
  assert.equal(status, 0, `a matching build must pass, got exit ${status}.\n${out}`)
  assert.doesNotMatch(out, /DEPLOY DRIFT/, `a matching build must not report drift.\n${out}`)
  // And the census must have actually printed what it compared.
  assert.match(out, /applications-service build: bbbbbbbbbbbb/, `expected the build line.\n${out}`)
})

test('PASS rows name the entry URL that served, so a duplicate pair is self-adjudicating', async () => {
  const { status, stdout, stderr } = await runDriftCase({ buildSha: 'bbbbbbbbbbbb', expectedBuild: 'bbbbbbbbbbbb' })
  const out = stdout + stderr
  assert.equal(status, 0, out)
  assert.match(
    out,
    /\/apps\/demo-mf\/remoteEntry\.js — remoteEntry \+ 1 chunk\(s\) all load as JavaScript/,
    `a PASS row must name the URL it passed at.\n${out}`
  )
})
