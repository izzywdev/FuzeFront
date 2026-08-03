import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as portalFlagModule from '../src/utils/portalFlag'
import * as identityFlagModule from '../src/utils/identityFlag'
import * as permissionCheckModule from '../src/utils/permit/permission-check'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import usersRoutes from '../src/routes/users'
import organizationsRoutes from '../src/routes/organizations'
import { ROOT_PORTAL_ID, ROOT_PORTAL_SLUG, generatePortalId } from '../src/repositories/portalRepository'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

// ── flag doubles — BOTH flags controlled independently per test, same
// jest.spyOn-on-the-real-module convention as tests/portal-routes.test.ts (a
// jest.mock(path, factory) here wouldn't be observed by every module that
// already bound the real export before this file's mocks register). ────────
let multiTenantPortalsEnabled = true // this suite always signs portal-bound tokens
let portalScopedUsersEnabled = false
let platformAdminUserIds = new Set<string>()

beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  jest.spyOn(permissionCheckModule, 'checkOrganizationPermission').mockImplementation(
    async (userId: string, action: string, orgId: string) => {
      if (orgId === ROOT_ORG_ID && action === 'manage') {
        return platformAdminUserIds.has(userId)
      }
      // The members-listing route's object-level org-read permission gate —
      // not what this suite is testing (portal isolation is) — always allow.
      return true
    }
  )
})

afterEach(() => {
  jest.clearAllMocks()
  // Restore default mock behavior after clearAllMocks() wipes implementations.
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  jest.spyOn(permissionCheckModule, 'checkOrganizationPermission').mockImplementation(
    async (userId: string, action: string, orgId: string) => {
      if (orgId === ROOT_ORG_ID && action === 'manage') {
        return platformAdminUserIds.has(userId)
      }
      return true
    }
  )
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/users', usersRoutes)
app.use('/api/organizations', organizationsRoutes)

function signToken(userId: string, portalId?: string): string {
  return jwt.sign(
    { userId, sessionId: uuidv4(), ...(portalId ? { portalId } : {}) },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )
}

async function createUser(homePortalId: string | null): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `scope-${id.slice(0, 8)}@test.local`,
    first_name: 'Scope',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    home_portal_id: homePortalId,
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: { slug: string; isRoot?: boolean; domain: string }): Promise<string> {
  const ownerId = await createUser(null)
  const orgId = opts.isRoot ? ROOT_ORG_ID : uuidv4()
  const existingRoot = opts.isRoot ? await db('organizations').where({ id: ROOT_ORG_ID }).first() : null
  if (!existingRoot) {
    await db('organizations').insert({
      id: orgId,
      name: opts.slug,
      slug: `${opts.slug}-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: opts.isRoot ? 'platform' : 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
  }
  const portalId = opts.isRoot ? ROOT_PORTAL_ID : generatePortalId()
  await db('portals').insert({
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    is_root: !!opts.isRoot,
  })
  await db('portal_domains').insert({
    portal_id: portalId,
    domain: opts.domain,
    kind: 'subdomain',
    is_primary: true,
    verification_status: 'verified',
    tls_status: 'issued',
  })
  return portalId
}

beforeEach(async () => {
  portalScopedUsersEnabled = false
  multiTenantPortalsEnabled = true
  platformAdminUserIds = new Set()
  _clearPortalCacheForTests()
  await db('organization_memberships').del()
  await db('portal_domains').del()
  await db('portals').del()
  await db('organizations').where('id', '!=', ROOT_ORG_ID).del()
})

describe('GET /api/users — cross-tenant no-leak suite (FF-EPIC-11-S2/S6)', () => {
  it('flag ON: portal A caller sees ONLY portal A users, never portal B, at ANY page', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-a', domain: 'tenant-a.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b', domain: 'tenant-b.fuzefront.test' })

    const callerA = await createUser(portalA)
    const aUserIds = new Set<string>([callerA])
    for (let i = 0; i < 5; i++) aUserIds.add(await createUser(portalA))
    const bUserIds: string[] = []
    for (let i = 0; i < 5; i++) bUserIds.push(await createUser(portalB))

    const token = signToken(callerA, portalA)

    let cursor: string | undefined
    const seen = new Set<string>()
    let pages = 0
    do {
      const res = await request(app)
        .get('/api/users')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`)
        .set('Host', 'tenant-a.fuzefront.test')
      expect(res.status).toBe(200)
      for (const item of res.body.items) {
        expect(bUserIds).not.toContain(item.id) // NEVER portal B, at any page
        seen.add(item.id)
      }
      cursor = res.body.page.nextCursor ?? undefined
      pages++
      expect(pages).toBeLessThan(20) // guard against an infinite loop on a bug
    } while (cursor)

    // Walks the FULL set — every portal-A user seen exactly once, no gaps/dupes.
    expect(seen).toEqual(aUserIds)
  })

  it('flag ON: direct-ID profile lookup of a portal-B user from portal A -> 404 (no existence leak)', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-a2', domain: 'tenant-a2.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b2', domain: 'tenant-b2.fuzefront.test' })
    const callerA = await createUser(portalA)
    const targetB = await createUser(portalB)

    const token = signToken(callerA, portalA)
    const res = await request(app)
      .get(`/api/users/${targetB}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a2.fuzefront.test')

    expect(res.status).toBe(404)
  })

  it('flag ON: a genuinely nonexistent id also 404s — identical response shape (no oracle)', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-a3', domain: 'tenant-a3.fuzefront.test' })
    const callerA = await createUser(portalA)
    const token = signToken(callerA, portalA)

    const resReal = await request(app)
      .get(`/api/users/${await createUser(await createPortal({ slug: 'tenant-b3', domain: 'tenant-b3.fuzefront.test' }))}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a3.fuzefront.test')
    const resFake = await request(app)
      .get(`/api/users/${uuidv4()}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a3.fuzefront.test')

    expect(resReal.status).toBe(404)
    expect(resFake.status).toBe(404)
    expect(resReal.body).toEqual(resFake.body)
  })

  it('flag ON: search never returns a portal-B match to a portal-A caller', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-a4', domain: 'tenant-a4.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b4', domain: 'tenant-b4.fuzefront.test' })
    const callerA = await createUser(portalA)

    const bTargetId = uuidv4()
    await db('users').insert({
      id: bTargetId,
      email: 'findme-shared-token@test.local',
      first_name: 'FindMe',
      last_name: 'Shared',
      roles: JSON.stringify(['user']),
      home_portal_id: portalB,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const token = signToken(callerA, portalA)
    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'findme-shared-token' })
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a4.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body.items.map((u: any) => u.id)).not.toContain(bTargetId)
  })

  it('platform-admin bypass returns the FULL cross-portal view — a distinct path, not the default', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-a5', domain: 'tenant-a5.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b5', domain: 'tenant-b5.fuzefront.test' })
    const userA = await createUser(portalA)
    const userB = await createUser(portalB)
    const admin = await createUser(portalA)
    platformAdminUserIds = new Set([admin])

    const token = signToken(admin, portalA)
    const res = await request(app)
      .get('/api/users')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a5.fuzefront.test')

    expect(res.status).toBe(200)
    const ids = res.body.items.map((u: any) => u.id)
    expect(ids).toEqual(expect.arrayContaining([userA, userB]))
  })

  it('FAIL CLOSED: missing req.user.portalId (multi-tenant-portals flag OFF at auth time) -> 403, never unscoped', async () => {
    portalScopedUsersEnabled = true
    multiTenantPortalsEnabled = false // authenticateToken never sets user.portalId
    const portalA = await createPortal({ slug: 'tenant-a6', domain: 'tenant-a6.fuzefront.test' })
    const userA = await createUser(portalA)
    const token = signToken(userA) // no portalId claim either

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a6.fuzefront.test')

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('PORTAL_CONTEXT_REQUIRED')
  })

  it('FAIL CLOSED: profile-by-id also 404s (not 403) when portal context is missing — never leaks existence', async () => {
    portalScopedUsersEnabled = true
    multiTenantPortalsEnabled = false
    const portalA = await createPortal({ slug: 'tenant-a7', domain: 'tenant-a7.fuzefront.test' })
    const someUser = await createUser(portalA)
    const token = signToken(someUser)

    const res = await request(app)
      .get(`/api/users/${someUser}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a7.fuzefront.test')

    expect(res.status).toBe(404)
  })
})

describe('GET /api/users — flag OFF: BYTE-IDENTICAL unscoped global behavior (regression guard)', () => {
  it('flag OFF: portal A caller sees portal B users too (no scoping applied at all)', async () => {
    portalScopedUsersEnabled = false
    const portalA = await createPortal({ slug: 'tenant-a8', domain: 'tenant-a8.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b8', domain: 'tenant-b8.fuzefront.test' })
    const callerA = await createUser(portalA)
    const targetB = await createUser(portalB)

    const token = signToken(callerA, portalA)
    const res = await request(app)
      .get('/api/users')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a8.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body.items.map((u: any) => u.id)).toContain(targetB)
  })

  it('flag OFF: direct profile lookup of a portal-B user succeeds (200, unchanged)', async () => {
    portalScopedUsersEnabled = false
    const portalA = await createPortal({ slug: 'tenant-a9', domain: 'tenant-a9.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-b9', domain: 'tenant-b9.fuzefront.test' })
    const callerA = await createUser(portalA)
    const targetB = await createUser(portalB)

    const token = signToken(callerA, portalA)
    const res = await request(app)
      .get(`/api/users/${targetB}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-a9.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(targetB)
  })
})

describe('GET /api/users — pagination envelope + limit clamp (governance/pagination-standard.md)', () => {
  it('returns the {items, page:{nextCursor,hasMore}} envelope and clamps an over-max limit', async () => {
    portalScopedUsersEnabled = false
    const portalA = await createPortal({ slug: 'tenant-clamp', domain: 'tenant-clamp.fuzefront.test' })
    const callerA = await createUser(portalA)
    for (let i = 0; i < 3; i++) await createUser(portalA)

    const token = signToken(callerA, portalA)
    const res = await request(app)
      .get('/api/users')
      .query({ limit: 99999 }) // over MAX_LIMIT (200) — must be clamped, never honored unbounded
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-clamp.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('items')
    expect(res.body).toHaveProperty('page')
    expect(res.body.page).toHaveProperty('nextCursor')
    expect(res.body.page).toHaveProperty('hasMore')
    expect(res.body.items.length).toBeLessThanOrEqual(200)
  })

  it('cursor walks the full set deterministically — no gaps, no duplicates', async () => {
    // Scoped to portal A (not the global/unscoped path) so the expected set is
    // exactly bounded — the shared test DB has many other fixture rows from
    // sibling suites that would otherwise make this assertion flaky.
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-walk', domain: 'tenant-walk.fuzefront.test' })
    const callerA = await createUser(portalA)
    const expected = new Set<string>([callerA])
    for (let i = 0; i < 9; i++) expected.add(await createUser(portalA))

    const token = signToken(callerA, portalA)
    let cursor: string | undefined
    const seen: string[] = []
    do {
      const res = await request(app)
        .get('/api/users')
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`)
        .set('Host', 'tenant-walk.fuzefront.test')
      expect(res.status).toBe(200)
      seen.push(...res.body.items.map((u: any) => u.id))
      cursor = res.body.page.nextCursor ?? undefined
    } while (cursor)

    expect(new Set(seen)).toEqual(expected)
    expect(seen.length).toBe(new Set(seen).size) // no duplicates
  })

  it('a malformed cursor is a 400, not a silent reset to page 1', async () => {
    portalScopedUsersEnabled = false
    const portalA = await createPortal({ slug: 'tenant-badcursor', domain: 'tenant-badcursor.fuzefront.test' })
    const callerA = await createUser(portalA)
    const token = signToken(callerA, portalA)

    const res = await request(app)
      .get('/api/users')
      .query({ cursor: 'not-a-valid-cursor!!!' })
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-badcursor.fuzefront.test')

    expect(res.status).toBe(400)
  })
})

describe('GET /api/organizations/:id/members — portal-scoped membership listing (FF-EPIC-11-S2)', () => {
  it('flag ON: a member row whose user home_portal_id does not match the org portal is excluded', async () => {
    portalScopedUsersEnabled = true
    const portalA = await createPortal({ slug: 'tenant-mem-a', domain: 'tenant-mem-a.fuzefront.test' })
    const portalB = await createPortal({ slug: 'tenant-mem-b', domain: 'tenant-mem-b.fuzefront.test' })
    const orgA = (await db('portals').where({ id: portalA }).first()).organization_id

    const legitMember = await createUser(portalA)
    const strayMember = await createUser(portalB) // home_portal_id mismatches orgA's portal

    for (const uid of [legitMember, strayMember]) {
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: uid,
        organization_id: orgA,
        role: 'member',
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })
    }

    const token = signToken(legitMember, portalA)
    const res = await request(app)
      .get(`/api/organizations/${orgA}/members`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'tenant-mem-a.fuzefront.test')

    expect(res.status).toBe(200)
    const ids = res.body.items.map((m: any) => m.user.id)
    expect(ids).toContain(legitMember)
    expect(ids).not.toContain(strayMember)
  })
})
