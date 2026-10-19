/**
 * POST /api/organizations (and PUT /:id) must never let a client mint or set an
 * organization of type 'platform'. `platform` is a trust marker downstream (the
 * org projection's `org_type`); only the migration/operator path may create it.
 * DB, outbox and Permit reconciler are mocked — no Postgres required.
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
import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'
import organizationsRouter from '../src/routes/organizations'

const dbMock = db as unknown as jest.Mock & { transaction: jest.Mock }
const enqueueEventMock = enqueueEvent as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', organizationsRouter)
  return app
}

/** Records every insert/update per table; `.first()` resolves per-table rows. */
function installDb(opts: { orgFirst?: (call: number) => any } = {}) {
  const inserts: Array<{ table: string; row: any }> = []
  const updates: Array<{ table: string; row: any }> = []
  let orgFirstCalls = 0

  const makeBuilder = (table: string) => {
    const b: any = {
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
          return opts.orgFirst ? opts.orgFirst(orgFirstCalls) : undefined
        }
        // organization_memberships lookups (owner/admin check)
        return { id: 'm1', role: 'owner' }
      }),
    }
    return b
  }

  dbMock.mockImplementation((table: string) => makeBuilder(table))
  dbMock.transaction.mockImplementation(async (cb: any) => {
    const trx: any = (table: string) => makeBuilder(table)
    return cb(trx)
  })
  return { inserts, updates }
}

const ORG_ROW = (type: string) => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  parent_id: null,
  owner_id: 'user-owner-id',
  type,
  settings: '{}',
  metadata: '{}',
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
})

describe('POST /api/organizations — reserved type "platform"', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it.each(['platform', 'Platform', ' platform ', 'PLATFORM'])(
    'rejects type %j with 403 — nothing persisted, no event emitted',
    async badType => {
      const { inserts } = installDb()

      const res = await request(app)
        .post('/api/organizations')
        .send({ name: 'Evil', slug: 'evil', type: badType })

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/reserved/i)
      expect(inserts).toHaveLength(0)
      expect(dbMock.transaction).not.toHaveBeenCalled()
      expect(dbMock).not.toHaveBeenCalled() // rejected before ANY db access
      expect(enqueueEventMock).not.toHaveBeenCalled()
    }
  )

  it('rejects an unknown type with 400 (existing validation unchanged)', async () => {
    const { inserts } = installDb()
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'X', slug: 'x', type: 'bogus' })
    expect(res.status).toBe(400)
    expect(inserts).toHaveLength(0)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string type that smuggles "platform" (array) without persisting', async () => {
    const { inserts } = installDb()
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'X', slug: 'x', type: ['platform'] })
    expect([400, 403]).toContain(res.status)
    expect(inserts).toHaveLength(0)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('omitted type defaults to "organization" and emits identity.org.created with that type', async () => {
    const { inserts } = installDb({
      orgFirst: call => (call === 1 ? undefined : ORG_ROW('organization')),
    })

    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Acme', slug: 'acme' })

    expect(res.status).toBe(201)
    const orgInsert = inserts.find(i => i.table === 'organizations')!
    expect(orgInsert.row.type).toBe('organization')
    const created = enqueueEventMock.mock.calls.find(
      c => c[1] === TOPICS.IDENTITY_ORG_CREATED
    )!
    expect(created[2].type).toBe('organization')
  })

  it.each(['organization', 'personal'])(
    'still creates type %s and emits it on identity.org.created',
    async okType => {
      const { inserts } = installDb({
        orgFirst: call => (call === 1 ? undefined : ORG_ROW(okType)),
      })

      const res = await request(app)
        .post('/api/organizations')
        .send({ name: 'Acme', slug: 'acme', type: okType })

      expect(res.status).toBe(201)
      expect(inserts.find(i => i.table === 'organizations')!.row.type).toBe(okType)
      const created = enqueueEventMock.mock.calls.filter(
        c => c[1] === TOPICS.IDENTITY_ORG_CREATED
      )
      expect(created).toHaveLength(1)
      expect(created[0][2].type).toBe(okType)
      // No event emitted from the HTTP path may ever carry 'platform'.
      for (const c of enqueueEventMock.mock.calls) {
        expect(c[2]?.type).not.toBe('platform')
      }
    }
  )
})

describe('PUT /api/organizations/:id — cannot set type', () => {
  beforeEach(() => jest.clearAllMocks())

  it('ignores a client-supplied type: the UPDATE never writes `type`, event keeps the stored type', async () => {
    const { updates } = installDb({ orgFirst: call => (call === 1 ? undefined : ORG_ROW('organization')) })

    const res = await request(buildApp())
      .put('/api/organizations/org-1')
      .send({ name: 'Acme', slug: 'acme', type: 'platform' })

    expect(res.status).toBe(200)
    const orgUpdate = updates.find(u => u.table === 'organizations')!
    expect(orgUpdate.row).not.toHaveProperty('type')
    expect(res.body.type).toBe('organization')
    const updated = enqueueEventMock.mock.calls.find(
      c => c[1] === TOPICS.IDENTITY_ORG_UPDATED
    )!
    expect(updated[2].type).toBe('organization')
  })
})
