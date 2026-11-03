/**
 * `metadata.personal` is a SERVER-OWNED marker (ensurePersonalOrg stamps it; the
 * host hides any org carrying it from the context switcher and resolves it to the
 * null Personal context — see frontend isPersonalWorkspaceOrg). A client must
 * never set it over HTTP, or it could make an ordinary organization permanently
 * invisible in every member's switcher. POST and PUT must strip it while keeping
 * the caller's other metadata keys. DB, outbox and Permit are mocked.
 */
import request from 'supertest'
import express from 'express'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
}))

jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-owner-id', email: 'owner@example.com', roles: ['user'] }
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

import { db } from '../src/config/database'
import organizationsRouter from '../src/routes/organizations'

const dbMock = db as unknown as jest.Mock & { transaction: jest.Mock }

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', organizationsRouter)
  return app
}

function installDb(orgFirst: (call: number) => any = () => undefined) {
  const inserts: Array<{ table: string; row: any }> = []
  const updates: Array<{ table: string; row: any }> = []
  let orgFirstCalls = 0

  const makeBuilder = (table: string) => ({
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    insert: jest.fn(async (row: any) => {
      inserts.push({ table, row })
      return [1]
    }),
    update: jest.fn(async (row: any) => {
      updates.push({ table, row })
      return 1
    }),
    first: jest.fn(async () => {
      if (table === 'organizations') {
        orgFirstCalls += 1
        return orgFirst(orgFirstCalls)
      }
      return { id: 'm1', role: 'owner' }
    }),
  })

  dbMock.mockImplementation((table: string) => makeBuilder(table))
  dbMock.transaction.mockImplementation(async (cb: any) =>
    cb((table: string) => makeBuilder(table))
  )
  return { inserts, updates }
}

const ORG_ROW = () => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  parent_id: null,
  owner_id: 'user-owner-id',
  type: 'organization',
  settings: '{}',
  metadata: '{}',
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
})

const parseMeta = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v)

describe('POST /api/organizations — metadata.personal is server-owned', () => {
  beforeEach(() => jest.clearAllMocks())

  it('strips a client-supplied metadata.personal while keeping other keys', async () => {
    const { inserts } = installDb(call => (call === 1 ? undefined : ORG_ROW()))

    const res = await request(buildApp())
      .post('/api/organizations')
      .send({ name: 'Acme', slug: 'acme', metadata: { personal: true, team: 'ops' } })

    expect(res.status).toBe(201)
    const orgInsert = inserts.find(i => i.table === 'organizations')!
    const meta = parseMeta(orgInsert.row.metadata)
    expect(meta).not.toHaveProperty('personal')
    expect(meta).toEqual({ team: 'ops' })
  })
})

describe('PUT /api/organizations/:id — metadata.personal is server-owned', () => {
  beforeEach(() => jest.clearAllMocks())

  it('strips a client-supplied metadata.personal on update (no stored marker)', async () => {
    const { updates } = installDb(call => (call === 1 ? undefined : ORG_ROW()))

    const res = await request(buildApp())
      .put('/api/organizations/org-1')
      .send({ name: 'Acme', slug: 'acme', metadata: { personal: true, team: 'ops' } })

    expect(res.status).toBe(200)
    const orgUpdate = updates.find(u => u.table === 'organizations')!
    const meta = parseMeta(orgUpdate.row.metadata)
    expect(meta).not.toHaveProperty('personal')
    expect(meta).toEqual({ team: 'ops' })
  })

  it('PRESERVES an existing stored metadata.personal even when the client omits it', async () => {
    // Without this, PUT replaces the whole metadata column and silently un-marks
    // a personal workspace. call 1 = slug check, call 2 = the current org
    // (marked), call 3 = the re-read inside the update transaction.
    const marked = { ...ORG_ROW(), metadata: JSON.stringify({ personal: true }) }
    const { updates } = installDb(call => (call === 2 ? marked : call === 1 ? undefined : ORG_ROW()))

    const res = await request(buildApp())
      .put('/api/organizations/org-1')
      .send({ name: 'Acme', slug: 'acme', metadata: { team: 'ops' } })

    expect(res.status).toBe(200)
    const orgUpdate = updates.find(u => u.table === 'organizations')!
    const meta = parseMeta(orgUpdate.row.metadata)
    expect(meta.personal).toBe(true)
    expect(meta.team).toBe('ops')
  })
})
