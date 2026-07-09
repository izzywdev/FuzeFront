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

  // Builds a chainable mock for the paginated members list query. It captures
  // limit/offset and whereRaw so tests can assert clamping + search behavior.
  function makePaginatedMembersChain(rows: any[]) {
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
        // offset terminates the awaited chain → resolve rows
        return Promise.resolve(rows)
      }),
    }
    return { chain, captured }
  }

  // Builds a chainable mock for the COUNT query.
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

  describe('GET /api/organizations/:id/members', () => {
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

    // Wires the dbMock so that for `organization_memberships`:
    //   call 1 = caller membership check
    //   call 2 = COUNT query
    //   call 3 = paginated list query
    function wireMembersQueries(opts: {
      callerActive?: boolean
      total: number
      rows: any[]
    }) {
      const callerChain = makeDbQuery(
        opts.callerActive === false
          ? null
          : { id: MEMBER_ID, user_id: USER_ID, organization_id: ORG_ID, role: 'owner', status: 'active' }
      )
      const count = makeCountChain(opts.total)
      const list = makePaginatedMembersChain(opts.rows)

      let n = 0
      dbMock.mockImplementation((table: string) => {
        if (table === 'organization_memberships') {
          n++
          if (n === 1) return callerChain
          if (n === 2) return count.chain
          return list.chain
        }
        return makeDbQuery(null)
      })
      return { count, list }
    }

    it('returns the paginated envelope with members + pagination block', async () => {
      wireMembersQueries({ total: 42, rows: [memberRow] })

      const res = await request(app).get(`/api/organizations/${ORG_ID}/members`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.members)).toBe(true)
      expect(res.body.members).toHaveLength(1)
      expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 42 })

      const member = res.body.members[0]
      expect(member.id).toBe(TARGET_MEMBER_ID)
      expect(member.role).toBe('member')
      expect(member.status).toBe('active')
      expect(member.user).toEqual({
        id: 'other-user-id',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
      })
      expect(member).toHaveProperty('joined_at')
      expect(member.invited_at).toBeNull()
    })

    it('honors page/pageSize and computes correct limit/offset', async () => {
      const { list } = wireMembersQueries({ total: 100, rows: [memberRow] })

      const res = await request(app)
        .get(`/api/organizations/${ORG_ID}/members?page=3&pageSize=10`)

      expect(res.status).toBe(200)
      expect(res.body.pagination).toEqual({ page: 3, pageSize: 10, total: 100 })
      expect(list.captured.limit).toBe(10)
      expect(list.captured.offset).toBe(20) // (3-1)*10
    })

    it('clamps pageSize to 100 and floors page/pageSize at 1; junk falls back to defaults', async () => {
      // pageSize way over max, page below min, then junk values
      const { list: a } = wireMembersQueries({ total: 5, rows: [memberRow] })
      const resClamp = await request(app)
        .get(`/api/organizations/${ORG_ID}/members?page=0&pageSize=500`)
      expect(resClamp.status).toBe(200)
      expect(resClamp.body.pagination.page).toBe(1)
      expect(resClamp.body.pagination.pageSize).toBe(100)
      expect(a.captured.limit).toBe(100)
      expect(a.captured.offset).toBe(0)

      const { list: b } = wireMembersQueries({ total: 5, rows: [memberRow] })
      const resJunk = await request(app)
        .get(`/api/organizations/${ORG_ID}/members?page=abc&pageSize=xyz`)
      expect(resJunk.status).toBe(200)
      expect(resJunk.body.pagination.page).toBe(1)
      expect(resJunk.body.pagination.pageSize).toBe(20)
      expect(b.captured.limit).toBe(20)
    })

    it('applies a case-insensitive search filter to both list and count queries', async () => {
      const { count, list } = wireMembersQueries({ total: 1, rows: [memberRow] })

      const res = await request(app)
        .get(`/api/organizations/${ORG_ID}/members?search=ALICE`)

      expect(res.status).toBe(200)
      // search lowercased + wrapped in % for LIKE, bound 3x (email/first/last)
      const expectedBindings = ['%alice%', '%alice%', '%alice%']
      expect(list.captured.whereRawArgs).toEqual(expectedBindings)
      expect(count.captured.whereRawArgs).toEqual(expectedBindings)
    })

    it('returns 403 when caller is not an active member', async () => {
      // db returns null for membership lookup → caller is not a member
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))

      const res = await request(app).get(`/api/organizations/${ORG_ID}/members`)
      expect(res.status).toBe(403)
    })
  })

  // ─── GET /:id/roles ───────────────────────────────────────────────────────

  describe('GET /api/organizations/:id/roles', () => {
    it('returns the 4 org roles with mapped permissions and the resource catalog', async () => {
      const callerChain = makeDbQuery({
        id: MEMBER_ID, user_id: USER_ID, organization_id: ORG_ID, role: 'viewer', status: 'active',
      })
      dbMock.mockImplementation((table: string) =>
        table === 'organization_memberships' ? callerChain : makeDbQuery(null)
      )

      const res = await request(app).get(`/api/organizations/${ORG_ID}/roles`)

      expect(res.status).toBe(200)
      expect(res.body.roles.map((r: any) => r.key)).toEqual([
        'owner', 'admin', 'member', 'viewer',
      ])

      const byKey = Object.fromEntries(res.body.roles.map((r: any) => [r.key, r]))
      // assignable: only owner is false
      expect(byKey.owner.assignable).toBe(false)
      expect(byKey.admin.assignable).toBe(true)
      expect(byKey.member.assignable).toBe(true)
      expect(byKey.viewer.assignable).toBe(true)

      // owner + admin map to permit "admin" (full set incl. manage/delete)
      expect(byKey.owner.permissions).toEqual(byKey.admin.permissions)
      expect(byKey.admin.permissions).toEqual(
        expect.arrayContaining(['Organization:manage', 'UserManagement:update_role'])
      )
      // member → editor: can create apps but cannot manage org or update roles
      expect(byKey.member.permissions).toContain('App:create')
      expect(byKey.member.permissions).not.toContain('Organization:manage')
      expect(byKey.member.permissions).not.toContain('UserManagement:update_role')
      // viewer → viewer: read-only, cannot create apps
      expect(byKey.viewer.permissions).toContain('Organization:read')
      expect(byKey.viewer.permissions).not.toContain('App:create')

      // resources flattened: actions is an array of {key,name}
      const org = res.body.resources.find((r: any) => r.key === 'Organization')
      expect(org.name).toBe('Organization')
      expect(org.actions).toEqual(
        expect.arrayContaining([{ key: 'manage', name: 'Manage' }])
      )
      expect(res.body.resources.map((r: any) => r.key)).toEqual(
        expect.arrayContaining(['Organization', 'App', 'UserManagement', 'Docs', 'Chat'])
      )
    })

    it('returns 403 when caller is not an active member', async () => {
      dbMock.mockImplementation((_table: string) => makeDbQuery(null))
      const res = await request(app).get(`/api/organizations/${ORG_ID}/roles`)
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
