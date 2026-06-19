/**
 * Unit tests for organization invitation routes.
 * DB and eventPublisher are mocked — no real Postgres required.
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

jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
  assignRoleInPermit: jest.fn().mockResolvedValue(true),
  unassignRoleInPermit: jest.fn().mockResolvedValue(true),
  getUserRoleAssignments: jest.fn().mockResolvedValue([]),
  getTenantRoleAssignments: jest.fn().mockResolvedValue([]),
  userHasRole: jest.fn().mockResolvedValue(false),
  updateOrganizationRole: jest.fn().mockResolvedValue(true),
}))

import { db } from '../src/config/database'
import { defaultEventPublisher } from '../src/services/eventPublisher'
import organizationsRouter from '../src/routes/organizations'
import invitationsRouter from '../src/routes/invitations'

const dbMock = db as jest.MockedFunction<any>
const publishMock = defaultEventPublisher.publishNotifyEmailRequested as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', organizationsRouter)
  app.use('/api/invitations', invitationsRouter)
  return app
}

const ORG_ID = 'org-test-id'
const USER_ID = 'user-owner-id'
const INV_ID = 'inv-test-id'
const TOKEN = 'a'.repeat(64)

function makeDbQuery(returnValue: any) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNotNull: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue(returnValue !== null ? [returnValue] : []),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
  }
  return chain
}

describe('Organization Invitations', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  describe('POST /api/organizations/:id/invitations', () => {
    it('returns 201 and fires email event when org admin creates invitation', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active' })
      const existingInviteChain = makeDbQuery(null)
      const insertChain = { ...makeDbQuery(null), insert: jest.fn().mockResolvedValue([1]) }
      const orgChain = makeDbQuery({ id: ORG_ID, name: 'Test Org' })
      const userChain = makeDbQuery({ id: USER_ID, email: 'owner@example.com', first_name: 'Alice', last_name: 'Smith' })

      let invCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        if (table === 'organization_invitations') {
          invCallCount++
          return invCallCount === 1 ? existingInviteChain : insertChain
        }
        if (table === 'organizations') return orgChain
        if (table === 'users') return userChain
        return makeDbQuery(null)
      })

      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ email: 'newuser@example.com', role: 'member' })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('invitation')
      expect(res.body.invitation.email).toBe('newuser@example.com')
      expect(publishMock).toHaveBeenCalledTimes(1)
      const emailPayload = publishMock.mock.calls[0][0]
      expect(emailPayload.template).toBe('org-invite')
      expect(emailPayload.to).toBe('newuser@example.com')
    })

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ role: 'member' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when email format is invalid', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ email: 'not-an-email' })
      expect(res.status).toBe(400)
    })

    it('returns 403 when user is not an owner or admin', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ email: 'newuser@example.com', role: 'member' })
      expect(res.status).toBe(403)
    })

    it('returns 409 when invitation already pending for email', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner' })
      const existingInviteChain = makeDbQuery({ id: INV_ID, status: 'pending' })
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        return existingInviteChain
      })
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ email: 'newuser@example.com', role: 'member' })
      expect(res.status).toBe(409)
    })
  })

  describe('GET /api/organizations/:id/invitations', () => {
    it('returns 200 with list of invitations for org admin', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner' })
      const invListChain: any = {
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          { id: INV_ID, email: 'user@example.com', role: 'member', status: 'pending', token: TOKEN, expires_at: new Date(Date.now() + 86400000), invited_by: USER_ID, created_at: new Date() }
        ]),
      }
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        if (table === 'organization_invitations') return invListChain
        return makeDbQuery(null)
      })
      const res = await request(app).get(`/api/organizations/${ORG_ID}/invitations`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.invitations)).toBe(true)
    })

    it('returns 403 when user is not an owner or admin', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))
      const res = await request(app).get(`/api/organizations/${ORG_ID}/invitations`)
      expect(res.status).toBe(403)
    })
  })

  describe('DELETE /api/organizations/:id/invitations/:invitationId', () => {
    it('revokes a pending invitation', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner' })
      const invChain = makeDbQuery({ id: INV_ID, status: 'pending', organization_id: ORG_ID })
      const updateChain = { where: jest.fn().mockReturnThis(), update: jest.fn().mockResolvedValue(1) }
      let invCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        if (table === 'organization_invitations') {
          invCallCount++
          return invCallCount === 1 ? invChain : updateChain
        }
        return makeDbQuery(null)
      })
      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/invitations/${INV_ID}`)
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/revoked/i)
    })

    it('returns 404 if invitation does not exist', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner' })
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        return makeDbQuery(null)
      })
      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/invitations/${INV_ID}`)
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/invitations/:token', () => {
    it('returns invitation + org details for valid pending token', async () => {
      const invChain = makeDbQuery({
        id: INV_ID, email: 'user@example.com', role: 'member',
        status: 'pending', expires_at: new Date(Date.now() + 86400000), organization_id: ORG_ID,
      })
      const orgChain = makeDbQuery({ id: ORG_ID, name: 'Test Org', slug: 'test-org' })
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_invitations') return invChain
        if (table === 'organizations') return orgChain
        return makeDbQuery(null)
      })
      const res = await request(app).get(`/api/invitations/${TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('invitation')
      expect(res.body).toHaveProperty('organization')
      expect(res.body.organization.name).toBe('Test Org')
    })

    it('returns 404 for unknown token', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))
      const res = await request(app).get('/api/invitations/unknowntoken123')
      expect(res.status).toBe(404)
    })

    it('returns 410 for expired invitation', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery({
        id: INV_ID, email: 'user@example.com', role: 'member',
        status: 'pending', expires_at: new Date(Date.now() - 86400000), organization_id: ORG_ID,
      }))
      const res = await request(app).get(`/api/invitations/${TOKEN}`)
      expect(res.status).toBe(410)
    })

    it('returns 410 for revoked invitation', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery({
        id: INV_ID, email: 'user@example.com', role: 'member',
        status: 'revoked', expires_at: new Date(Date.now() + 86400000), organization_id: ORG_ID,
      }))
      const res = await request(app).get(`/api/invitations/${TOKEN}`)
      expect(res.status).toBe(410)
    })
  })

  describe('POST /api/invitations/:token/accept', () => {
    it('returns 403 when authenticated user email does not match invitation email', async () => {
      const wrongEmailApp = express()
      wrongEmailApp.use(express.json())
      wrongEmailApp.use((req: any, _res: any, next: any) => {
        req.user = { id: 'other-user', email: 'other@example.com', roles: [] }
        next()
      })
      wrongEmailApp.use('/api/invitations', invitationsRouter)
      dbMock.mockImplementation((_table: string) => makeDbQuery({
        id: INV_ID, email: 'user@example.com', role: 'member',
        status: 'pending', expires_at: new Date(Date.now() + 86400000), organization_id: ORG_ID,
      }))
      const res = await request(wrongEmailApp).post(`/api/invitations/${TOKEN}/accept`)
      expect(res.status).toBe(403)
    })

    it('returns 409 when invitation is already accepted', async () => {
      const acceptedApp = express()
      acceptedApp.use(express.json())
      acceptedApp.use((req: any, _res: any, next: any) => {
        req.user = { id: USER_ID, email: 'user@example.com', roles: [] }
        next()
      })
      acceptedApp.use('/api/invitations', invitationsRouter)
      dbMock.mockImplementation((_table: string) => makeDbQuery({
        id: INV_ID, email: 'user@example.com', role: 'member',
        status: 'accepted', expires_at: new Date(Date.now() + 86400000), organization_id: ORG_ID,
      }))
      const res = await request(acceptedApp).post(`/api/invitations/${TOKEN}/accept`)
      expect(res.status).toBe(409)
    })
  })

  describe('POST /api/organizations/:id/invitations/bulk', () => {
    it('returns 201 with results array for bulk invite', async () => {
      const membershipChain = makeDbQuery({ id: 'mem-1', role: 'owner' })
      const existingChain = makeDbQuery(null)
      const orgChain = makeDbQuery({ id: ORG_ID, name: 'Test Org' })
      const userChain = makeDbQuery({ id: USER_ID, email: 'owner@example.com', first_name: 'Alice', last_name: 'Smith' })
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return membershipChain
        if (table === 'organization_invitations') return existingChain
        if (table === 'organizations') return orgChain
        if (table === 'users') return userChain
        return makeDbQuery(null)
      })
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations/bulk`)
        .send({ emails: ['a@example.com', 'b@example.com'], role: 'member' })
      expect(res.status).toBe(201)
      expect(Array.isArray(res.body.results)).toBe(true)
    })

    it('returns 400 when emails array exceeds 50', async () => {
      const emails = Array.from({ length: 51 }, (_, i) => `user${i}@example.com`)
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations/bulk`)
        .send({ emails, role: 'member' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/exceed/i)
    })

    it('returns 400 when emails is not an array', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations/bulk`)
        .send({ emails: 'notanarray', role: 'member' })
      expect(res.status).toBe(400)
    })
  })
})
