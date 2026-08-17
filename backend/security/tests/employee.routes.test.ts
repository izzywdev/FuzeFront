/**
 * FF-EPIC-17-S9 — unit tests for the Employee status + cross-org listing
 * handlers (`GET /api/v1/security/employee/status`, `GET
 * /api/v1/security/employee/orgs`). DB is mocked (no real Postgres
 * required) — mirrors the harness style of
 * `organizations.directory.test.ts` / `employeeRole.test.ts`.
 *
 * `resolveEmployeeStatus` (services/employeeRole.ts) runs FOR REAL — only its
 * `userHasRole` (Permit/ReBAC) dependency is mocked, so the ReBAC-derived
 * `isEmployee` path is genuinely exercised rather than stubbed away.
 */
import request from 'supertest'
import express from 'express'

// `routes/security.ts` transitively imports `config/permit.ts` (via the
// AuthentikIdentityProvider -> organizationProvisioning -> permit chain),
// which fail-closes at import time without a configured API key. No real
// Permit calls happen in this suite (`userHasRole` is mocked below).
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
    raw: jest.fn(),
  }),
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.__testUser ?? { id: 'user-1', email: 'user1@example.com', roles: ['user'] }
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

// FF-EPIC-17-S9 — the flag under test. Default the mock to ON so tests that
// don't care about the flag exercise the real (built) behavior; the
// "flag OFF" describe blocks below override per-test.
jest.mock('../src/utils/employeeFlag', () => ({
  EMPLOYEE_CONSOLE_FLAG: 'fuzefront.identity.employee-console',
  isEmployeeConsoleEnabled: jest.fn().mockResolvedValue(true),
}))

import { db } from '../src/config/database'
import { userHasRole } from '../src/utils/permit/role-assignment'
import { isEmployeeConsoleEnabled } from '../src/utils/employeeFlag'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'
import securityRouter from '../src/routes/security'

const dbMock = db as jest.MockedFunction<any>
const dbRawMock = (db as any).raw as jest.Mock
const userHasRoleMock = userHasRole as jest.Mock
const isEmployeeConsoleEnabledMock = isEmployeeConsoleEnabled as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}

const USER_ID = 'user-1'

// resolveEmployeeStatus's id-only membership-select chain:
// db('organization_memberships').where().whereNot().select()
function makeMembershipIdsChain(rows: Array<{ organization_id: string }>) {
  return {
    where: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(rows),
  }
}

// The route's own enrichment join query:
// db('organization_memberships as om').join(...).where().whereIn().select()
function makeEnrichChain(rows: any[]) {
  return {
    join: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(rows),
  }
}

function wireStatusQueries(opts: { membershipIds?: Array<{ organization_id: string }>; enrichRows?: any[] }) {
  const idsChain = makeMembershipIdsChain(opts.membershipIds ?? [])
  const enrichChain = makeEnrichChain(opts.enrichRows ?? [])
  dbMock.mockImplementation((table: string) => {
    if (table === 'organization_memberships') return idsChain
    if (table === 'organization_memberships as om') return enrichChain
    throw new Error(`unexpected table: ${table}`)
  })
  return { idsChain, enrichChain }
}

type FakeOrgNode = {
  id: string
  name: string
  parent_id: string | null
  depth: number
  member_count: number
}

// Emulates the recursive-CTE query's semantics against an in-memory tree, so
// pagination (limit clamp + keyset cursor walk) is exercised against real
// filter/sort/slice logic rather than a blind "were these args passed" check.
function makeOrgTreeRawMock(nodes: FakeOrgNode[]) {
  return jest.fn(async (_sql: string, bindings: any[]) => {
    const hasCursor = bindings.length === 4
    const limitPlusOne = bindings[bindings.length - 1]
    let filtered = nodes
    if (hasCursor) {
      const cursorDepth = bindings[1]
      const cursorId = bindings[2]
      filtered = nodes.filter(
        n => n.depth > cursorDepth || (n.depth === cursorDepth && n.id > cursorId)
      )
    }
    const sorted = [...filtered].sort(
      (a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    return { rows: sorted.slice(0, limitPlusOne) }
  })
}

const FAKE_TREE: FakeOrgNode[] = [
  { id: ROOT_ORG_ID, name: 'FuzeFront', parent_id: null, depth: 0, member_count: 3 },
  { id: 'org-portal-a', name: 'Portal A', parent_id: ROOT_ORG_ID, depth: 1, member_count: 2 },
  { id: 'org-portal-b', name: 'Portal B', parent_id: ROOT_ORG_ID, depth: 1, member_count: 1 },
  { id: 'org-leaf-a1', name: 'Leaf A1', parent_id: 'org-portal-a', depth: 2, member_count: 0 },
  { id: 'org-leaf-b1', name: 'Leaf B1', parent_id: 'org-portal-b', depth: 2, member_count: 0 },
]

function decodeCursor(cursor: string): { depth: number; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const idx = decoded.indexOf('|')
  return { depth: parseInt(decoded.slice(0, idx), 10), id: decoded.slice(idx + 1) }
}

beforeEach(() => {
  jest.clearAllMocks()
  isEmployeeConsoleEnabledMock.mockResolvedValue(true)
  userHasRoleMock.mockResolvedValue(false)
})

describe('GET /api/v1/security/employee/status', () => {
  let app: express.Application

  beforeEach(() => {
    app = buildApp()
  })

  it('isEmployee=true when the ReBAC org-admin-on-root grant is held', async () => {
    userHasRoleMock.mockResolvedValue(true)
    wireStatusQueries({ membershipIds: [] })

    const res = await request(app).get('/api/v1/security/employee/status')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ isEmployee: true, directOrgMemberships: [] })
  })

  it('isEmployee=false when the ReBAC grant is absent', async () => {
    userHasRoleMock.mockResolvedValue(false)
    wireStatusQueries({ membershipIds: [] })

    const res = await request(app).get('/api/v1/security/employee/status')

    expect(res.status).toBe(200)
    expect(res.body.isEmployee).toBe(false)
  })

  it('directOrgMemberships excludes the platform root and reports name+role', async () => {
    userHasRoleMock.mockResolvedValue(true)
    wireStatusQueries({
      membershipIds: [{ organization_id: 'org-42' }],
      enrichRows: [{ org_id: 'org-42', role: 'admin', org_name: 'Acme Co' }],
    })

    const res = await request(app).get('/api/v1/security/employee/status')

    expect(res.status).toBe(200)
    expect(res.body.directOrgMemberships).toEqual([
      { orgId: 'org-42', orgName: 'Acme Co', role: 'admin' },
    ])
    // Never the root org, per AC2/AC3 of the S8 domain logic this reuses.
    expect(res.body.directOrgMemberships.some((m: any) => m.orgId === ROOT_ORG_ID)).toBe(false)
  })

  it('skips the enrichment query entirely for a pure Employee (zero membership rows)', async () => {
    userHasRoleMock.mockResolvedValue(true)
    const { enrichChain } = wireStatusQueries({ membershipIds: [] })

    const res = await request(app).get('/api/v1/security/employee/status')

    expect(res.status).toBe(200)
    expect(res.body.directOrgMemberships).toEqual([])
    expect(enrichChain.select).not.toHaveBeenCalled()
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isEmployeeConsoleEnabledMock.mockResolvedValueOnce(false)

      const res = await request(app).get('/api/v1/security/employee/status')

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
      expect(userHasRoleMock).not.toHaveBeenCalled()
    })
  })
})

describe('GET /api/v1/security/employee/orgs', () => {
  let app: express.Application

  beforeEach(() => {
    app = buildApp()
    // resolveEmployeeStatus's own query is always run (isEmployee derivation);
    // its directOrgMemberships result is irrelevant to this endpoint.
    wireStatusQueries({ membershipIds: [] })
  })

  it('returns a flat PageInfo page of root + descendants for an Employee', async () => {
    userHasRoleMock.mockResolvedValue(true)
    dbRawMock.mockImplementation(makeOrgTreeRawMock(FAKE_TREE))

    const res = await request(app).get('/api/v1/security/employee/orgs')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(5)
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false })

    const root = res.body.items.find((n: any) => n.orgId === ROOT_ORG_ID)
    expect(root).toMatchObject({ kind: 'root', parentOrgId: null, depth: 0, memberCount: 3 })

    const portal = res.body.items.find((n: any) => n.orgId === 'org-portal-a')
    expect(portal).toMatchObject({ kind: 'portal', parentOrgId: ROOT_ORG_ID, depth: 1 })

    const leaf = res.body.items.find((n: any) => n.orgId === 'org-leaf-a1')
    expect(leaf).toMatchObject({ kind: 'organization', parentOrgId: 'org-portal-a', depth: 2 })
  })

  it('defaults limit to 50 and clamps an over-max limit to 200 (server-side)', async () => {
    userHasRoleMock.mockResolvedValue(true)
    const rawMock = makeOrgTreeRawMock(FAKE_TREE)
    dbRawMock.mockImplementation(rawMock)

    await request(app).get('/api/v1/security/employee/orgs')
    let bindings = rawMock.mock.calls[0][1]
    expect(bindings[bindings.length - 1]).toBe(51) // default 50 + 1

    rawMock.mockClear()
    await request(app).get('/api/v1/security/employee/orgs?limit=999')
    bindings = rawMock.mock.calls[0][1]
    expect(bindings[bindings.length - 1]).toBe(201) // clamped to 200 + 1
  })

  it('paginates the full subtree with no gaps/dupes across a cursor walk', async () => {
    userHasRoleMock.mockResolvedValue(true)
    dbRawMock.mockImplementation(makeOrgTreeRawMock(FAKE_TREE))

    const collected: string[] = []
    let cursor: string | undefined
    let hasMore = true
    let iterations = 0

    while (hasMore && iterations < 10) {
      iterations++
      const url = cursor
        ? `/api/v1/security/employee/orgs?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/v1/security/employee/orgs?limit=2'
      const res = await request(app).get(url)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeLessThanOrEqual(2)
      collected.push(...res.body.items.map((i: any) => i.orgId))
      hasMore = res.body.page.hasMore
      cursor = res.body.page.nextCursor ?? undefined
    }

    // Walked the full 5-node tree, deterministically, no gaps or duplicates.
    expect(collected).toHaveLength(5)
    expect(new Set(collected).size).toBe(5)
    expect(new Set(collected)).toEqual(
      new Set(FAKE_TREE.map(n => n.id))
    )
  })

  it('the emitted cursor round-trips to the correct (depth, id) keyset position', async () => {
    userHasRoleMock.mockResolvedValue(true)
    dbRawMock.mockImplementation(makeOrgTreeRawMock(FAKE_TREE))

    const res = await request(app).get('/api/v1/security/employee/orgs?limit=2')
    expect(res.body.page.hasMore).toBe(true)
    const decoded = decodeCursor(res.body.page.nextCursor)
    const lastItem = res.body.items[res.body.items.length - 1]
    expect(decoded).toEqual({ depth: lastItem.depth, id: lastItem.orgId })
  })

  it('400s on a malformed cursor', async () => {
    userHasRoleMock.mockResolvedValue(true)
    dbRawMock.mockImplementation(makeOrgTreeRawMock(FAKE_TREE))

    const res = await request(app).get('/api/v1/security/employee/orgs?cursor=not-valid-base64url!!!')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
  })

  it('returns 403 FORBIDDEN for a non-Employee caller — real fail-closed, no id-as-capability', async () => {
    userHasRoleMock.mockResolvedValue(false)

    const res = await request(app).get('/api/v1/security/employee/orgs')

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
    expect(dbRawMock).not.toHaveBeenCalled()
  })

  describe('flag OFF', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isEmployeeConsoleEnabledMock.mockResolvedValueOnce(false)

      const res = await request(app).get('/api/v1/security/employee/orgs')

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(userHasRoleMock).not.toHaveBeenCalled()
      expect(dbRawMock).not.toHaveBeenCalled()
    })
  })
})
