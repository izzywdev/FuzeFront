import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectProduct } from './check-mobile-postprod.mjs'

const product = { repo: 'FuzeAgent', frontendUrl: 'https://fuzeagent.fuzefront.com/' }
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const fixture = (overrides = {}) => (url) => {
  const path = new URL(url).pathname
  if (url in overrides) return Promise.resolve(overrides[url])
  if (path === '/repos/izzywdev/FuzeAgent') return Promise.resolve(json({ default_branch: 'main' }))
  if (path.endsWith('/actions/workflows')) return Promise.resolve(json({ workflows: [{ path: '.github/workflows/build-android-apk.yml', state: 'active' }] }))
  if (path.endsWith('/releases')) return Promise.resolve(json([{ draft: false, tag_name: 'android-v2', target_commitish: 'main', assets: [{ name: 'app.apk', size: 42 }] }]))
  if (path === '/') return Promise.resolve(new Response('<html><body>FuzeAgent</body></html>', { headers: { 'Content-Type': 'text/html' } }))
  if (path === '/api/health') return Promise.resolve(json({ status: 'ok' }))
  if (path === '/.well-known/assetlinks.json') return Promise.resolve(json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.fuzefront.agent', sha256_cert_fingerprints: ['AA:BB'] } }]))
  if (path === '/manifest.webmanifest') return Promise.resolve(json({ name: 'FuzeAgent', display: 'standalone' }))
  throw new Error(`unexpected URL: ${url}`)
}

test('passes only when the APK, standalone UI, API, manifest and asset links exist', async () => {
  const result = await inspectProduct(product, fixture())
  assert.equal(result.ok, true)
  assert.equal(Object.keys(result.checks).length, 7)
})

test('rejects a Cloudflare Access redirect for the standalone shell and asset links', async () => {
  const login = new Response(null, { status: 302, headers: { Location: 'https://fuzefront.cloudflareaccess.com/login' } })
  const result = await inspectProduct(product, fixture({
    'https://fuzeagent.fuzefront.com/': login,
    'https://fuzeagent.fuzefront.com/.well-known/assetlinks.json': login,
  }))
  assert.equal(result.ok, false)
  assert.match(result.checks.frontend.detail, /Cloudflare Access/)
  assert.match(result.checks.assetlinks.detail, /Cloudflare Access/)
})

test('rejects SPA fallback HTML from the backend health URL', async () => {
  const result = await inspectProduct(product, fixture({
    'https://fuzeagent.fuzefront.com/api/health': new Response('<html>SPA</html>', { headers: { 'Content-Type': 'text/html' } }),
  }))
  assert.equal(result.checks.api.ok, false)
})

test('rejects an empty APK or a release targeting another branch', async () => {
  const result = await inspectProduct(product, fixture({
    'https://api.github.com/repos/izzywdev/FuzeAgent/releases?per_page=30': json([{ draft: false, target_commitish: 'feature', assets: [{ name: 'app.apk', size: 0 }] }]),
  }))
  assert.equal(result.checks.apk.ok, false)
})

test('uses the Mendys manifest path exception', async () => {
  const url = 'https://live.mendysrobotics.com/manifest.json'
  let seen = false
  const request = (requested) => {
    if (requested === url) { seen = true; return Promise.resolve(json({ name: 'Mendys', display: 'standalone' })) }
    return Promise.resolve(json({}))
  }
  await inspectProduct({ repo: 'MendysRobotics', frontendUrl: 'https://live.mendysrobotics.com/', manifestPath: '/manifest.json' }, request)
  assert.equal(seen, true)
})
