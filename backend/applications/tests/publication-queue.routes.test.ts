// Route tests for GET /publication-requests (operationId listPublicationRequests,
// contract 1.6.0) and AppCreator.contactEmail. Both feature-flag states are
// exercised (marketplace-publishing, creator-ownership). The SQL / keyset
// cursor behaviour itself is proven against real Postgres in
// publication-queue.store.integration.test.ts; here the service method is a
// spy so we assert the ROUTE contract: authz (fail closed), validation,
// limit clamp, envelope shape, DTO mapping and the former-member rule.
process.env.LOG_LEVEL = 'silent'
process.env.APP_BUILD_READ_RATE_LIMIT = '100000'
process.env.APP_BUILD_WRITE_RATE_LIMIT = '100000'

import express from 'express'
import request from 'supertest'

jest.mock('../src/config/database', () => ({
  db: () => {
    throw new Error('db must not be touched in this suite')
  },
}))
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    next()
  },
}))
jest.mock('../src/app-registry/caller', () => ({
  resolveCaller: async (u: any) => ({
    userId: u.id,
    organizationIds: u.organizationIds ?? [],
    roles: u.roles ?? [],
    isPlatformAdmin: (u.roles ?? []).includes('admin'),
  }),
}))

import { fromUuid } from '@izzywdev/fuzefront-identity'
import { setFlagClient, FLAGS } from '../src/app-registry/flags'
import { setPermitClient } from '../src/app-registry/permit'
import { setCreatorResolver, toAppDtos } from '../src/app-registry/app-dto'
import { setIdentityFlagClient } from '../src/identity/flags'
import { appRegistryService, InvalidCursorError } from '../src/app-registry/service'
import appBuildsRouter from '../src/routes/app-builds'

const ORG = '20000000-0000-4000-8000-000000000001'
const CREATOR = '10000000-0000-4000-8000-00000000000a'
const alice = { id: CREATOR, roles: ['user'], organizationIds: [ORG] }
const admin = { id: '10000000-0000-4000-8000-0000000000ff', roles: ['admin'], organizationIds: [] as string[] }
const as = (u: any) => ({ 'x-test-user': JSON.stringify(u) })

let publishFlag = true
let creatorFlag = true
let creatorFlagByOrg: Record<string, boolean> | null = null
const creatorEvalCtx: any[] = []
let prefixedFlag = false
setFlagClient({
  getBooleanValue: async (key: string, def: boolean, ctx?: any) => {
    if (key === FLAGS.MARKETPLACE_PUBLISHING) return publishFlag
    if (key === FLAGS.CREATOR_OWNERSHIP) {
      creatorEvalCtx.push(ctx)
      if (creatorFlagByOrg) return Boolean(ctx?.orgId && creatorFlagByOrg[ctx.orgId])
      return creatorFlag
    }
    return def
  },
})
setIdentityFlagClient({
  getBooleanValue: async (key: string, def: boolean) =>
    key === 'fuzefront.identity.prefixed-ids' ? prefixedFlag : def,
})
const permitChecks: any[] = []
setPermitClient({ check: async (...a: any[]) => { permitChecks.push(a); return true } })

const app = express()
app.use(express.json())
app.use('/api/v1/app-registry', appBuildsRouter)
const URL = '/api/v1/app-registry/publication-requests'

function appRecord(slug: string, extra: any = {}, manifest: any = {}) {
  return {
    slug, status: 'registered', mode: 'portal', builtin: false, organizationId: ORG, createdByUserId: CREATOR,
    manifest: { manifestVersion: '1', slug, name: `App ${slug}`, menuLabel: slug, mode: 'portal', visibility: 'private',
      icon: { kind: 'emoji', value: '🧾' }, ...manifest },
    isHealthy: null, lastSeenAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  }
}
const pendingPub = (at: string) => ({
  submittedAt: at, isApproved: false, approvedAt: null, approvedBy: null,
  metadata: { publication: { requestedBy: CREATOR, notes: 'pls' } },
})

let page: any
let spy: jest.SpyInstance
let creatorInfo: any

beforeEach(() => {
  publishFlag = true; creatorFlag = true; prefixedFlag = false; creatorFlagByOrg = null; creatorEvalCtx.length = 0
  permitChecks.length = 0
  creatorInfo = { isCurrentMember: true, displayName: 'Casey Creator', contactEmail: 'casey@example.com' }
  setCreatorResolver({ resolve: async () => creatorInfo })
  page = {
    items: [{ app: appRecord('inv'), publication: pendingPub('2026-01-02T00:00:00.000Z') }],
    nextCursor: null, hasMore: false,
  }
  spy = jest.spyOn(appRegistryService, 'listPublicationRequests').mockImplementation(async () => page)
})
afterEach(() => {
  spy.mockRestore()
  setCreatorResolver(null)
})

describe('GET /publication-requests — flag + authz (fail closed)', () => {
  it('flag OFF -> 503 feature_disabled and the store is never read (even for admin)', async () => {
    publishFlag = false
    const res = await request(app).get(URL).set(as(admin))
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('feature_disabled')
    expect(spy).not.toHaveBeenCalled()
  })

  it('unauthenticated -> 401', async () => {
    expect((await request(app).get(URL)).status).toBe(401)
    expect(spy).not.toHaveBeenCalled()
  })

  it('flag ON: a non-admin (even an org member / app manager) -> 403 and nothing read', async () => {
    const res = await request(app).get(URL).set(as(alice))
    expect(res.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })

  it('flag ON: an id/Permit-grant alone is not a capability — Permit allow does not open the queue to a non-admin', async () => {
    const res = await request(app).get(`${URL}?status=pending`).set(as(alice))
    expect(res.status).toBe(403)
  })

  it('flag ON: the synthetic consumer/registration-token identity (role admin) -> 403, store never read', async () => {
    const consumer = { id: 'consumer-registration', roles: ['admin'], organizationIds: [] as string[] }
    const res = await request(app).get(URL).set(as(consumer))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
    expect(spy).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('casey@example.com')
    // a real admin session is still served
    expect((await request(app).get(URL).set(as(admin))).status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('flag OFF: the consumer identity is still dark (503) — flag check precedes authz', async () => {
    publishFlag = false
    const consumer = { id: 'consumer-registration', roles: ['admin'], organizationIds: [] as string[] }
    expect((await request(app).get(URL).set(as(consumer))).status).toBe(503)
  })

  it('flag ON: platform admin -> 200', async () => {
    expect((await request(app).get(URL).set(as(admin))).status).toBe(200)
  })

  it('a flag is not the authorization: flag ON + non-admin is still denied; flag OFF + admin is still dark', async () => {
    expect((await request(app).get(URL).set(as(alice))).status).toBe(403)
    publishFlag = false
    expect((await request(app).get(URL).set(as(admin))).status).toBe(503)
  })
})

describe('GET /publication-requests — pagination contract', () => {
  it('defaults: status=pending, limit=50, no cursor', async () => {
    await request(app).get(URL).set(as(admin))
    expect(spy).toHaveBeenCalledWith({ status: 'pending', limit: 50, cursor: undefined })
  })

  it('clamps an over-max limit to 200 and passes status + opaque cursor through', async () => {
    await request(app).get(`${URL}?status=approved&limit=9999&cursor=abc`).set(as(admin))
    expect(spy).toHaveBeenCalledWith({ status: 'approved', limit: 200, cursor: 'abc' })
  })

  it('envelope is { items, page: { nextCursor, hasMore } } and carries the cursor through', async () => {
    page = { ...page, nextCursor: 'NEXT', hasMore: true }
    const res = await request(app).get(`${URL}?limit=1`).set(as(admin))
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['items', 'page'])
    expect(res.body.page).toEqual({ nextCursor: 'NEXT', hasMore: true })
    expect(res.body.items).toHaveLength(1)
    const last = await request(app).get(URL).set(as(admin))
    page = { ...page, nextCursor: null, hasMore: false }
    expect((await request(app).get(URL).set(as(admin))).body.page).toEqual({ nextCursor: null, hasMore: false })
    expect(last.status).toBe(200)
  })

  it('400 on: status=none / unknown, limit 0 / negative / non-numeric, malformed cursor (service says so), repeated params', async () => {
    for (const q of ['status=none', 'status=bogus', 'limit=0', 'limit=-3', 'limit=abc', 'limit=1.5', 'status=pending&status=approved', 'cursor=']) {
      const res = await request(app).get(`${URL}?${q}`).set(as(admin))
      expect([q, res.status]).toEqual([q, 400])
      expect(res.body.error).toBe('validation_error')
    }
    spy.mockRejectedValueOnce(new InvalidCursorError())
    const bad = await request(app).get(`${URL}?cursor=garbage`).set(as(admin))
    expect(bad.status).toBe(400)
    expect(bad.body.message).toBe('invalid cursor')
  })

  it('an unexpected store error is a 500 (no leak)', async () => {
    spy.mockRejectedValueOnce(new Error('connection refused to 10.0.0.5'))
    const res = await request(app).get(URL).set(as(admin))
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
  })
})

describe('GET /publication-requests — PublicationQueueItem shape', () => {
  it('maps app display context + the full AppPublication; flag creator-ownership ON adds creator (with contactEmail)', async () => {
    const res = await request(app).get(URL).set(as(admin))
    expect(res.status).toBe(200)
    expect(res.body.items[0]).toEqual({
      slug: 'inv',
      name: 'App inv',
      icon: { kind: 'emoji', value: '🧾' },
      organizationId: ORG,
      creator: {
        userId: fromUuid('user', CREATOR),
        isCurrentMember: true,
        displayName: 'Casey Creator',
        contactEmail: 'casey@example.com',
      },
      publication: {
        slug: 'inv', tier: 'private', status: 'pending', target: 'marketplace',
        submittedAt: '2026-01-02T00:00:00.000Z', approvedAt: null, approvedBy: null,
        requestedBy: fromUuid('user', CREATOR), notes: 'pls', rejection: null,
      },
    })
  })

  it('creator-ownership OFF: no creator key at all', async () => {
    creatorFlag = false
    const res = await request(app).get(URL).set(as(admin))
    expect(res.body.items[0]).not.toHaveProperty('creator')
    expect(res.body.items[0]).not.toHaveProperty('createdBy')
    expect(JSON.stringify(res.body)).not.toContain('casey@example.com')
  })

  it('former member: reduced to isCurrentMember:false — no name, no contactEmail', async () => {
    creatorInfo = { isCurrentMember: false, displayName: null, contactEmail: null }
    const res = await request(app).get(URL).set(as(admin))
    expect(res.body.items[0].creator).toEqual({ userId: fromUuid('user', CREATOR), isCurrentMember: false })
  })

  it('creator-ownership is evaluated per OWNING org (as the per-app GET does), rows keep their order', async () => {
    const ORG2 = '20000000-0000-4000-8000-000000000002'
    creatorFlagByOrg = { [ORG]: true } // ON for ORG only, OFF for ORG2
    page.items = [
      { app: appRecord('one'), publication: pendingPub('2026-01-02T00:00:00.000Z') },
      { app: appRecord('two', { organizationId: ORG2 }), publication: pendingPub('2026-01-03T00:00:00.000Z') },
      { app: appRecord('three'), publication: pendingPub('2026-01-04T00:00:00.000Z') },
    ]
    const res = await request(app).get(URL).set(as(admin))
    expect(res.status).toBe(200)
    expect(res.body.items.map((i: any) => i.slug)).toEqual(['one', 'two', 'three'])
    expect(res.body.items[0]).toHaveProperty('creator')
    expect(res.body.items[1]).not.toHaveProperty('creator')
    expect(res.body.items[2]).toHaveProperty('creator')
    // one evaluation per distinct owning org, each carrying that org
    expect(creatorEvalCtx.map(c => c.orgId).sort()).toEqual([ORG, ORG2].sort())
  })

  it('app with no recorded creator -> creator null (flag ON)', async () => {
    page.items[0].app = appRecord('inv', { createdByUserId: null })
    const res = await request(app).get(URL).set(as(admin))
    expect(res.body.items[0].creator).toBeNull()
  })

  it('rejected / approved publications are rendered by the same AppPublication mapper', async () => {
    page.items = [
      { app: appRecord('rej'), publication: { submittedAt: null, isApproved: false, approvedAt: null, approvedBy: null,
        metadata: { publication: { rejection: { reason: 'no policy', rejectedAt: '2026-01-03T00:00:00.000Z', rejectedBy: CREATOR } } } } },
      { app: appRecord('ok', {}, { visibility: 'marketplace' }), publication: { submittedAt: '2026-01-01T00:00:00.000Z', isApproved: true,
        approvedAt: '2026-01-04T00:00:00.000Z', approvedBy: admin.id, metadata: {} } },
    ]
    const res = await request(app).get(`${URL}?status=rejected`).set(as(admin))
    expect(res.body.items[0].publication).toMatchObject({ status: 'rejected', rejection: { reason: 'no policy', rejectedBy: fromUuid('user', CREATOR) } })
    expect(res.body.items[1].publication).toMatchObject({ status: 'approved', tier: 'marketplace', approvedBy: fromUuid('user', admin.id) })
  })

  it('app without a manifest icon still yields a renderable required `icon`', async () => {
    const a = appRecord('inv'); delete (a.manifest as any).icon
    page.items[0].app = a
    const res = await request(app).get(URL).set(as(admin))
    expect(res.body.items[0].icon).toEqual({ kind: 'emoji', value: '📦' })
  })

  it('prefixed-ids flag ON: organizationId in wire form', async () => {
    prefixedFlag = true
    const res = await request(app).get(URL).set(as(admin))
    expect(res.body.items[0].organizationId).toBe(fromUuid('organization', ORG))
  })

  it('never returns internal columns', async () => {
    const res = await request(app).get(URL).set(as(admin))
    const s = JSON.stringify(res.body)
    expect(s).not.toContain('createdByUserId')
    expect(s).not.toContain('heartbeat')
  })
})

describe('AppCreator.contactEmail (toAppDtos)', () => {
  const sameOrg = { userId: CREATOR, organizationIds: [ORG], isPlatformAdmin: false }
  const opts = { prefixed: false, creatorOwnership: true, caller: sameOrg }
  it('present while a current member; absent when email unknown', async () => {
    creatorInfo = { isCurrentMember: true, displayName: 'Casey', contactEmail: 'c@example.com' }
    expect((await toAppDtos([appRecord('a') as any], opts))[0].creator.contactEmail).toBe('c@example.com')
    creatorInfo = { isCurrentMember: true, displayName: 'Casey', contactEmail: null }
    expect((await toAppDtos([appRecord('a') as any], opts))[0].creator).not.toHaveProperty('contactEmail')
  })
  it('never for a former member, even if the resolver erroneously supplied one', async () => {
    creatorInfo = { isCurrentMember: false, displayName: null, contactEmail: 'stale@example.com' }
    const c = (await toAppDtos([appRecord('a') as any], opts))[0].creator
    expect(c).toEqual({ userId: fromUuid('user', CREATOR), isCurrentMember: false })
  })
  it('caller matrix: same-org member / admin see it; outside-org, no caller, consumer identity do not (displayName kept)', async () => {
    const email = (caller: any) => toAppDtos([appRecord('a') as any], { ...opts, caller }).then(d => d[0].creator)
    expect((await email(sameOrg)).contactEmail).toBe('casey@example.com')
    expect((await email({ userId: 'x', organizationIds: [], isPlatformAdmin: true })).contactEmail).toBe('casey@example.com')
    for (const c of [
      { userId: 'x', organizationIds: ['other-org'], isPlatformAdmin: false },
      null,
      undefined,
      { userId: 'consumer-registration', organizationIds: [], isPlatformAdmin: true },
    ]) {
      const cr = await email(c)
      expect(cr).not.toHaveProperty('contactEmail')
      expect(cr.displayName).toBe('Casey Creator')
    }
  })
  it('flag OFF: no creator surface at all', async () => {
    const dto = (await toAppDtos([appRecord('a') as any], { prefixed: false, creatorOwnership: false }))[0]
    expect(dto).not.toHaveProperty('creator')
  })
})
