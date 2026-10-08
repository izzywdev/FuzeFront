import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forwardFuzex, fuzexUpstreamPath } from '../../backend/src/services/fuzex-proxy.ts'

function fixture(overrides = {}) {
  const calls = []
  const deps = {
    baseUrl: 'http://fuzex-postgres-tier:4410', tenant: 'org_test', enabled: async () => true,
    credentials: async (...args) => { calls.push({ credentials: args }); return { workloadToken: 'workload', delegatedToken: 'delegated' } },
    fetcher: async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }) },
    ...overrides,
  }
  return { calls, deps }
}
test('proxy sends server-created delegation with correct audience scope contract, no browser bearer', async () => {
  const { calls, deps } = fixture()
  const result = await forwardFuzex({ method: 'POST', url: '/api/v1/features/demo/flows/main/approve', authorization: 'Bearer session', body: { contentStamp: 'stamp' } }, deps)
  assert.equal(result.status, 200)
  assert.deepEqual(calls[0].credentials, ['session', 'fuzex:frames:write', 'org_test'])
  assert.equal(calls[1].url, 'http://fuzex-postgres-tier:4410/api/v1/features/demo/flows/main/approve')
  assert.equal(calls[1].init.headers.authorization, 'Bearer workload')
  assert.equal(calls[1].init.headers['x-fuze-delegation'], 'Bearer delegated')
  assert.equal(calls[1].init.redirect, 'error')
  assert.ok(!JSON.stringify(calls[1]).includes('session'))
})
test('public reads do not bootstrap any credential; authenticated reads use read scope', async () => {
  const { calls, deps } = fixture()
  await forwardFuzex({ method: 'GET', url: '/api/v1/projects?limit=20' }, deps)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.authorization, undefined)
  await forwardFuzex({ method: 'GET', url: '/api/v1/projects', authorization: 'Bearer session' }, deps)
  assert.equal(calls[1].credentials[1], 'fuzex:frames:read')
})
test('writes without a session and malformed bearer fail before calling upstream', async () => {
  const { calls, deps } = fixture()
  assert.equal((await forwardFuzex({ method: 'POST', url: '/api/v1/features' }, deps)).status, 401)
  assert.equal((await forwardFuzex({ method: 'GET', url: '/api/v1/features', authorization: 'Basic secret' }, deps)).status, 401)
  assert.equal(calls.length, 0)
})
test('release flag OFF leaves proxy inaccessible', async () => {
  const { calls, deps } = fixture({ enabled: async () => false })
  assert.equal((await forwardFuzex({ method: 'GET', url: '/api/v1/projects' }, deps)).status, 404)
  assert.equal(calls.length, 0)
})
test('paths cannot escape the product API or address a different service', () => {
  for (const url of ['https://evil.test', '//evil.test', '/api/v1/features/../../admin', '/api/v1/features/%2e%2e/admin', '/api/v1/features/%252e%252e/admin', '/api/v1/features/a%2fb', '/api/v1/features/a\\b', '/api/v1/internal', '/site/index.html']) {
    assert.equal(fuzexUpstreamPath(url), null, url)
  }
})
test('exchange denial is returned; no fallback to machine-only privilege', async () => {
  const { calls, deps } = fixture({ credentials: async () => { throw { status: 403 } } })
  assert.equal((await forwardFuzex({ method: 'POST', url: '/api/v1/projects', authorization: 'Bearer session' }, deps)).status, 403)
  assert.equal(calls.length, 0)
})
test('missing organization or service configuration fails closed', async () => {
  const request = { method: 'POST', url: '/api/v1/projects', authorization: 'Bearer session' }
  for (const override of [{ tenant: '' }, { baseUrl: '' }, { baseUrl: 'http://user:secret@internal' }]) {
    const { calls, deps } = fixture(override)
    assert.equal((await forwardFuzex(request, deps)).status, 503)
    assert.equal(calls.length, 0)
  }
})
test('upstream HTML is never served on the host origin', async () => {
  const { deps } = fixture({ fetcher: async () => new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/html' } }) })
  assert.equal((await forwardFuzex({ method: 'GET', url: '/api/v1/features' }, deps)).status, 502)
})
