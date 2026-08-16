/**
 * Unit tests for GET /api/organizations/:id/directory (FF-EPIC-17-S5 — the
 * root/portal member directory). DB and eventPublisher are mocked — no real
 * Postgres required. Mirrors the harness style from
 * organizations.members.test.ts exactly.
 */
import request from 'supertest'
import express from 'express'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
}))

jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.__testUser ?? {
      id: 'user-owner-id',
      email: 'owner@example.com',
      roles: ['user'],
    }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/middleware/permissions', () => ({
  PermissionMiddleware: {
    canReadOrganization: (_req: any, _res: any, next: any) => next(),
    canUpdateOrganization: (_req: any, _res: any, next: any) => next(),
    canDeleteOrganization: (_req: any, _res: any, next: any) => next(),
    canInviteUsers: (_req: any, _res: any, next: any) => next(),
    canViewMembers: (_req: any, _res: any, next: any) => next(),
  },
  requireOwnership: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue(undefined),
}))

// `resolveEmployeeStatus` (services/employeeRole.ts) is used FOR REAL by the
// directory route's authz — only its `userHasRole` (ReBAC) dependency is
// mocked, so the Employee/ReBAC access path is genuinely exercised rather
// than stubbed away.
jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
  assignRoleInPermit: jest.fn().mockResolvedValue(true),
  unassignRoleInPermit: jest.fn().mockResolvedValue(true),
  getUserRoleAssignments: jest.fn().mockResolvedValue([]),
  getTenantRoleAssignments: jest.fn().mockResolvedValue([]),
  userHasRole: jest.fn().mockResolvedValue(false),
  updateOrganizationRole: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/utils/employeeFlag', () => ({
  EMPLOYEE_CONSOLE_FLAG: 'fuzefront.identity.employee-console',
  isEmployeeConsoleEnabled: jest.fn().mockResolvedValue(false),
}))

// FF-EPIC-17-S5 — the flag under test. Default the mock to ON so tests that
// don't care about the flag exercise the real (built) behavior; the
// "flag OFF" describe block below overrides per-test.
jest.mock('../src/utils/memberDirectoryFlag', () => ({
  MEMBER_DIRECTORY_FLAG: 'fuzefront.identity.member-directory',
  isMemberDirectoryEnabled: jest.fn().mockResolvedValue(true),
}))

import { db } from '../src/config/database'
import { userHasRole } from '../src/utils/permit/role-assignment'
import { isMemberDirectoryEnabled } from '../src/utils/memberDirectoryFlag'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'
import organizationsRouter from '../src/routes/organizations'

const dbMock = db as jest.MockedFunction<any>
const userHasRoleMock = userHasRole as jest.Mock
const isMemberDirectoryEnabledMock = isMemberDirectoryEnabled as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', organizationsRouter)
  return app
}

const USER_ID = 'user-owner-id'
const OWNER_ID = 'user-owner-id'
const PORTAL_ID = 'org-portal-id'
const LEAF_ORG_ID = 'org-leaf-id'

function makeDbQuery(returnValue: any) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNotNull: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    delete: jest.fn().mockResolvedValue(1),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
  }
  return chain
}

// Terminal `.select(...)` resolving an array directly — the shape
// resolveEmployeeStatus's `directOrgMemberships` lookup uses
// (`.where().whereNot().select()`, no `.first()`).
function makeEmployeeMembershipsChain(rows: any[] = []) {
  return {
    where: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(rows),
  }
}

// Chainable mock for the paginated directory list query. Captures
// limit/offset/whereRaw so tests can assert clamping + search behavior.
function makePaginatedDirectoryChain(rows: any[]) {
  const captured: any = { limit: undefined, offset: undefined, whereRawArgs: undefined }
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereRaw: jest.fn(function (this: any, _sql: string, bindings: any) {
      captured.whereRawArgs = bindings
      return this
    }),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn(function (this: any, n: number) {
      captured.limit = n
      return this
    }),
    offset: jest.fn(function (this: any, n: number) {
      captured.offset = n
      // offset terminates the awaited chain -> resolve rows
      return Promise.resolve(rows)
    }),
  }
  return { chain, captured }
}

function makeCountChain(total: number) {
  const captured: any = { whereRawArgs: undefined }
  const chain: any = {
    join: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereRaw: jest.fn(function (this: any, _sql: string, bindings: any) {
      captured.whereRawArgs = bindings
      return this
    }),
    count: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue({ count: String(total) }),
  }
  return { chain, captured }
}

describe('GET /api/organizations/:id/directory', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    isMemberDirectoryEnabledMock.mockResolvedValue(true)
    userHasRoleMock.mockResolvedValue(false)
    app = buildApp()
  })

  const rootOrgRow = {
    id: ROOT_ORG_ID,
    name: 'FuzeFront',
    slug: 'fuzefront',
    parent_id: null,
    owner_id: 'platform-registrar-id',
    type: 'platform',
  }

  const portalOrgRow = {
    id: PORTAL_ID,
    name: 'Acme Portal',
    slug: 'acme',
    parent_id: ROOT_ORG_ID,
    owner_id: OWNER_ID,
    type: 'organization',
  }

  const leafOrgRow = {
    id: LEAF_ORG_ID,
    name: 'Acme Sub-team',
    slug: 'acme-sub',
    parent_id: PORTAL_ID, // NOT a direct child of root -> not directory-eligible
    owner_id: OWNER_ID,
    type: 'organization',
  }

  const memberRow = (overrides: Partial<any> = {}) => ({
    role: 'member',
    joined_at: new Date('2024-01-15').toISOString(),
    user_id: 'other-user-id',
    user_email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Smith',
    ...overrides,
  })

  // Wires the dbMock so that, for the directory route's happy path:
  //   'organizations' call 1  = org lookup
  //   'organization_memberships' call 1 = requireOrgAdminOrOwner caller check
  //   'organization_memberships' call 2 = (only if not org-admin) employeeRole's directOrgMemberships select
  //   'organization_memberships' call N = COUNT query
  //   'organization_memberships' call N+1 = paginated list query
  function wireDirectoryQueries(opts: {
    orgRow: any | null
    callerIsOrgAdmin?: boolean
    total: number
    rows: any[]
  }) {
    const orgChain = makeDbQuery(opts.orgRow)
    const callerChain = makeDbQuery(
      opts.callerIsOrgAdmin === false
        ? null
        : { id: 'mem-1', user_id: USER_ID, organization_id: opts.orgRow?.id, role: 'owner', status: 'active' }
    )
    const employeeMembershipsChain = makeEmployeeMembershipsChain([])
    const count = makeCountChain(opts.total)
    const list = makePaginatedDirectoryChain(opts.rows)

    let membershipCalls = 0
    dbMock.mockImplementation((table: string) => {
      if (table === 'organizations') return orgChain
      if (table === 'organization_memberships') {
        membershipCalls++
        if (membershipCalls === 1) return callerChain
        if (opts.callerIsOrgAdmin === false && membershipCalls === 2) {
          return employeeMembershipsChain
        }
        const countAlreadyReturned =
          opts.callerIsOrgAdmin === false ? membershipCalls === 3 : membershipCalls === 2
        return countAlreadyReturned ? count.chain : list.chain
      }
      return makeDbQuery(null)
    })
    return { count, list, orgChain, callerChain }
  }

  // ─── Flag ON (default in this describe) ────────────────────────────────

  it('returns a DirectoryPage with items + page/pageSize/total envelope', async () => {
    wireDirectoryQueries({ orgRow: rootOrgRow, total: 1, rows: [memberRow()] })

    const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.page).toBe(1)
    expect(res.body.pageSize).toBe(50)
    expect(res.body.total).toBe(1)

    const item = res.body.items[0]
    expect(item.userId).toBe('other-user-id')
    expect(item.email).toBe('alice@example.com')
    expect(item.displayName).toBe('Alice Smith')
    expect(item.role).toBe('member')
    expect(item).toHaveProperty('joinedAt')
    expect(item.isSelf).toBe(false)
  })

  it('resolves role=owner from owner_id even when the membership row differs', async () => {
    wireDirectoryQueries({
      orgRow: rootOrgRow,
      total: 1,
      rows: [memberRow({ user_id: rootOrgRow.owner_id, role: 'member' })],
    })

    const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

    expect(res.status).toBe(200)
    expect(res.body.items[0].role).toBe('owner')
  })

  it('marks isSelf=true for the caller\'s own row', async () => {
    wireDirectoryQueries({
      orgRow: rootOrgRow,
      total: 1,
      rows: [memberRow({ user_id: USER_ID })],
    })

    const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

    expect(res.status).toBe(200)
    expect(res.body.items[0].isSelf).toBe(true)
  })

  it('accepts a portal-root org (direct child of the platform root)', async () => {
    wireDirectoryQueries({ orgRow: portalOrgRow, total: 1, rows: [memberRow()] })

    const res = await request(app).get(`/api/organizations/${PORTAL_ID}/directory`)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
  })

  it('honors limit/offset and computes the 1-based page', async () => {
    const { list } = wireDirectoryQueries({ orgRow: rootOrgRow, total: 120, rows: [memberRow()] })

    const res = await request(app)
      .get(`/api/organizations/${ROOT_ORG_ID}/directory?limit=20&offset=40`)

    expect(res.status).toBe(200)
    expect(res.body.pageSize).toBe(20)
    expect(res.body.page).toBe(3) // floor(40/20) + 1
    expect(list.captured.limit).toBe(20)
    expect(list.captured.offset).toBe(40)
  })

  it('defaults limit to 50 and clamps an over-max limit to 200', async () => {
    const { list } = wireDirectoryQueries({ orgRow: rootOrgRow, total: 500, rows: [memberRow()] })

    const res = await request(app)
      .get(`/api/organizations/${ROOT_ORG_ID}/directory?limit=999`)

    expect(res.status).toBe(200)
    expect(res.body.pageSize).toBe(200)
    expect(list.captured.limit).toBe(200)
  })

  it('falls back to defaults for junk limit/offset', async () => {
    const { list } = wireDirectoryQueries({ orgRow: rootOrgRow, total: 5, rows: [memberRow()] })

    const res = await request(app)
      .get(`/api/organizations/${ROOT_ORG_ID}/directory?limit=abc&offset=xyz`)

    expect(res.status).toBe(200)
    expect(res.body.pageSize).toBe(50)
    expect(list.captured.limit).toBe(50)
    expect(list.captured.offset).toBe(0)
  })

  it('filters by query (email/displayName) on both list and count queries', async () => {
    const { count, list } = wireDirectoryQueries({ orgRow: rootOrgRow, total: 1, rows: [memberRow()] })

    const res = await request(app)
      .get(`/api/organizations/${ROOT_ORG_ID}/directory?query=ALICE`)

    expect(res.status).toBe(200)
    const expectedBindings = ['%alice%', '%alice%', '%alice%']
    expect(list.captured.whereRawArgs).toEqual(expectedBindings)
    expect(count.captured.whereRawArgs).toEqual(expectedBindings)
  })

  it('grants access to an Employee (ReBAC org-admin-on-root) who is NOT an org admin/owner', async () => {
    userHasRoleMock.mockResolvedValue(true)
    wireDirectoryQueries({
      orgRow: rootOrgRow,
      callerIsOrgAdmin: false,
      total: 1,
      rows: [memberRow()],
    })

    const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
  })

  it('returns 403 FORBIDDEN when the caller is neither org admin/owner nor Employee', async () => {
    userHasRoleMock.mockResolvedValue(false)
    wireDirectoryQueries({
      orgRow: rootOrgRow,
      callerIsOrgAdmin: false,
      total: 0,
      rows: [],
    })

    const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  it('returns 404 for an unknown organization id', async () => {
    wireDirectoryQueries({ orgRow: null, total: 0, rows: [] })

    const res = await request(app).get(`/api/organizations/does-not-exist/directory`)

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('returns 404 for an org that is neither the platform root nor a portal root', async () => {
    wireDirectoryQueries({ orgRow: leafOrgRow, total: 0, rows: [] })

    const res = await request(app).get(`/api/organizations/${LEAF_ORG_ID}/directory`)

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  // ─── Flag OFF ───────────────────────────────────────────────────────────

  describe('flag OFF (default)', () => {
    it('renders 404 exactly as if the route does not exist — no DB access at all', async () => {
      isMemberDirectoryEnabledMock.mockResolvedValueOnce(false)

      const res = await request(app).get(`/api/organizations/${ROOT_ORG_ID}/directory`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
      expect(dbMock).not.toHaveBeenCalled()
    })
  })
})
