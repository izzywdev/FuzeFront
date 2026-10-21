/**
 * Legacy host-backend POST /api/organizations (and PUT /:id) must never let a
 * client mint or set an organization of type 'platform'. `platform` is a trust
 * marker downstream (org projection `org_type`); only the migration/operator
 * path may create it. DB and Permit reconciler are mocked.
 */
import request from 'supertest'
import express from 'express'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
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
    canManageOrganization: (_req: any, _res: any, next: any) => next(),
  },
  requireOwnership: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../src/identity/flags', () => ({
  isPrefixedIdsEnabled: jest.fn().mockResolvedValue(false),
}))

jest.mock('../src/utils/identityFlag', () => ({
  getRequestPortalScopingEnabled: jest.fn().mockResolvedValue(false),
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
          return orgFirst(orgFirstCalls)
        }
        return { id: 'm1', role: 'owner' }
      }),
    }
    return b
  }

  dbMock.mockImplementation((table: string) => makeBuilder(table))
  dbMock.transaction.mockImplementation(async (cb: any) =>
    cb((table: string) => makeBuilder(table))
  )
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

describe('legacy POST /api/organizations — reserved type "platform"', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['platform', 'Platform', ' platform ', 'PLATFORM'])(
    'rejects type %j with 403 before any DB access — nothing persisted',
    async badType => {
      const { inserts } = installDb()

      const res = await request(buildApp())
        .post('/api/organizations')
        .send({ name: 'Evil', slug: 'evil', type: badType })

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/reserved/i)
      expect(inserts).toHaveLength(0)
      expect(dbMock.transaction).not.toHaveBeenCalled()
      expect(dbMock).not.toHaveBeenCalled()
    }
  )

  it('rejects an unknown type with 400 (existing validation unchanged)', async () => {
    const { inserts } = installDb()
    const res = await request(buildApp())
      .post('/api/organizations')
      .send({ name: 'X', slug: 'x', type: 'bogus' })
    expect(res.status).toBe(400)
    expect(inserts).toHaveLength(0)
  })

  it('rejects an array-typed type that smuggles "platform" without persisting', async () => {
    const { inserts } = installDb()
    const res = await request(buildApp())
      .post('/api/organizations')
      .send({ name: 'X', slug: 'x', type: ['platform'] })
    expect([400, 403]).toContain(res.status)
    expect(inserts).toHaveLength(0)
  })

  it('omitted type defaults to "organization"', async () => {
    const { inserts } = installDb(call =>
      call === 1 ? undefined : ORG_ROW('organization')
    )
    const res = await request(buildApp())
      .post('/api/organizations')
      .send({ name: 'Acme', slug: 'acme' })
    expect(res.status).toBe(201)
    expect(inserts.find(i => i.table === 'organizations')!.row.type).toBe(
      'organization'
    )
  })

  it.each(['organization', 'personal'])('still creates type %s', async okType => {
    const { inserts } = installDb(call =>
      call === 1 ? undefined : ORG_ROW(okType)
    )
    const res = await request(buildApp())
      .post('/api/organizations')
      .send({ name: 'Acme', slug: 'acme', type: okType })
    expect(res.status).toBe(201)
    expect(inserts.find(i => i.table === 'organizations')!.row.type).toBe(okType)
  })
})

describe('legacy PUT /api/organizations/:id — cannot set type', () => {
  beforeEach(() => jest.clearAllMocks())

  it('ignores a client-supplied type: the UPDATE never writes `type`', async () => {
    const { updates } = installDb(call =>
      call === 1 ? undefined : ORG_ROW('organization')
    )
    const res = await request(buildApp())
      .put('/api/organizations/org-1')
      .send({ name: 'Acme', slug: 'acme', type: 'platform' })

    expect(res.status).toBe(200)
    const orgUpdate = updates.find(u => u.table === 'organizations')!
    expect(orgUpdate.row).not.toHaveProperty('type')
    expect(res.body.type).toBe('organization')
  })
})
