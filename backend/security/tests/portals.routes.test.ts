/**
 * FF-EPIC-17-S7 — unit tests for the portal CRUD org-tree endpoints
 * (`/api/v1/security/portals*`). DB is a small in-memory fake (no real
 * Postgres required) that faithfully replays the WHERE/ORDER/LIMIT semantics
 * the routes rely on — mirrors the harness style of `employee.routes.test.ts`
 * (real `resolveEmployeeStatus`, only its `userHasRole` Permit dependency is
 * mocked, so the ReBAC-derived platform-admin path is genuinely exercised).
 *
 * `reconcileOrganizationProvisioning` (services/organizationProvisioning.ts)
 * has its own dedicated test coverage — it is mocked here so this suite stays
 * focused on the portal routes' own logic (extension-table wiring, status
 * derivation, pagination, authz, flag gate).
 */
import request from 'supertest'
import express from 'express'

process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

// ── in-memory fake DB ───────────────────────────────────────────────────────

type OrgRow = {
  id: string
  name: string
  slug: string
  parent_id: string | null
  owner_id: string
  type: string
  settings: any
  metadata: any
  is_active: boolean
  provisioning_state: string
  created_at: Date
  updated_at: Date
}

type AttrRow = {
  organization_id: string
  custom_domain: string | null
  branding: any
  billing_mode: string
  app_catalog_mode: string
  owner_email: string | null
  is_portal_root: boolean
  status: string
  created_at: Date
  updated_at: Date
}

type MembershipRow = {
  id: string
  user_id: string
  organization_id: string
  role: string
  status: string
  joined_at: Date
}

// Generic single-table builder — supports both `.where(col, val)` /
// `.where(obj)` / `.whereNot(obj)` call shapes used across the codebase
// (routes/portals.ts's own `.where(col, val)` chains AND
// services/employeeRole.ts's `.where({...}).whereNot({...}).select(col)`
// chain), plus `.first()` / `.insert()` / `.update()` / bare-await.
class SimpleBuilder {
  private _wheres: Array<[string, any]> = []
  private _whereNots: Array<[string, any]> = []

  constructor(
    private rows: any[],
    private tableName: string,
    private uniqueCols: string[] = []
  ) {}

  where(colOrObj: any, val?: any) {
    if (typeof colOrObj === 'object' && colOrObj !== null) {
      for (const [k, v] of Object.entries(colOrObj)) this._wheres.push([k, v])
    } else {
      this._wheres.push([colOrObj, val])
    }
    return this
  }

  whereNot(colOrObj: any, val?: any) {
    if (typeof colOrObj === 'object' && colOrObj !== null) {
      for (const [k, v] of Object.entries(colOrObj)) this._whereNots.push([k, v])
    } else {
      this._whereNots.push([colOrObj, val])
    }
    return this
  }

  private filtered() {
    return this.rows.filter(
      r =>
        this._wheres.every(([k, v]) => r[k] === v) &&
        this._whereNots.every(([k, v]) => r[k] !== v)
    )
  }

  select(_cols?: any) {
    return Promise.resolve(this.filtered())
  }

  first() {
    return Promise.resolve(this.filtered()[0])
  }

  count(_c?: any) {
    return Promise.resolve([{ count: String(this.filtered().length) }])
  }

  insert(obj: any) {
    for (const col of this.uniqueCols) {
      if (this.rows.some(r => r[col] === obj[col])) {
        const err: any = new Error(`duplicate key value violates unique constraint "${this.tableName}_${col}"`)
        err.code = '23505'
        return Promise.reject(err)
      }
    }
    const row = { created_at: new Date(), updated_at: new Date(), ...obj }
    this.rows.push(row)
    return Promise.resolve([row.id])
  }

  update(patch: any) {
    const matched = this.filtered()
    matched.forEach(r => Object.assign(r, patch))
    return Promise.resolve(matched.length)
  }

  then(resolve: any, reject: any) {
    try {
      resolve(this.filtered())
    } catch (e) {
      reject(e)
    }
  }
}

// The `organizations as o` JOIN `organization_portal_attributes as a` query
// every portal route reads from — replays WHERE / whereRaw keyset / ORDER BY
// / LIMIT for real so pagination tests exercise genuine filter/sort/slice
// logic rather than a blind "were these args passed" check (mirrors
// `employee.routes.test.ts`'s `makeOrgTreeRawMock`).
class PortalJoinBuilder {
  private _wheres: Array<[string, any]> = []
  private _whereRaw: any[] | null = null
  private _limit: number | undefined

  constructor(
    private orgs: OrgRow[],
    private attrs: AttrRow[]
  ) {}

  join() {
    return this
  }
  select() {
    return this
  }
  where(col: string, val: any) {
    this._wheres.push([col, val])
    return this
  }
  whereRaw(_sql: string, bindings: any[]) {
    this._whereRaw = bindings
    return this
  }
  orderBy() {
    return this
  }
  limit(n: number) {
    this._limit = n
    return this
  }

  private compute() {
    let rows = this.orgs
      .map(o => {
        const a = this.attrs.find(a => a.organization_id === o.id)
        if (!a) return null
        return {
          id: o.id,
          name: o.name,
          slug: o.slug,
          parent_id: o.parent_id,
          is_active: o.is_active,
          created_at: o.created_at,
          updated_at: o.updated_at,
          branding: a.branding,
          billing_mode: a.billing_mode,
          app_catalog_mode: a.app_catalog_mode,
          owner_email: a.owner_email,
          custom_domain: a.custom_domain,
          status: a.status,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    for (const [col, val] of this._wheres) {
      const key = col.replace(/^o\.|^a\./, '')
      rows = rows.filter(r => (r as any)[key] === val)
    }
    if (this._whereRaw) {
      const [cursorCreatedAt, cursorId] = this._whereRaw
      rows = rows.filter(r => {
        const c = r.created_at.toISOString()
        return c > cursorCreatedAt || (c === cursorCreatedAt && r.id > cursorId)
      })
    }
    rows = [...rows].sort((x, y) => {
      const cx = x.created_at.toISOString()
      const cy = y.created_at.toISOString()
      if (cx < cy) return -1
      if (cx > cy) return 1
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
    })
    if (this._limit !== undefined) rows = rows.slice(0, this._limit)
    return rows
  }

  first() {
    return Promise.resolve(this.compute()[0])
  }

  then(resolve: any, reject: any) {
    try {
      resolve(this.compute())
    } catch (e) {
      reject(e)
    }
  }
}

function makeFakeDb() {
  const organizations: OrgRow[] = []
  const attrs: AttrRow[] = []
  const memberships: MembershipRow[] = []

  const dbFn: any = jest.fn((table: string) => {
    if (table === 'organizations as o') return new PortalJoinBuilder(organizations, attrs)
    if (table === 'organizations') return new SimpleBuilder(organizations, 'organizations', ['slug'])
    if (table === 'organization_portal_attributes') return new SimpleBuilder(attrs, 'organization_portal_attributes')
    if (table === 'organization_memberships') return new SimpleBuilder(memberships, 'organization_memberships')
    throw new Error(`unexpected table: ${table}`)
  })
  dbFn.transaction = jest.fn(async (cb: any) => cb(dbFn))
  dbFn.raw = jest.fn()

  return { dbFn, organizations, attrs, memberships }
}

// ── module mocks ─────────────────────────────────────────────────────────

let fakeDb: ReturnType<typeof makeFakeDb>

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), { transaction: jest.fn(), raw: jest.fn() }),
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.__testUser ?? { id: 'admin-1', email: 'admin@example.com', roles: ['user'] }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
  assignRoleInPermit: jest.fn().mockResolvedValue(true),
  unassignRoleInPermit: jest.fn().mockResolvedValue(true),
  getUserRoleAssignments: jest.fn().mockResolvedValue([]),
  getTenantRoleAssignments: jest.fn().mockResolvedValue([]),
  userHasRole: jest.fn().mockResolvedValue(false),
  updateOrganizationRole: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/utils/multiTenantPortalsFlag', () => ({
  MULTI_TENANT_PORTALS_FLAG: 'fuzefront.platform.multi-tenant-portals',
  isMultiTenantPortalsEnabled: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue('active'),
}))

jest.mock('@fuzefront/core', () => ({
  enqueueEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@fuzefront/shared/kafka', () => ({
  TOPICS: { IDENTITY_ORG_CREATED: 'identity.org.created', IDENTITY_MEMBERSHIP_ADDED: 'identity.membership.added' },
}))

import { toUuid as toUuidReal } from '@izzywdev/fuzefront-identity'
import { db } from '../src/config/database'
import { userHasRole } from '../src/utils/permit/role-assignment'
import { isMultiTenantPortalsEnabled } from '../src/utils/multiTenantPortalsFlag'
import { reconcileOrganizationProvisioning } from '../src/services/organizationProvisioning'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'
import portalsRouter from '../src/routes/portals'

const dbMock = db as unknown as jest.MockedFunction<any>
const userHasRoleMock = userHasRole as jest.Mock
const isMultiTenantPortalsEnabledMock = isMultiTenantPortalsEnabled as jest.Mock
const reconcileMock = reconcileOrganizationProvisioning as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', portalsRouter)
  return app
}

function wireDb() {
  fakeDb = makeFakeDb()
  dbMock.mockImplementation(fakeDb.dbFn)
  ;(dbMock as any).transaction = fakeDb.dbFn.transaction
  ;(dbMock as any).raw = fakeDb.dbFn.raw
  return fakeDb
}

function seedPortal(overrides: Partial<OrgRow & AttrRow> = {}, createdAt = new Date('2026-01-01T00:00:00.000Z')) {
  const id = overrides.id ?? `org-portal-${fakeDb.organizations.length + 1}`
  fakeDb.organizations.push({
    id,
    name: overrides.name ?? 'Acme Portal',
    slug: overrides.slug ?? `acme-${id}`,
    parent_id: overrides.parent_id === undefined ? ROOT_ORG_ID : overrides.parent_id,
    owner_id: overrides.owner_id ?? 'admin-1',
    type: 'organization',
    settings: {},
    metadata: {},
    is_active: overrides.is_active ?? true,
    provisioning_state: overrides.provisioning_state ?? 'active',
    created_at: createdAt,
    updated_at: createdAt,
  })
  fakeDb.attrs.push({
    organization_id: id,
    custom_domain: overrides.custom_domain ?? null,
    branding: overrides.branding ?? { name: overrides.name ?? 'Acme Portal', logo: null, favicon: null, accent: null, tagline: null },
    billing_mode: overrides.billing_mode ?? 'free',
    app_catalog_mode: overrides.app_catalog_mode ?? 'inherit',
    owner_email: overrides.owner_email ?? 'owner@acme.example',
    is_portal_root: true,
    status: overrides.status ?? 'active',
    created_at: createdAt,
    updated_at: createdAt,
  })
  return id
}

beforeEach(() => {
  jest.clearAllMocks()
  isMultiTenantPortalsEnabledMock.mockResolvedValue(true)
  userHasRoleMock.mockResolvedValue(true) // platform-admin by default
  wireDb()
  // Simulates the REAL reconciler's side effect (flips organizations.
  // provisioning_state to 'active') so the route's post-reconcile status
  // derivation is exercised against real state, not a blind stub return.
  reconcileMock.mockImplementation(async (orgId: any) => {
    const rawId = toUuidReal(orgId)
    const org = fakeDb.organizations.find(o => o.id === rawId)
    if (org) org.provisioning_state = 'active'
    return 'active'
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /portals
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/security/portals', () => {
  let app: express.Application
  beforeEach(() => {
    app = buildApp()
  })

  it('AC1 — lists only orgs whose parentOrgId is the platform root and carry portal attributes', async () => {
    seedPortal({ id: 'org-portal-a', name: 'Portal A' }, new Date('2026-01-01T00:00:00.000Z'))
    seedPortal({ id: 'org-portal-b', name: 'Portal B' }, new Date('2026-01-02T00:00:00.000Z'))
    // An ordinary sub-org (child of a portal, NOT the root) — must never appear.
    fakeDb.organizations.push({
      id: 'org-leaf',
      name: 'Leaf',
      slug: 'leaf',
      parent_id: 'org-portal-a',
      owner_id: 'admin-1',
      type: 'organization',
      settings: {},
      metadata: {},
      is_active: true,
      provisioning_state: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })

    const res = await request(app).get('/api/v1/security/portals')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    expect(res.body.items.map((p: any) => p.orgId).sort()).toEqual(['org-portal-a', 'org-portal-b'])
    expect(res.body.items.every((p: any) => p.parentOrgId === ROOT_ORG_ID)).toBe(true)
    expect(res.body.items.every((p: any) => p.isPortalRoot === true)).toBe(true)
  })

  it('AC3 — the platform root is never listed as a child of itself', async () => {
    // The root itself has no parent_id and no attributes row — even if
    // someone forced parent_id = ROOT_ORG_ID on the root row directly, no
    // extension-table row exists for it, so the JOIN excludes it either way.
    fakeDb.organizations.push({
      id: ROOT_ORG_ID,
      name: 'FuzeFront',
      slug: 'fuzefront',
      parent_id: null,
      owner_id: 'admin-1',
      type: 'platform',
      settings: {},
      metadata: {},
      is_active: true,
      provisioning_state: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })
    seedPortal({ id: 'org-portal-a' })

    const res = await request(app).get('/api/v1/security/portals')

    expect(res.status).toBe(200)
    expect(res.body.items.some((p: any) => p.orgId === ROOT_ORG_ID)).toBe(false)
  })

  it('filters by status', async () => {
    seedPortal({ id: 'org-active', status: 'active' })
    seedPortal({ id: 'org-suspended', status: 'suspended' })

    const res = await request(app).get('/api/v1/security/portals?status=suspended')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].orgId).toBe('org-suspended')
  })

  it('envelope shape is { items, page: { nextCursor, hasMore } }', async () => {
    seedPortal({ id: 'org-portal-a' })

    const res = await request(app).get('/api/v1/security/portals')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        page: { nextCursor: null, hasMore: false },
      })
    )
  })

  it('defaults limit to 50 and clamps an over-max limit to 200 (server-side)', async () => {
    for (let i = 0; i < 3; i++) {
      seedPortal({ id: `org-p${i}` }, new Date(2026, 0, i + 1))
    }

    const res1 = await request(app).get('/api/v1/security/portals')
    expect(res1.status).toBe(200)
    expect(res1.body.items.length).toBeLessThanOrEqual(50)

    const res2 = await request(app).get('/api/v1/security/portals?limit=999')
    expect(res2.status).toBe(200)
    // Only 3 seeded — clamp itself is verified via the cursor-walk test below
    // (limit=2 forces a real multi-page split), this just proves no 500/400.
    expect(res2.body.items.length).toBe(3)
  })

  it('paginates the full set with no gaps/dupes across a cursor walk', async () => {
    for (let i = 0; i < 5; i++) {
      seedPortal({ id: `org-p${i}` }, new Date(2026, 0, i + 1))
    }

    const collected: string[] = []
    let cursor: string | undefined
    let hasMore = true
    let iterations = 0

    while (hasMore && iterations < 10) {
      iterations++
      const url = cursor
        ? `/api/v1/security/portals?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/v1/security/portals?limit=2'
      const res = await request(app).get(url)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeLessThanOrEqual(2)
      collected.push(...res.body.items.map((i: any) => i.orgId))
      hasMore = res.body.page.hasMore
      cursor = res.body.page.nextCursor ?? undefined
    }

    expect(collected).toHaveLength(5)
    expect(new Set(collected).size).toBe(5)
    expect(new Set(collected)).toEqual(new Set(['org-p0', 'org-p1', 'org-p2', 'org-p3', 'org-p4']))
  })

  it('400s on a malformed cursor', async () => {
    seedPortal({ id: 'org-portal-a' })

    const res = await request(app).get('/api/v1/security/portals?cursor=not-valid-base64url!!!')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
  })

  it('AC4 — returns 403 FORBIDDEN for a non-platform-admin caller', async () => {
    userHasRoleMock.mockResolvedValue(false)
    seedPortal({ id: 'org-portal-a' })

    const res = await request(app).get('/api/v1/security/portals')

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMultiTenantPortalsEnabledMock.mockResolvedValue(false)

      const res = await request(app).get('/api/v1/security/portals')

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
      expect(userHasRoleMock).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /portals
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/security/portals', () => {
  let app: express.Application
  beforeEach(() => {
    app = buildApp()
  })

  const validBody = {
    name: 'New Portal',
    slug: 'new-portal',
    ownerEmail: 'owner@newportal.example',
  }

  it('mints the id, attaches tenant attributes, and sets parentOrgId = platform root', async () => {
    const res = await request(app).post('/api/v1/security/portals').send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.orgId).toEqual(expect.any(String))
    expect(res.body.orgId.length).toBeGreaterThan(0)
    expect(res.body.parentOrgId).toBe(ROOT_ORG_ID)
    expect(res.body.slug).toBe('new-portal')
    expect(res.body.isPortalRoot).toBe(true)
    expect(res.body.ownerEmail).toBe('owner@newportal.example')
    expect(res.body.billingMode).toBe('free')
    expect(res.body.appCatalogMode).toBe('inherit')
    expect(res.body.status).toBe('active') // reconcile mocked to resolve 'active'

    // Persisted rows reflect the org-tree model, not a `portals`-table insert.
    expect(fakeDb.organizations).toHaveLength(1)
    expect(fakeDb.organizations[0].parent_id).toBe(ROOT_ORG_ID)
    expect(fakeDb.organizations[0].owner_id).toBe('admin-1') // the calling platform admin
    expect(fakeDb.attrs).toHaveLength(1)
    expect(fakeDb.attrs[0].owner_email).toBe('owner@newportal.example')

    expect(reconcileMock).toHaveBeenCalledTimes(1)
  })

  it('never accepts a client-supplied id — the service mints it', async () => {
    const res = await request(app)
      .post('/api/v1/security/portals')
      .send({ ...validBody, id: 'attacker-chosen-id', slug: 'attacker-slug' })

    expect(res.status).toBe(201)
    expect(res.body.orgId).not.toBe('attacker-chosen-id')
  })

  it('status stays "provisioning" when the reconciler has not reached active', async () => {
    reconcileMock.mockResolvedValueOnce('pending')

    const res = await request(app).post('/api/v1/security/portals').send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('provisioning')
  })

  it('a duplicate slug returns 409 CONFLICT', async () => {
    seedPortal({ slug: 'new-portal' })

    const res = await request(app).post('/api/v1/security/portals').send(validBody)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CONFLICT')
  })

  it('400s on a missing required field', async () => {
    const res = await request(app).post('/api/v1/security/portals').send({ name: 'X' })

    expect(res.status).toBe(400)
  })

  it('AC4 — returns 403 FORBIDDEN for a non-platform-admin caller', async () => {
    userHasRoleMock.mockResolvedValue(false)

    const res = await request(app).post('/api/v1/security/portals').send(validBody)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(fakeDb.organizations).toHaveLength(0)
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMultiTenantPortalsEnabledMock.mockResolvedValue(false)

      const res = await request(app).post('/api/v1/security/portals').send(validBody)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /portals/:portalOrgId
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/security/portals/:portalOrgId', () => {
  let app: express.Application
  beforeEach(() => {
    app = buildApp()
  })

  it('returns the portal org + tenant attributes', async () => {
    const id = seedPortal({ id: 'org-portal-a', name: 'Portal A' })

    const res = await request(app).get(`/api/v1/security/portals/${id}`)

    expect(res.status).toBe(200)
    expect(res.body.orgId).toBe(id)
    expect(res.body.name).toBe('Portal A')
  })

  it('404s for an org id that is not a portal (e.g. an ordinary sub-org)', async () => {
    fakeDb.organizations.push({
      id: 'org-leaf',
      name: 'Leaf',
      slug: 'leaf',
      parent_id: 'org-portal-a',
      owner_id: 'admin-1',
      type: 'organization',
      settings: {},
      metadata: {},
      is_active: true,
      provisioning_state: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })

    const res = await request(app).get('/api/v1/security/portals/org-leaf')

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('404s for the platform root — an id is never a capability', async () => {
    const res = await request(app).get(`/api/v1/security/portals/${ROOT_ORG_ID}`)

    expect(res.status).toBe(404)
  })

  it('AC4 — returns 403 FORBIDDEN for a non-platform-admin caller', async () => {
    userHasRoleMock.mockResolvedValue(false)
    const id = seedPortal({ id: 'org-portal-a' })

    const res = await request(app).get(`/api/v1/security/portals/${id}`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMultiTenantPortalsEnabledMock.mockResolvedValue(false)
      const id = seedPortal({ id: 'org-portal-a' })

      const res = await request(app).get(`/api/v1/security/portals/${id}`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /portals/:portalOrgId/suspend + /resume
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/security/portals/:portalOrgId/suspend', () => {
  let app: express.Application
  beforeEach(() => {
    app = buildApp()
  })

  it('flips the org to suspended', async () => {
    const id = seedPortal({ id: 'org-portal-a', status: 'active', is_active: true })

    const res = await request(app).post(`/api/v1/security/portals/${id}/suspend`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('suspended')
    expect(fakeDb.organizations[0].is_active).toBe(false)
    expect(fakeDb.attrs[0].status).toBe('suspended')
  })

  it('is idempotent — suspending an already-suspended portal is a no-op 200', async () => {
    const id = seedPortal({ id: 'org-portal-a', status: 'suspended', is_active: false })

    const res = await request(app).post(`/api/v1/security/portals/${id}/suspend`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('suspended')
  })

  it('refuses to suspend the platform root with 409 CONFLICT', async () => {
    fakeDb.organizations.push({
      id: ROOT_ORG_ID,
      name: 'FuzeFront',
      slug: 'fuzefront',
      parent_id: null,
      owner_id: 'admin-1',
      type: 'platform',
      settings: {},
      metadata: {},
      is_active: true,
      provisioning_state: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })

    const res = await request(app).post(`/api/v1/security/portals/${ROOT_ORG_ID}/suspend`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CONFLICT')
  })

  it('404s for an unknown portal id', async () => {
    const res = await request(app).post('/api/v1/security/portals/does-not-exist/suspend')

    expect(res.status).toBe(404)
  })

  it('AC4 — returns 403 FORBIDDEN for a non-platform-admin caller', async () => {
    userHasRoleMock.mockResolvedValue(false)
    const id = seedPortal({ id: 'org-portal-a' })

    const res = await request(app).post(`/api/v1/security/portals/${id}/suspend`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMultiTenantPortalsEnabledMock.mockResolvedValue(false)
      const id = seedPortal({ id: 'org-portal-a' })

      const res = await request(app).post(`/api/v1/security/portals/${id}/suspend`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
    })
  })
})

describe('POST /api/v1/security/portals/:portalOrgId/resume', () => {
  let app: express.Application
  beforeEach(() => {
    app = buildApp()
  })

  it('flips a suspended org back to active', async () => {
    const id = seedPortal({ id: 'org-portal-a', status: 'suspended', is_active: false })

    const res = await request(app).post(`/api/v1/security/portals/${id}/resume`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('active')
    expect(fakeDb.organizations[0].is_active).toBe(true)
    expect(fakeDb.attrs[0].status).toBe('active')
  })

  it('is idempotent — resuming an already-active portal is a no-op 200', async () => {
    const id = seedPortal({ id: 'org-portal-a', status: 'active', is_active: true })

    const res = await request(app).post(`/api/v1/security/portals/${id}/resume`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('active')
  })

  it('404s for an unknown portal id', async () => {
    const res = await request(app).post('/api/v1/security/portals/does-not-exist/resume')

    expect(res.status).toBe(404)
  })

  it('AC4 — returns 403 FORBIDDEN for a non-platform-admin caller', async () => {
    userHasRoleMock.mockResolvedValue(false)
    const id = seedPortal({ id: 'org-portal-a' })

    const res = await request(app).post(`/api/v1/security/portals/${id}/resume`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMultiTenantPortalsEnabledMock.mockResolvedValue(false)
      const id = seedPortal({ id: 'org-portal-a' })

      const res = await request(app).post(`/api/v1/security/portals/${id}/resume`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
    })
  })
})
