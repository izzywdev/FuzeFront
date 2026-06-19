/**
 * Unit tests for organization members routes.
 * DB and eventPublisher are mocked — no real Postgres required.
 * Mirrors the harness style from organizations.invitations.test.ts exactly.
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

const dbMock = db as jest.MockedFunction<any>
const publishMock = defaultEventPublisher.publishNotifyEmailRequested as jest.Mock

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/organizations', organizationsRouter)
  return app
}

const ORG_ID = 'org-test-id'
const USER_ID = 'user-owner-id'
const MEMBER_ID = 'mem-test-id'
const TARGET_MEMBER_ID = 'mem-target-id'

function makeDbQuery(returnValue: any) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNotNull: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    delete: jest.fn().mockResolvedValue(1),
    orderBy: jest.fn().mockResolvedValue(returnValue !== null ? [returnValue] : []),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
  }
  return chain
}

describe('Organization Members', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  // ─── GET /:id/members ─────────────────────────────────────────────────────

  describe('GET /api/organizations/:id/members', () => {
    it('returns 200 with bare array of members including nested user object', async () => {
      const callerMembershipChain = makeDbQuery({
        id: MEMBER_ID, user_id: USER_ID, organization_id: ORG_ID, role: 'owner', status: 'active',
      })
      const memberRow = {
        id: TARGET_MEMBER_ID,
        role: 'member',
        status: 'active',
        joined_at: new Date('2024-01-15').toISOString(),
        user_id: 'other-user-id',
        user_email: 'alice@example.com',
        first_name: 'Alice',
        last_name: 'Smith',
      }
      const membersListChain: any = {
        select: jest.fn().mockReturnThis(),
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([memberRow]),
      }

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          // First call: caller's membership check; second call: list all members
          return membershipCallCount === 1 ? callerMembershipChain : membersListChain
        }
        return makeDbQuery(null)
      })

      const res = await request(app).get(`/api/organizations/${ORG_ID}/members`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(1)

      const member = res.body[0]
      expect(member.id).toBe(TARGET_MEMBER_ID)
      expect(member.role).toBe('member')
      expect(member.status).toBe('active')
      expect(member).toHaveProperty('user')
      expect(member.user.id).toBe('other-user-id')
      expect(member.user.email).toBe('alice@example.com')
      expect(member.user.firstName).toBe('Alice')
      expect(member.user.lastName).toBe('Smith')
      expect(member).toHaveProperty('joined_at')
      expect(member.invited_at).toBeNull()
    })

    it('returns 403 when caller is not an active member', async () => {
      // db returns null for membership lookup → caller is not a member
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))

      const res = await request(app).get(`/api/organizations/${ORG_ID}/members`)
      expect(res.status).toBe(403)
    })
  })

  // ─── POST /:id/members ────────────────────────────────────────────────────

  describe('POST /api/organizations/:id/members', () => {
    it('returns 201 and fires email event when org admin invites a member', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })
      const existingInviteChain = makeDbQuery(null)
      const insertChain = { ...makeDbQuery(null), insert: jest.fn().mockResolvedValue([1]) }
      const orgChain = makeDbQuery({ id: ORG_ID, name: 'Test Org' })
      const userChain = makeDbQuery({ id: USER_ID, email: 'owner@example.com', first_name: 'Alice', last_name: 'Smith' })

      let invCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return adminMembershipChain
        if (table === 'organization_invitations') {
          invCallCount++
          return invCallCount === 1 ? existingInviteChain : insertChain
        }
        if (table === 'organizations') return orgChain
        if (table === 'users') return userChain
        return makeDbQuery(null)
      })

      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ email: 'newmember@example.com', role: 'member' })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('invitation')
      expect(res.body.invitation.email).toBe('newmember@example.com')
      expect(res.body.invitation.status).toBe('pending')
      expect(publishMock).toHaveBeenCalledTimes(1)
      const emailPayload = publishMock.mock.calls[0][0]
      expect(emailPayload.template).toBe('org-invite')
      expect(emailPayload.to).toBe('newmember@example.com')
    })

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ role: 'member' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when email format is invalid', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ email: 'not-an-email', role: 'member' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when role is owner', async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ email: 'newmember@example.com', role: 'owner' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/Invalid role/i)
    })

    it('returns 403 when user is not an owner or admin', async () => {
      // membership lookup returns null → not admin/owner
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))

      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ email: 'newmember@example.com', role: 'member' })
      expect(res.status).toBe(403)
    })

    it('returns 409 when a pending invitation already exists for email', async () => {
      const adminMembershipChain = makeDbQuery({ id: MEMBER_ID, role: 'owner' })
      const existingInviteChain = makeDbQuery({ id: 'inv-existing', status: 'pending' })

      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') return adminMembershipChain
        if (table === 'organization_invitations') return existingInviteChain
        return makeDbQuery(null)
      })

      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/members`)
        .send({ email: 'existing@example.com', role: 'member' })
      expect(res.status).toBe(409)
    })
  })

  // ─── PUT /:id/members/:memberId ───────────────────────────────────────────

  describe('PUT /api/organizations/:id/members/:memberId', () => {
    it('returns 200 with updated membership when role is changed', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })
      const targetMembership = {
        id: TARGET_MEMBER_ID, role: 'member', user_id: 'other-user', organization_id: ORG_ID, status: 'active',
      }
      const targetChain = makeDbQuery(targetMembership)
      const updateChain = { where: jest.fn().mockReturnThis(), update: jest.fn().mockResolvedValue(1) }
      const updatedMembership = { ...targetMembership, role: 'admin' }
      const updatedChain = makeDbQuery(updatedMembership)

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          // 1: admin check; 2: fetch target; 3: update; 4: fetch updated
          if (membershipCallCount === 1) return adminMembershipChain
          if (membershipCallCount === 2) return targetChain
          if (membershipCallCount === 3) return updateChain
          return updatedChain
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .put(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)
        .send({ role: 'admin' })

      expect(res.status).toBe(200)
      expect(res.body.role).toBe('admin')
    })

    it('returns 403 when trying to change an owner membership', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })
      const ownerMembership = {
        id: TARGET_MEMBER_ID, role: 'owner', user_id: 'other-owner', organization_id: ORG_ID,
      }
      const targetChain = makeDbQuery(ownerMembership)

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          return membershipCallCount === 1 ? adminMembershipChain : targetChain
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .put(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)
        .send({ role: 'member' })

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/owner/i)
    })

    it('returns 403 when caller is not admin or owner', async () => {
      // Admin check returns null → not admin/owner
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))

      const res = await request(app)
        .put(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)
        .send({ role: 'member' })

      expect(res.status).toBe(403)
    })

    it('returns 400 when role is invalid', async () => {
      const res = await request(app)
        .put(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)
        .send({ role: 'superadmin' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/Invalid role/i)
    })

    it('returns 404 when membership does not exist', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          return membershipCallCount === 1 ? adminMembershipChain : makeDbQuery(null)
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .put(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)
        .send({ role: 'member' })

      expect(res.status).toBe(404)
    })
  })

  // ─── DELETE /:id/members/:memberId ────────────────────────────────────────

  describe('DELETE /api/organizations/:id/members/:memberId', () => {
    it('returns 200 with success message when member is removed', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })
      const targetMembership = {
        id: TARGET_MEMBER_ID, role: 'member', user_id: 'other-user', organization_id: ORG_ID,
      }
      const targetChain = makeDbQuery(targetMembership)
      const deleteChain = { where: jest.fn().mockReturnThis(), delete: jest.fn().mockResolvedValue(1) }

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          if (membershipCallCount === 1) return adminMembershipChain
          if (membershipCallCount === 2) return targetChain
          return deleteChain
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/Member removed/i)
    })

    it('returns 403 when trying to remove an owner membership', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })
      const ownerMembership = {
        id: TARGET_MEMBER_ID, role: 'owner', user_id: 'other-owner', organization_id: ORG_ID,
      }
      const targetChain = makeDbQuery(ownerMembership)

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          return membershipCallCount === 1 ? adminMembershipChain : targetChain
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/owner/i)
    })

    it('returns 403 when caller is not admin or owner', async () => {
      // Admin check returns null → not admin/owner
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))

      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)

      expect(res.status).toBe(403)
    })

    it('returns 404 when membership does not exist', async () => {
      const adminMembershipChain = makeDbQuery({
        id: MEMBER_ID, role: 'owner', user_id: USER_ID, organization_id: ORG_ID, status: 'active',
      })

      let membershipCallCount = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          membershipCallCount++
          return membershipCallCount === 1 ? adminMembershipChain : makeDbQuery(null)
        }
        return makeDbQuery(null)
      })

      const res = await request(app)
        .delete(`/api/organizations/${ORG_ID}/members/${TARGET_MEMBER_ID}`)

      expect(res.status).toBe(404)
    })
  })
})
