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
function startFixtureServer({ apps, routes }) {
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
      res.writeHead(200, { 'Content-Type': 'application/json' })
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
function runChecker({ baseUrl, expectedPath, useToken }) {
  const args = [SCRIPT, '--base-url', baseUrl, '--api-url', baseUrl, '--expected', expectedPath]
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
