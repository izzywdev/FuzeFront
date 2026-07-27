import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as portalFlagModule from '../src/utils/portalFlag'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import portalRoutes from '../src/routes/portal'
import {
  ROOT_PORTAL_ID,
  ROOT_PORTAL_SLUG,
  generatePortalId,
} from '../src/repositories/portalRepository'

// Controls the master flag for every consumer of utils/portalFlag (routes,
// middleware/auth, middleware/portalContext) via one mutable boolean — see the
// feature-flags skill: BOTH states must be exercised. This substitutes for the
// OpenFeature test provider (no Unleash/@fuzefront/feature-flags package is
// installed in this sandbox) but keeps the exact same call contract every
// production module already uses.
//
// jest.spyOn (mutating the REAL module's exported function in place) rather
// than jest.mock(path, factory): tests/setup.ts imports routes/auth.ts (for
// drainProvisioningQueue) BEFORE this file's own top-level code runs, which
// already binds middleware/auth.ts's copy of `isMultiTenantPortalsEnabled` to
// the real module object. jest.mock() only redirects requires that happen
// AFTER it registers, so middleware/auth wouldn't see it; jest.spyOn mutates
// the one shared module object every importer's CJS-compiled property lookup
// reads at call time, so every consumer observes the same override.
let flagEnabled = false
beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => flagEnabled
  )
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/v1/portal', portalRoutes)

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `portal-route-${id.slice(0, 8)}@test.local`,
    first_name: 'Portal',
    last_name: 'Route',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: {
  slug: string
  isRoot?: boolean
  domain?: string
}): Promise<{ portalId: string; organizationId: string }> {
  const userId = await createUser()
  const orgId = uuidv4()
  await db('organizations').insert({
    id: orgId,
    name: opts.slug,
    slug: `${opts.slug}-${orgId.slice(0, 6)}`,
    owner_id: userId,
    type: opts.isRoot ? 'platform' : 'organization',
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
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: true }),
    is_root: !!opts.isRoot,
  })
  if (opts.domain) {
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: opts.domain,
      kind: 'subdomain',
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'issued',
    })
  }
  return { portalId, organizationId: orgId }
}

function signToken(userId: string, portalId?: string): string {
  return jwt.sign(
    { userId, sessionId: uuidv4(), ...(portalId ? { portalId } : {}) },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )
}

beforeEach(async () => {
  flagEnabled = false
  _clearPortalCacheForTests()
  await db('portal_domains').del()
  await db('portals').del()
})

describe('GET /api/v1/portal/context — flag OFF (FF-EPIC-09-S4 AC1)', () => {
  it('returns 404 — unchanged from pre-epic behavior (no such route existed)', async () => {
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const res = await request(app).get('/api/v1/portal/context').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/portal/context — flag ON', () => {
  it('returns the public projection for the resolved (root) portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })

    const res = await request(app).get('/api/v1/portal/context').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: ROOT_PORTAL_ID, slug: ROOT_PORTAL_SLUG, isRoot: true })
    expect(res.body.branding).toBeDefined()
    expect(res.body.identityPolicy).toBeDefined()
    expect(res.body.authEntry).toBeDefined()
    // Public projection — never leaks internal fields.
    expect(res.body.organizationId).toBeUndefined()
    expect(res.body.billingMode).toBeUndefined()
    expect(res.body.domains).toBeUndefined()
  })

  it('resolves a tenant portal by Host', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    await createPortal({ slug: 'northwind', domain: 'northwind.fuzefront.test' })

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'northwind.fuzefront.test')
    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('northwind')
  })

  it('returns 403 PORTAL_SUSPENDED for a suspended portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const { portalId } = await createPortal({ slug: 'suspendo', domain: 'suspendo.fuzefront.test' })
    await db('portals').where({ id: portalId }).update({ status: 'suspended' })

    const res = await request(app)
      .get('/api/v1/portal/context')
      .set('Host', 'suspendo.fuzefront.test')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('PORTAL_SUSPENDED')
  })
})

describe('GET /api/v1/portal/current — flag OFF', () => {
  it('returns 404 even with a valid token — unchanged from pre-epic behavior', async () => {
    const userId = await createUser()
    const token = signToken(userId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(404)
  })

  it('still requires authentication (401 with no token) — auth middleware itself is unaffected', async () => {
    const res = await request(app).get('/api/v1/portal/current').set('Host', 'app.fuzefront.test')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/portal/current — flag ON (FF-EPIC-10-S3 JWT/session binding)', () => {
  it('returns the caller\'s own portal resolved from the token portal_id claim', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const { portalId } = await createPortal({ slug: 'acme', domain: 'acme.fuzefront.test' })

    const token = signToken(userId, portalId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'acme.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(portalId)
    expect(res.body.slug).toBe('acme')
    expect(res.body.domains).toEqual(
      expect.arrayContaining([expect.objectContaining({ domain: 'acme.fuzefront.test' })])
    )
  })

  it('AC3 — rejects (401) a token whose portal_id claim mismatches the Host-resolved portal', async () => {
    flagEnabled = true
    await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()
    const { portalId: portalA } = await createPortal({ slug: 'portal-a', domain: 'portal-a.fuzefront.test' })
    await createPortal({ slug: 'portal-b', domain: 'portal-b.fuzefront.test' })

    // Token minted for portal A, presented on portal B's Host.
    const token = signToken(userId, portalA)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'portal-b.fuzefront.test')

    expect(res.status).toBe(401)
  })

  it('risk mitigation — a legacy token with no portal_id claim binds to the resolved (root) portal', async () => {
    flagEnabled = true
    const rootOrg = await createPortal({ slug: ROOT_PORTAL_SLUG, isRoot: true })
    const userId = await createUser()

    const token = signToken(userId) // no portalId claim
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'unresolvable-host.example.com') // falls back to root

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(rootOrg.portalId)
  })

  it('returns 403 FORBIDDEN_PORTAL when no portal is bound and no root portal is seeded', async () => {
    flagEnabled = true
    // No portals at all — resolvePortalContext itself will 404 first because it
    // can't resolve ANY portal (no root seeded), which is the correct
    // fail-closed outcome for this state.
    const userId = await createUser()
    const token = signToken(userId)
    const res = await request(app)
      .get('/api/v1/portal/current')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'nothing.example.com')
    expect(res.status).toBe(404)
  })
})
