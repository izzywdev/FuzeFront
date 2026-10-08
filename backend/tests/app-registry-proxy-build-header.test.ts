// app-registry-proxy-build-header.test.ts
//
// The applications-service stamps `X-Fuze-Build` (its image SHA) on every
// response. The portal-federation-health census reads that header off
// GET /api/v1/app-registry/apps to answer one question no other signal
// answers: is the registry that production is serving actually built from the
// commit values-prod.yaml requests?
//
// It never talks to the applications-service directly. `/api/v1/app-registry`
// has no Ingress rule, so it falls through `/api` to the host backend, which
// proxies it (src/routes/app-registry.ts). Every response header the census
// sees has to survive that hop.
//
// The proxy relays an ALLOWLIST of headers, and `x-fuze-build` was not on it.
// The failure is silent in the worst way: the census reads a missing header as
// "this service predates build stamping", i.e. as positive evidence the
// rollout is behind — a false negative that reads like a finding. So the relay
// gets a test, not just a line of code.
jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

jest.mock('../src/config/database', () => {
  const builder: any = {
    where: jest.fn(() => builder),
    limit: jest.fn(() => Promise.resolve([])),
  }
  return { db: jest.fn(() => builder) }
})

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.userId = 'user-1'
    next()
  },
}))

import request from 'supertest'
import express from 'express'
import proxyRoutes from '../src/routes/app-registry'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/app-registry', proxyRoutes)
  return app
}

function upstreamResponds(headers: Record<string, string>, body: unknown = { apps: [] }) {
  mockedAxios.request.mockResolvedValueOnce({
    status: 200,
    headers,
    data: Buffer.from(JSON.stringify(body)),
  } as any)
}

describe('app-registry proxy relays the applications-service build stamp', () => {
  const ORIGINAL_FLAG = process.env.APP_REGISTRY_LOCAL_ADAPTER
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.APP_REGISTRY_LOCAL_ADAPTER
  })
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.APP_REGISTRY_LOCAL_ADAPTER
    else process.env.APP_REGISTRY_LOCAL_ADAPTER = ORIGINAL_FLAG
  })

  it('passes X-Fuze-Build through to the caller', async () => {
    upstreamResponds({
      'content-type': 'application/json',
      'x-fuze-build': '35095772b923',
    })

    const res = await request(buildApp())
      .get('/api/v1/app-registry/apps?status=activated')
      .set('Authorization', 'Bearer user-token')

    expect(res.status).toBe(200)
    expect(res.headers['x-fuze-build']).toBe('35095772b923')
  })

  it('relays the value verbatim — never a placeholder the census would compare against', async () => {
    // An image built without --build-arg BUILD_SHA reports 'unknown'. The census
    // has a distinct message for that, which it can only reach if the literal
    // value arrives rather than being normalised or dropped en route.
    upstreamResponds({ 'content-type': 'application/json', 'x-fuze-build': 'unknown' })

    const res = await request(buildApp())
      .get('/api/v1/app-registry/apps')
      .set('Authorization', 'Bearer user-token')

    expect(res.headers['x-fuze-build']).toBe('unknown')
  })

  it('sends no X-Fuze-Build when the upstream sent none — absence must stay meaningful', async () => {
    // Anti-vacuity: if the proxy invented a value, the census could never detect
    // a genuinely unstamped (old) applications-service, which is the exact
    // condition it exists to report.
    upstreamResponds({ 'content-type': 'application/json' })

    const res = await request(buildApp())
      .get('/api/v1/app-registry/apps')
      .set('Authorization', 'Bearer user-token')

    expect(res.headers['x-fuze-build']).toBeUndefined()
  })

  it('still relays the heartbeat token and content-type it relayed before', async () => {
    // Regression guard: the allowlist gained an entry, it did not get rewritten.
    upstreamResponds({
      'content-type': 'application/json',
      'x-app-heartbeat-token': 'hb-token-1',
      'x-fuze-build': 'abcdef123456',
    })

    const res = await request(buildApp())
      .post('/api/v1/app-registry/apps')
      .set('Authorization', 'Bearer user-token')
      .send({ slug: 'demo' })

    expect(res.headers['x-app-heartbeat-token']).toBe('hb-token-1')
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['x-fuze-build']).toBe('abcdef123456')
  })
})
