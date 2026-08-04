// app-registry-delegation.test.ts — FuzeFront #533.
//
// The host backend mounts two routers at /api/v1/app-registry (src/index.ts):
//   1. the local-DB adapter  (routes/appRegistry.ts)   — first
//   2. the applications-service proxy (routes/app-registry.ts) — second
//
// The applications-service owns the registry and is where every WRITE lands, so
// the READ (GET /apps) MUST come from the same store — otherwise self-registered
// MFEs (e.g. picker) are active in the applications-service but absent from what
// the shell reads, and never render.
//
// These are pure unit tests: the upstream HTTP client and the DB are mocked, so
// no Postgres / applications-service is needed. We wire the two routers exactly
// as src/index.ts does and assert which store answers GET /apps depending on the
// APP_REGISTRY_LOCAL_ADAPTER flag.

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// Mock the DB module so the adapter's local-table query is observable without a
// real Postgres. db('apps') -> chainable builder resolving to our fake rows.
const fakeRows = [
  {
    name: 'LocalOnlyApp',
    integration_type: 'module-federation',
    remote_url: '/apps/localonlyapp/remoteEntry.js',
    scope: 'localonlyapp',
    module: './App',
    is_active: true,
    organization_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  },
]
jest.mock('../src/config/database', () => {
  const builder: any = {
    where: jest.fn(() => builder),
    limit: jest.fn(() => Promise.resolve(fakeRows)),
  }
  return { db: jest.fn(() => builder) }
})

// Mock auth so the adapter's authenticateToken is a pass-through that sets a user.
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.userId = 'user-1'
    next()
  },
}))

import request from 'supertest'
import express from 'express'
import adapterRoutes from '../src/routes/appRegistry'
import proxyRoutes from '../src/routes/app-registry'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  // Same order as src/index.ts: adapter first, then proxy.
  app.use('/api/v1/app-registry', adapterRoutes)
  app.use('/api/v1/app-registry', proxyRoutes)
  return app
}

function okUpstream(body: unknown, status = 200) {
  mockedAxios.request.mockResolvedValueOnce({
    status,
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify(body)),
  } as any)
}

describe('app-registry GET /apps store selection (#533)', () => {
  const ORIGINAL_FLAG = process.env.APP_REGISTRY_LOCAL_ADAPTER

  beforeEach(() => jest.clearAllMocks())
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.APP_REGISTRY_LOCAL_ADAPTER
    else process.env.APP_REGISTRY_LOCAL_ADAPTER = ORIGINAL_FLAG
  })

  it('delegates to the applications-service proxy by default (flag unset)', async () => {
    delete process.env.APP_REGISTRY_LOCAL_ADAPTER
    // The proxy's store — a self-registered app that exists ONLY there.
    okUpstream({ apps: [{ slug: 'picker', status: 'activated' }], nextCursor: null })

    const res = await request(buildApp())
      .get('/api/v1/app-registry/apps?status=activated')
      .set('Authorization', 'Bearer user-token')

    expect(res.status).toBe(200)
    // Served from the applications-service, not the local table.
    expect(res.body.apps.map((a: any) => a.slug)).toContain('picker')
    expect(res.body.apps.map((a: any) => a.slug)).not.toContain('localonlyapp')

    // The proxy forwarded to the applications-service contract path, verbatim token.
    expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    const call = mockedAxios.request.mock.calls[0][0] as any
    expect(call.method).toBe('GET')
    expect(String(call.url)).toContain('/api/v1/app-registry/apps?status=activated')
    expect(call.headers.Authorization).toBe('Bearer user-token')
  })

  it('serves from the local DB adapter when APP_REGISTRY_LOCAL_ADAPTER is enabled (CI / no service)', async () => {
    process.env.APP_REGISTRY_LOCAL_ADAPTER = '1'

    const res = await request(buildApp())
      .get('/api/v1/app-registry/apps?status=activated')
      .set('Authorization', 'Bearer user-token')

    expect(res.status).toBe(200)
    // Served from the local `apps` table; the proxy is never called.
    expect(res.body.apps.map((a: any) => a.slug)).toContain('localonlyapp')
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })
})
