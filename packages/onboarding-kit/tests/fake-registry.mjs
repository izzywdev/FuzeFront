// Minimal stand-in for the app-registry surface, used by register.test.sh.
// Holds apps in memory and records every call so the test can assert the exact
// request SEQUENCE (register -> activate -> policy -> billing), not just the
// final state — the sequence is what makes the script idempotent.
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const TOKEN = 'test-token'
const apps = new Map()
const calls = []
const callLog = process.env.CALL_LOG

// Fail the Nth request with a 500 to exercise the retry path.
const failFirstN = Number(process.env.FAIL_FIRST_N || 0)
let seen = 0

const server = createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const { method, url } = req
    calls.push(`${method} ${url}`)
    // APPEND one line per call, never rewrite the whole history — the test
    // truncates this file between phases to isolate them.
    if (callLog) appendFileSync(callLog, `${method} ${url}\n`)

    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload ?? {}))
    }

    seen++
    if (seen <= failFirstN) return send(500, { error: 'transient' })

    const auth = req.headers.authorization
    if (auth !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' })

    const m = url.match(/^\/api\/v1\/app-registry\/apps\/([^/]+)(\/.*)?$/)

    if (method === 'POST' && url === '/api/v1/app-registry/apps') {
      const manifest = JSON.parse(body).manifest
      if (apps.has(manifest.slug)) return send(409, { error: 'conflict' })
      apps.set(manifest.slug, {
        manifest,
        status: 'registered',
        builtin: manifest.builtin === true,
      })
      return send(201, { slug: manifest.slug, status: 'registered' })
    }

    // List. Used by migrate-slug.mjs for suite detection. `?status=` filters;
    // omitting it returns all NON-SUSPENDED rows, matching the frozen contract.
    if (method === 'GET' && url.startsWith('/api/v1/app-registry/apps?')) {
      const want = new URL(url, 'http://x').searchParams.get('status')
      const items = [...apps.entries()]
        .filter(([, a]) => (want ? a.status === want : a.status !== 'suspended'))
        .map(([slug, a]) => ({ slug, status: a.status, builtin: a.builtin, manifest: a.manifest }))
      return send(200, items)
    }
    if (method === 'GET' && url === '/api/v1/app-registry/apps') {
      const items = [...apps.entries()]
        .filter(([, a]) => a.status !== 'suspended')
        .map(([slug, a]) => ({ slug, status: a.status, builtin: a.builtin, manifest: a.manifest }))
      return send(200, items)
    }

    if (!m) return send(404, { error: 'not_found' })
    const [, slug, sub] = m
    const app = apps.get(slug)

    if (method === 'GET' && !sub) {
      // The contract's `App` carries the manifest and the builtin flag; migrate-slug
      // reads both to decide whether a delete is even permitted. It deliberately does
      // NOT carry `policy` or `billing` — that omission is real, and the migration tool
      // is built around it, so the fake must not invent them.
      return app
        ? send(200, {
            slug,
            status: app.status,
            builtin: app.builtin === true,
            manifest: app.manifest,
          })
        : send(404, { error: 'not_found' })
    }
    if (!app) return send(404, { error: 'not_found' })

    // Built-ins cannot be deleted, only suspended — a 403, per the contract.
    if (method === 'DELETE' && !sub) {
      if (app.builtin === true) return send(403, { error: 'builtin_cannot_be_deleted' })
      apps.delete(slug)
      res.writeHead(204)
      return res.end()
    }

    if (method === 'PUT' && !sub) {
      app.manifest = JSON.parse(body)
      return send(200, { slug, status: app.status })
    }
    if (method === 'POST' && sub === '/activate') {
      app.status = 'activated'
      return send(200, { slug, status: 'activated' })
    }
    if (method === 'PUT' && sub === '/policy') {
      const p = JSON.parse(body)
      app.policy = p
      return send(200, { slug, resources: p.resources.length, roles: p.roles.length })
    }
    if (method === 'PUT' && sub === '/billing-profile') {
      app.billing = JSON.parse(body)
      return send(200, app.billing)
    }
    return send(405, { error: 'method_not_allowed' })
  })
})

server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  // Announce the bound port so the test can find us without a fixed port.
  console.log(`LISTENING ${server.address().port}`)
})
