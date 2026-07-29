import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

// Platform-admin gating is unit-tested against a controllable mock — same
// convention as tests/billing-proxy.test.ts's `checkOrganizationPermission`
// mock — rather than exercising the real Permit.io SDK.
jest.mock('../src/utils/permit/permission-check', () => ({
  checkOrganizationPermission: jest.fn(),
}))
import { checkOrganizationPermission } from '../src/utils/permit/permission-check'
const mockCheckOrgPermission = checkOrganizationPermission as jest.MockedFunction<
  typeof checkOrganizationPermission
>

// NOTE: config/permit is deliberately NOT mocked in this file. The route
// handlers under test call the real `provisionPortal()` with its DEFAULT
// Permit client, which — because PERMIT_API_KEY=ci-no-real-permit-calls is
// set for this whole test run (see the VERIFY commands) — resolves through
// config/permit.ts's own zero-network no-op proxy. That lets create-portal
// route tests exercise the REAL provisioning pipeline end-to-end without any
// network call, while permission-check (the platform-admin gate) is
// independently controlled via the mock above.

import * as portalFlagModule from '../src/utils/portalFlag'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import adminPortalsRoutes, { clampLimit, encodeCursor, decodeCursor } from '../src/routes/adminPortals'
import portalRoutes from '../src/routes/portal'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import { ROOT_PORTAL_ID, ROOT_PORTAL_SLUG, generatePortalId } from '../src/repositories/portalRepository'

let flagEnabled = false
beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => flagEnabled
  )
})

beforeEach(() => {
  flagEnabled = true
  mockCheckOrgPermission.mockReset()
  mockCheckOrgPermission.mockResolvedValue(true)
  _clearPortalCacheForTests()
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/v1/portal', portalRoutes)
app.use('/api/v1/admin/portals', adminPortalsRoutes)

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `admin-portals-${id.slice(0, 8)}@test.local`,
    first_name: 'Admin',
    last_name: 'Portals',
    roles: JSON.stringify(['admin']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

function signToken(userId: string): string {
  return jwt.sign({ userId, sessionId: uuidv4() }, process.env.JWT_SECRET!, {
    expiresIn: '24h',
  })
}

/** Directly seeds an org + portal row, bypassing the provisioning pipeline —
 * for tests that only care about CRUD/list behavior against existing rows. */
async function seedPortal(opts: {
  slug: string
  status?: 'provisioning' | 'provisioned-pending-invite' | 'active' | 'suspended'
  isRoot?: boolean
  createdAt?: Date
}): Promise<{ portalId: string; organizationId: string }> {
  const ownerId = await createUser()
  const orgId = uuidv4()
  await db('organizations').insert({
    id: orgId,
    name: opts.slug,
    slug: `org-${opts.slug}-${orgId.slice(0, 6)}`,
    owner_id: ownerId,
    type: opts.isRoot ? 'platform' : 'organization',
    parent_id: opts.isRoot ? null : ROOT_ORG_ID,
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    provisioning_state: 'active',
  })
  const portalId = opts.isRoot ? ROOT_PORTAL_ID : generatePortalId()
  await db('portals').insert({
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: opts.status ?? 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    owner_email: 'owner@example.com',
    is_root: !!opts.isRoot,
    created_at: opts.createdAt ?? new Date(),
    updated_at: opts.createdAt ?? new Date(),
  })
  return { portalId, organizationId: orgId }
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`
}

async function authedUser(): Promise<{ userId: string; token: string }> {
  const userId = await createUser()
  return { userId, token: signToken(userId) }
}

// ---------------------------------------------------------------------------
// Flag OFF -> 404 on every admin route, regardless of admin status.
// ---------------------------------------------------------------------------
describe('admin portal routes — flag OFF (pre-epic 404)', () => {
  beforeEach(() => {
    flagEnabled = false
  })

  it('GET / -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .get('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('POST / -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', slug: uniqueSlug('x'), ownerEmail: 'x@example.com' })
    expect(res.status).toBe(404)
  })

  it('GET /:portalId -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .get('/api/v1/admin/portals/prt_whatever')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('PATCH /:portalId -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .patch('/api/v1/admin/portals/prt_whatever')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New name' })
    expect(res.status).toBe(404)
  })

  it('POST /:portalId/suspend -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .post('/api/v1/admin/portals/prt_whatever/suspend')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('POST /:portalId/resume -> 404', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .post('/api/v1/admin/portals/prt_whatever/resume')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Authz fail-closed: no token -> 401; non-platform-admin -> 403 FORBIDDEN.
// ---------------------------------------------------------------------------
describe('admin portal routes — flag ON, authz fail-closed', () => {
  it('GET / with no token -> 401', async () => {
    const res = await request(app).get('/api/v1/admin/portals')
    expect(res.status).toBe(401)
  })

  it('GET / — non-platform-admin -> 403 FORBIDDEN', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const res = await request(app)
      .get('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
    expect(mockCheckOrgPermission).toHaveBeenCalledWith(expect.any(String), 'read', ROOT_ORG_ID)
  })

  it('POST / — non-platform-admin -> 403 FORBIDDEN, checked against the ROOT org', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const res = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', slug: uniqueSlug('x'), ownerEmail: 'x@example.com' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
    expect(mockCheckOrgPermission).toHaveBeenCalledWith(expect.any(String), 'manage', ROOT_ORG_ID)
  })

  it('GET /:portalId — non-platform-admin -> 403 FORBIDDEN', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })
    const res = await request(app)
      .get(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  it('PATCH /:portalId — non-platform-admin -> 403 FORBIDDEN', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })
    const res = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New name' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  it('POST /:portalId/suspend — non-platform-admin -> 403 FORBIDDEN', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })
    const res = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  it('POST /:portalId/resume — non-platform-admin -> 403 FORBIDDEN', async () => {
    mockCheckOrgPermission.mockResolvedValue(false)
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme'), status: 'suspended' })
    const res = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/resume`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// POST / — contract-shape + validation + SLUG_TAKEN.
// ---------------------------------------------------------------------------
describe('POST /api/v1/admin/portals — create (provision)', () => {
  it('201s with a Portal matching the frozen contract shape', async () => {
    const { token } = await authedUser()
    const slug = uniqueSlug('northwind')

    const res = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Northwind', slug, ownerEmail: 'owner@northwind.example.com' })

    expect(res.status).toBe(201)
    expect(res.body.id).toMatch(/^prt_[A-Za-z0-9]{1,40}$/)
    expect(res.body.slug).toBe(slug)
    expect(res.body.name).toBe('Northwind')
    expect(res.body.status).toBe('provisioned-pending-invite')
    expect(res.body.isRoot).toBe(false)
    expect(typeof res.body.organizationId).toBe('string')
    expect(res.body.ownerEmail).toBe('owner@northwind.example.com')
    expect(res.body.billingMode).toBe('free')
    expect(res.body.branding).toBeDefined()
    expect(res.body.identityPolicy).toBeDefined()
    expect(Array.isArray(res.body.domains)).toBe(true)
    expect(res.body.domains).toHaveLength(1)
    expect(res.body.domains[0]).toMatchObject({
      domain: `${slug}.fuzefront.com`,
      kind: 'subdomain',
      isPrimary: true,
      active: true,
    })
    expect(res.body.primaryDomain).toBe(`${slug}.fuzefront.com`)
    expect(typeof res.body.createdAt).toBe('string')
    expect(typeof res.body.updatedAt).toBe('string')

    // Persisted for real — a subsequent GET returns the same portal.
    const getRes = await request(app)
      .get(`/api/v1/admin/portals/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.id).toBe(res.body.id)
  })

  it('400 validation_error for a missing/invalid payload', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', slug: 'BAD SLUG!', ownerEmail: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation_error')
    expect(Array.isArray(res.body.fields)).toBe(true)
    const paths = res.body.fields.map((f: any) => f.path)
    expect(paths).toEqual(expect.arrayContaining(['name', 'slug', 'ownerEmail']))
  })

  it('409 SLUG_TAKEN for a duplicate slug already in a terminal-ish state', async () => {
    const { token } = await authedUser()
    const slug = uniqueSlug('dup')

    const first = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup Co', slug, ownerEmail: 'owner@dup.example.com' })
    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup Co Again', slug, ownerEmail: 'owner2@dup.example.com' })

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('SLUG_TAKEN')
  })
})

// ---------------------------------------------------------------------------
// GET /:portalId
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/portals/:portalId', () => {
  it('200s with the full portal record', async () => {
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })

    const res = await request(app)
      .get(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(portalId)
  })

  it('404 NOT_FOUND for an unknown portal id', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .get('/api/v1/admin/portals/prt_doesnotexist')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// PATCH /:portalId — field + status transitions.
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/admin/portals/:portalId', () => {
  it('updates mutable fields', async () => {
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })

    const res = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Co', billingMode: 'platform' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Renamed Co')
    expect(res.body.billingMode).toBe('platform')
  })

  it('400 validation_error when the body is empty or slug is present', async () => {
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('acme') })

    const empty = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(empty.status).toBe(400)

    const slugChange = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'new-slug' })
    expect(slugChange.status).toBe(400)
    expect(slugChange.body.fields.map((f: any) => f.path)).toContain('slug')
  })

  it('404 NOT_FOUND for an unknown portal id', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .patch('/api/v1/admin/portals/prt_doesnotexist')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' })
    expect(res.status).toBe(404)
  })

  it('status: suspended flips lifecycle, invalidates the resolver cache immediately, and status: active resumes it', async () => {
    const { token } = await authedUser()
    const slug = uniqueSlug('flip')
    const { portalId, organizationId } = await seedPortal({ slug, status: 'active' })
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: `${slug}.fuzefront.test`,
      kind: 'subdomain',
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'none',
    })

    // Warm the resolver cache for this portal's Host via the real middleware
    // (mounted at the top of `app`), proving invalidation is immediate, not
    // just "eventually" (TTL) correct.
    const warm = await request(app).get('/api/v1/portal/context').set('Host', `${slug}.fuzefront.test`)
    expect(warm.status).toBe(200)
    expect(warm.body.slug).toBe(slug)

    const suspendRes = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' })
    expect(suspendRes.status).toBe(200)
    expect(suspendRes.body.status).toBe('suspended')

    // A subsequent GET reflects the new status (no stale read).
    const getRes = await request(app)
      .get(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.status).toBe('suspended')

    // The public resolver picks it up immediately — the whole point of
    // invalidatePortalCache(portalId).
    const afterSuspend = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', `${slug}.fuzefront.test`)
    expect(afterSuspend.status).toBe(403)
    expect(afterSuspend.body.error).toBe('PORTAL_SUSPENDED')

    // Resume flips it back.
    const resumeRes = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
    expect(resumeRes.status).toBe(200)
    expect(resumeRes.body.status).toBe('active')

    const afterResume = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', `${slug}.fuzefront.test`)
    expect(afterResume.status).toBe(200)
    expect(afterResume.body.slug).toBe(slug)

    void organizationId
  })

  it('409 ROOT_PORTAL_PROTECTED — the root portal cannot be suspended via PATCH', async () => {
    const { token } = await authedUser()
    // Root portal may already exist from ensureRootPortal or another test —
    // seed our OWN root-flagged row under a fresh id to avoid cross-test
    // dependence on seed ordering.
    const ownerId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'Root Test Org',
      slug: `root-test-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: 'platform',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    const portalId = `prt_roottest${orgId.slice(0, 8)}`
    await db('portals').insert({
      id: portalId,
      organization_id: orgId,
      slug: `roottest-${orgId.slice(0, 8)}`,
      name: 'Root Test',
      status: 'active',
      billing_mode: 'platform',
      branding: JSON.stringify({ name: 'Root Test' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: true,
    })

    const res = await request(app)
      .patch(`/api/v1/admin/portals/${portalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ROOT_PORTAL_PROTECTED')
  })
})

// ---------------------------------------------------------------------------
// POST /:portalId/suspend and /resume — semantic actions, idempotent.
// ---------------------------------------------------------------------------
describe('POST /api/v1/admin/portals/:portalId/suspend and /resume', () => {
  it('suspend then resume round-trips the status and is idempotent', async () => {
    const { token } = await authedUser()
    const { portalId } = await seedPortal({ slug: uniqueSlug('lifecycle'), status: 'active' })

    const suspend1 = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
    expect(suspend1.status).toBe(200)
    expect(suspend1.body.status).toBe('suspended')

    // Idempotent — suspending an already-suspended portal is a no-op 200.
    const suspend2 = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
    expect(suspend2.status).toBe(200)
    expect(suspend2.body.status).toBe('suspended')

    const resume1 = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/resume`)
      .set('Authorization', `Bearer ${token}`)
    expect(resume1.status).toBe(200)
    expect(resume1.body.status).toBe('active')

    // Idempotent — resuming an already-active portal is a no-op 200.
    const resume2 = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/resume`)
      .set('Authorization', `Bearer ${token}`)
    expect(resume2.status).toBe(200)
    expect(resume2.body.status).toBe('active')
  })

  it('409 ROOT_PORTAL_PROTECTED for POST /suspend on the root portal', async () => {
    const { token } = await authedUser()
    const ownerId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'Root Suspend Test',
      slug: `root-suspend-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: 'platform',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    const portalId = `prt_rootsuspend${orgId.slice(0, 8)}`
    await db('portals').insert({
      id: portalId,
      organization_id: orgId,
      slug: `rootsuspend-${orgId.slice(0, 8)}`,
      name: 'Root Suspend Test',
      status: 'active',
      billing_mode: 'platform',
      branding: JSON.stringify({ name: 'Root Suspend Test' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: true,
    })

    const res = await request(app)
      .post(`/api/v1/admin/portals/${portalId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ROOT_PORTAL_PROTECTED')
  })

  it('404 NOT_FOUND for an unknown portal id on suspend/resume', async () => {
    const { token } = await authedUser()
    const suspendRes = await request(app)
      .post('/api/v1/admin/portals/prt_doesnotexist/suspend')
      .set('Authorization', `Bearer ${token}`)
    expect(suspendRes.status).toBe(404)

    const resumeRes = await request(app)
      .post('/api/v1/admin/portals/prt_doesnotexist/resume')
      .set('Authorization', `Bearer ${token}`)
    expect(resumeRes.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET / — pagination: envelope shape, limit clamp, and full-set cursor walk.
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/portals — pagination', () => {
  it('returns the { items, page } envelope', async () => {
    const { token } = await authedUser()
    await seedPortal({ slug: uniqueSlug('env') })

    const res = await request(app)
      .get('/api/v1/admin/portals')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.page).toBeDefined()
    expect('nextCursor' in res.body.page).toBe(true)
    expect(typeof res.body.page.hasMore).toBe('boolean')
  })

  it('clamps an over-max limit server-side (unit: clampLimit)', () => {
    expect(clampLimit(500)).toBe(100)
    expect(clampLimit(100)).toBe(100)
    expect(clampLimit(10)).toBe(10)
    expect(clampLimit(0)).toBe(25)
    expect(clampLimit(-5)).toBe(25)
    expect(clampLimit('not-a-number')).toBe(25)
    expect(clampLimit(undefined)).toBe(25)
  })

  it('an over-max limit request never returns more than the max page size', async () => {
    const { token } = await authedUser()
    const prefix = uniqueSlug('clamp')
    for (let i = 0; i < 5; i++) {
      await seedPortal({ slug: `${prefix}-${i}` })
    }

    const res = await request(app)
      .get('/api/v1/admin/portals')
      .query({ limit: '500', q: prefix })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeLessThanOrEqual(100)
    expect(res.body.items.length).toBe(5)
  })

  it('walks the full set deterministically via cursor — no gaps, no duplicates', async () => {
    const { token } = await authedUser()
    const prefix = uniqueSlug('walk')
    const created: string[] = []
    for (let i = 0; i < 5; i++) {
      const { portalId } = await seedPortal({
        slug: `${prefix}-${i}`,
        createdAt: new Date(Date.now() + i * 1000),
      })
      created.push(portalId)
    }

    const seen: string[] = []
    let cursor: string | undefined
    let guard = 0
    while (guard++ < 10) {
      const res = await request(app)
        .get('/api/v1/admin/portals')
        .query({ limit: '2', q: prefix, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      seen.push(...res.body.items.map((p: any) => p.id))
      if (!res.body.page.hasMore) {
        expect(res.body.page.nextCursor).toBeNull()
        break
      }
      cursor = res.body.page.nextCursor
      expect(typeof cursor).toBe('string')
    }

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5) // no duplicates
    expect(new Set(seen)).toEqual(new Set(created)) // no gaps
  })

  it('400 INVALID_CURSOR for a malformed cursor', async () => {
    const { token } = await authedUser()
    const res = await request(app)
      .get('/api/v1/admin/portals')
      .query({ cursor: 'not-valid-base64url-json' })
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('INVALID_CURSOR')
  })

  it('encodeCursor/decodeCursor round-trip', () => {
    const iso = new Date('2026-01-01T00:00:00.000Z')
    const encoded = encodeCursor(iso, 'prt_abc')
    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual({ lastCreatedAt: iso.toISOString(), lastId: 'prt_abc' })
    expect(decodeCursor('%%%not-json%%%')).toBeNull()
  })

  it('filters by status', async () => {
    const { token } = await authedUser()
    const prefix = uniqueSlug('statusfilter')
    await seedPortal({ slug: `${prefix}-active`, status: 'active' })
    await seedPortal({ slug: `${prefix}-suspended`, status: 'suspended' })

    const res = await request(app)
      .get('/api/v1/admin/portals')
      .query({ status: 'suspended', q: prefix })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].status).toBe('suspended')
  })
})

// ---------------------------------------------------------------------------
// Ensure ROOT_PORTAL_SLUG import above is actually used (guards against an
// unused-import lint failure while documenting the root slug this suite's
// ROOT_PORTAL_PROTECTED cases exercise).
// ---------------------------------------------------------------------------
describe('module sanity', () => {
  it('ROOT_PORTAL_SLUG is the well-known root slug', () => {
    expect(ROOT_PORTAL_SLUG).toBe('fuzefront')
  })
})
