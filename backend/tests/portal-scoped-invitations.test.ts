import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

// role-assignment.ts calls permit.api.roleAssignments.assign — never a real
// Permit call in this suite (the mocked config/permit above has no `api`
// methods), so stub it out entirely rather than let it throw-and-swallow on
// every accept.
jest.mock('../src/utils/permit/role-assignment', () => ({
  __esModule: true,
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
}))

// Never touch a real Kafka broker / event_outbox — same convention as
// portal-provisioning.test.ts and organizationProvisioning's own suites.
jest.mock('../src/services/eventPublisher', () => ({
  __esModule: true,
  defaultEventPublisher: {
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishPortalCreated: jest.fn().mockResolvedValue(undefined),
  },
}))

import * as identityFlagModule from '../src/utils/identityFlag'
import * as portalFlagModule from '../src/utils/portalFlag'
import * as permissionCheckModule from '../src/utils/permit/permission-check'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { resolvePortalContext, _clearPortalCacheForTests } from '../src/middleware/portalContext'
import organizationsRoutes from '../src/routes/organizations'
import invitationsRoutes from '../src/routes/invitations'
import { ROOT_PORTAL_ID, generatePortalId } from '../src/repositories/portalRepository'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

// ── flag + authz doubles ────────────────────────────────────────────────────
// Both flag states must be exercised (feature-flags skill) — one mutable
// boolean read by every consumer of utils/identityFlag via jest.spyOn on the
// REAL module (a jest.mock(path, factory) here would not be observed by every
// module that already bound the real export before this file's mocks
// register — same rationale as tests/users-portal-scoping.test.ts).
let portalScopedUsersEnabled = false
// This suite always signs portal-bound tokens and relies on
// `authenticateToken` binding `req.user.portalId` from them (via
// `resolvePortalContext` + the multi-tenant-portals flag) — same convention
// as tests/users-portal-scoping.test.ts.
let multiTenantPortalsEnabled = true
// orgId -> set of userIds authorized to 'manage' that org (drives
// PermissionMiddleware.canManageOrganization, i.e. the invite/list/resend/
// revoke authz gate).
let orgAdmins = new Map<string, Set<string>>()
let platformAdminUserIds = new Set<string>()

function mockCheckOrganizationPermission() {
  return jest
    .spyOn(permissionCheckModule, 'checkOrganizationPermission')
    .mockImplementation(async (userId: string, action: string, orgId: string) => {
      if (orgId === ROOT_ORG_ID && action === 'manage') {
        return platformAdminUserIds.has(userId)
      }
      if (action === 'manage') {
        return orgAdmins.get(orgId)?.has(userId) ?? false
      }
      // Any other action/org (e.g. a 'read' gate this suite isn't testing) — allow.
      return true
    })
}

beforeAll(() => {
  initializeDatabaseConnection()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  mockCheckOrganizationPermission()
})

afterEach(() => {
  jest.clearAllMocks()
  jest.spyOn(portalFlagModule, 'isMultiTenantPortalsEnabled').mockImplementation(
    async () => multiTenantPortalsEnabled
  )
  jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockImplementation(
    async () => portalScopedUsersEnabled
  )
  mockCheckOrganizationPermission()
})

const app = express()
app.use(express.json())
app.use(resolvePortalContext)
app.use('/api/organizations', organizationsRoutes)
app.use('/api/invitations', invitationsRoutes)

function signToken(userId: string, portalId?: string): string {
  return jwt.sign(
    { userId, sessionId: uuidv4(), ...(portalId ? { portalId } : {}) },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )
}

async function createUser(homePortalId: string | null, email?: string): Promise<{ id: string; email: string }> {
  const id = uuidv4()
  const userEmail = email ?? `inv-${id.slice(0, 8)}@test.local`
  await db('users').insert({
    id,
    email: userEmail,
    first_name: 'Invite',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    home_portal_id: homePortalId,
    created_at: new Date(),
    updated_at: new Date(),
  })
  return { id, email: userEmail }
}

async function createPortal(opts: {
  slug: string
  isRoot?: boolean
  domain: string
}): Promise<{ portalId: string; orgId: string }> {
  const owner = await createUser(null)
  const orgId = opts.isRoot ? ROOT_ORG_ID : uuidv4()
  const existingRoot = opts.isRoot ? await db('organizations').where({ id: ROOT_ORG_ID }).first() : null
  if (!existingRoot) {
    await db('organizations').insert({
      id: orgId,
      name: opts.slug,
      slug: `${opts.slug}-${orgId.slice(0, 6)}`,
      owner_id: owner.id,
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
  return { portalId, orgId }
}

async function fetchInvitationByEmail(orgId: string, email: string) {
  return db('organization_invitations')
    .where('organization_id', orgId)
    .where('email', email)
    .first()
}

beforeEach(async () => {
  portalScopedUsersEnabled = false
  multiTenantPortalsEnabled = true
  orgAdmins = new Map()
  platformAdminUserIds = new Set()
  _clearPortalCacheForTests()
  await db('organization_invitations').del()
  await db('organization_memberships').del()
  await db('portal_domains').del()
  await db('portals').del()
  await db('organizations').where('id', '!=', ROOT_ORG_ID).del()
})

describe('POST /api/organizations/:id/invitations — portal-aware invite-by-email (FF-EPIC-11-S3)', () => {
  it('AC1 flag ON: new email (no account) — invitation is bound to the inviting portal, and the account is homed to it on accept', async () => {
    portalScopedUsersEnabled = true
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-a1',
      domain: 'inv-a1.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'brand-new@test.local'
    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-a1.fuzefront.test')
      .send({ email, role: 'member' })

    expect(createRes.status).toBe(201)
    expect(createRes.body.invitation.portalId).toBe(portalA)

    const invitation = await fetchInvitationByEmail(orgA, email)
    expect(invitation).toBeTruthy()
    expect(invitation.portal_id).toBe(portalA)

    // Simulate the invitee completing enrollment (Authentik) — the account
    // now exists with NO home portal yet.
    const invitee = await createUser(null, email)
    const acceptToken = signToken(invitee.id, portalA)

    const acceptRes = await request(app)
      .post(`/api/invitations/${invitation.token}/accept`)
      .set('Authorization', `Bearer ${acceptToken}`)
      .set('Host', 'inv-a1.fuzefront.test')
      .send({})

    expect(acceptRes.status).toBe(200)

    const updatedUser = await db('users').where({ id: invitee.id }).first()
    expect(updatedUser.home_portal_id).toBe(portalA)

    const membership = await db('organization_memberships')
      .where({ user_id: invitee.id, organization_id: orgA })
      .first()
    expect(membership).toBeTruthy()
    expect(membership.role).toBe('member')
    expect(membership.status).toBe('active')
  })

  it('AC2 flag ON: email already homed to a DIFFERENT portal is rejected (EMAIL_IN_OTHER_PORTAL), foreign account + no membership untouched', async () => {
    portalScopedUsersEnabled = true
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-a2',
      domain: 'inv-a2.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({
      slug: 'inv-b2',
      domain: 'inv-b2.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'shared-cross-portal@test.local'
    const foreignAccount = await createUser(portalB, email)

    const res = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-a2.fuzefront.test')
      .send({ email, role: 'member' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('EMAIL_IN_OTHER_PORTAL')

    // No invitation row was created.
    const invitation = await fetchInvitationByEmail(orgA, email)
    expect(invitation).toBeUndefined()

    // The foreign account is completely untouched.
    const unchanged = await db('users').where({ id: foreignAccount.id }).first()
    expect(unchanged.home_portal_id).toBe(portalB)

    // No membership was granted anywhere.
    const membership = await db('organization_memberships')
      .where({ user_id: foreignAccount.id })
      .first()
    expect(membership).toBeUndefined()
  })

  it('AC3 flag ON: email already homed to the SAME portal attaches the existing account, no duplicate account', async () => {
    portalScopedUsersEnabled = true
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-a3',
      domain: 'inv-a3.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'same-portal-reinvite@test.local'
    const existing = await createUser(portalA, email)

    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-a3.fuzefront.test')
      .send({ email, role: 'viewer' })

    expect(createRes.status).toBe(201)
    expect(createRes.body.invitation.portalId).toBe(portalA)

    const invitation = await fetchInvitationByEmail(orgA, email)
    const acceptToken = signToken(existing.id, portalA)

    const acceptRes = await request(app)
      .post(`/api/invitations/${invitation.token}/accept`)
      .set('Authorization', `Bearer ${acceptToken}`)
      .set('Host', 'inv-a3.fuzefront.test')
      .send({})

    expect(acceptRes.status).toBe(200)

    // Exactly one account for this email — no duplicate was created.
    const accounts = await db('users').where({ email })
    expect(accounts.length).toBe(1)
    expect(accounts[0].home_portal_id).toBe(portalA)

    const membership = await db('organization_memberships')
      .where({ user_id: existing.id, organization_id: orgA })
      .first()
    expect(membership).toBeTruthy()
    expect(membership.role).toBe('viewer')
  })
})

describe('POST /api/invitations/:token/accept — AC4 wrong-portal-token fail-closed (FF-EPIC-11-S3)', () => {
  it('flag ON: accepting from a DIFFERENT portal context than the invitation was issued for is rejected, no membership granted', async () => {
    portalScopedUsersEnabled = true
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-a4',
      domain: 'inv-a4.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({
      slug: 'inv-b4',
      domain: 'inv-b4.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'wrong-portal-accept@test.local'
    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-a4.fuzefront.test')
      .send({ email, role: 'member' })
    expect(createRes.status).toBe(201)

    const invitation = await fetchInvitationByEmail(orgA, email)
    const invitee = await createUser(null, email)
    // Wrong portal context: the invitee's session is bound to portal B, not
    // the portal A this invitation was issued for.
    const wrongPortalToken = signToken(invitee.id, portalB)

    const acceptRes = await request(app)
      .post(`/api/invitations/${invitation.token}/accept`)
      .set('Authorization', `Bearer ${wrongPortalToken}`)
      .set('Host', 'inv-b4.fuzefront.test')
      .send({})

    expect(acceptRes.status).toBe(403)
    expect(acceptRes.body.error).toBe('PORTAL_CONTEXT_MISMATCH')

    const membership = await db('organization_memberships')
      .where({ user_id: invitee.id, organization_id: orgA })
      .first()
    expect(membership).toBeUndefined()

    const stillPending = await db('organization_invitations').where({ id: invitation.id }).first()
    expect(stillPending.status).toBe('pending')

    const untouchedUser = await db('users').where({ id: invitee.id }).first()
    expect(untouchedUser.home_portal_id).toBeNull()
  })
})

describe('Flag OFF — BYTE-IDENTICAL pre-epic invitation behavior (regression guard)', () => {
  it('flag OFF: invite creation never captures a portal_id and never rejects on cross-portal email', async () => {
    portalScopedUsersEnabled = false
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-off1',
      domain: 'inv-off1.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({
      slug: 'inv-off1b',
      domain: 'inv-off1b.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'flag-off-cross-portal@test.local'
    await createUser(portalB, email) // homed to a DIFFERENT portal — must NOT matter

    const res = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-off1.fuzefront.test')
      .send({ email, role: 'member' })

    expect(res.status).toBe(201)
    expect(res.body.invitation.portalId).toBeNull()

    const invitation = await fetchInvitationByEmail(orgA, email)
    expect(invitation.portal_id).toBeNull()
  })

  it('flag OFF: accept never checks portal context and never sets home_portal_id, regardless of session portal', async () => {
    portalScopedUsersEnabled = false
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-off2',
      domain: 'inv-off2.fuzefront.test',
    })
    const { portalId: portalB } = await createPortal({
      slug: 'inv-off2b',
      domain: 'inv-off2b.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'flag-off-accept@test.local'
    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-off2.fuzefront.test')
      .send({ email, role: 'member' })
    expect(createRes.status).toBe(201)

    const invitation = await fetchInvitationByEmail(orgA, email)
    const invitee = await createUser(null, email)
    // Session bound to a DIFFERENT portal than the inviting org's portal —
    // with the flag OFF this must NOT matter at all (byte-identical pre-epic).
    const acceptToken = signToken(invitee.id, portalB)

    const acceptRes = await request(app)
      .post(`/api/invitations/${invitation.token}/accept`)
      .set('Authorization', `Bearer ${acceptToken}`)
      .set('Host', 'inv-off2b.fuzefront.test')
      .send({})

    expect(acceptRes.status).toBe(200)

    const membership = await db('organization_memberships')
      .where({ user_id: invitee.id, organization_id: orgA })
      .first()
    expect(membership).toBeTruthy()

    // home_portal_id is left untouched (still null) — the AC1 set-on-accept
    // logic is gated by the flag too.
    const unaffectedUser = await db('users').where({ id: invitee.id }).first()
    expect(unaffectedUser.home_portal_id).toBeNull()
  })

  it('flag OFF: unauthenticated accept still gets the pre-epic 202 enroll response', async () => {
    portalScopedUsersEnabled = false
    const { orgId: orgA } = await createPortal({ slug: 'inv-off3', domain: 'inv-off3.fuzefront.test' })
    const admin = await createUser(null)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id)

    const email = 'flag-off-enroll@test.local'
    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, role: 'member' })
    expect(createRes.status).toBe(201)

    const invitation = await fetchInvitationByEmail(orgA, email)
    const res = await request(app).post(`/api/invitations/${invitation.token}/accept`).send({})

    expect(res.status).toBe(202)
    expect(res.body.action).toBe('enroll')
  })
})

describe('BOLA / authz — invitation routes require org-manage authority (FF-EPIC-11-S3)', () => {
  it('a non-admin member cannot create an invitation', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-authz1',
      domain: 'inv-authz1.fuzefront.test',
    })
    const nonAdmin = await createUser(portalA) // NOT added to orgAdmins
    const token = signToken(nonAdmin.id, portalA)

    const res = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'inv-authz1.fuzefront.test')
      .send({ email: 'nope@test.local', role: 'member' })

    expect(res.status).toBe(403)
  })

  it('a non-admin member cannot list invitations', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-authz2',
      domain: 'inv-authz2.fuzefront.test',
    })
    const nonAdmin = await createUser(portalA)
    const token = signToken(nonAdmin.id, portalA)

    const res = await request(app)
      .get(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .set('Host', 'inv-authz2.fuzefront.test')

    expect(res.status).toBe(403)
  })

  it('an unauthenticated caller cannot create or list invitations', async () => {
    const { orgId: orgA } = await createPortal({ slug: 'inv-authz3', domain: 'inv-authz3.fuzefront.test' })

    const createRes = await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .send({ email: 'nope@test.local', role: 'member' })
    expect(createRes.status).toBe(401)

    const listRes = await request(app).get(`/api/organizations/${orgA}/invitations`)
    expect(listRes.status).toBe(401)
  })
})

describe('GET /api/organizations/:id/invitations — pagination envelope + limit clamp (governance/pagination-standard.md)', () => {
  it('returns the {items, page:{nextCursor,hasMore}} envelope and clamps an over-max limit', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-page1',
      domain: 'inv-page1.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/organizations/${orgA}/invitations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Host', 'inv-page1.fuzefront.test')
        .send({ email: `page-${i}@test.local`, role: 'member' })
    }

    const res = await request(app)
      .get(`/api/organizations/${orgA}/invitations`)
      .query({ limit: 99999 }) // over MAX (200) — must be clamped, never honored unbounded
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-page1.fuzefront.test')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('items')
    expect(res.body).toHaveProperty('page')
    expect(res.body.page).toHaveProperty('nextCursor')
    expect(res.body.page).toHaveProperty('hasMore')
    expect(res.body.items.length).toBeLessThanOrEqual(200)
  })

  it('cursor walks the full set deterministically — no gaps, no duplicates', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-page2',
      domain: 'inv-page2.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const expectedEmails = new Set<string>()
    for (let i = 0; i < 9; i++) {
      const email = `walk-${i}@test.local`
      expectedEmails.add(email)
      await request(app)
        .post(`/api/organizations/${orgA}/invitations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Host', 'inv-page2.fuzefront.test')
        .send({ email, role: 'member' })
    }

    let cursor: string | undefined
    const seen: string[] = []
    do {
      const res = await request(app)
        .get(`/api/organizations/${orgA}/invitations`)
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Host', 'inv-page2.fuzefront.test')
      expect(res.status).toBe(200)
      seen.push(...res.body.items.map((i: any) => i.email))
      cursor = res.body.page.nextCursor ?? undefined
    } while (cursor)

    expect(new Set(seen)).toEqual(expectedEmails)
    expect(seen.length).toBe(new Set(seen).size)
  })

  it('a malformed cursor is a 400, not a silent reset to page 1', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-page3',
      domain: 'inv-page3.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const res = await request(app)
      .get(`/api/organizations/${orgA}/invitations`)
      .query({ cursor: 'not-a-valid-cursor!!!' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-page3.fuzefront.test')

    expect(res.status).toBe(400)
  })
})

describe('GET /api/invitations/:token — public resolve (unchanged by the flag)', () => {
  it('masks the email and returns the organization summary', async () => {
    const { portalId: portalA, orgId: orgA } = await createPortal({
      slug: 'inv-resolve',
      domain: 'inv-resolve.fuzefront.test',
    })
    const admin = await createUser(portalA)
    orgAdmins.set(orgA, new Set([admin.id]))
    const adminToken = signToken(admin.id, portalA)

    const email = 'resolve-me@test.local'
    await request(app)
      .post(`/api/organizations/${orgA}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Host', 'inv-resolve.fuzefront.test')
      .send({ email, role: 'member' })

    const invitation = await fetchInvitationByEmail(orgA, email)
    const res = await request(app).get(`/api/invitations/${invitation.token}`)

    expect(res.status).toBe(200)
    expect(res.body.invitation.email).toBe('r***@test.local')
    expect(res.body.organization.id).toBe(orgA)
  })

  it('a nonexistent token 404s', async () => {
    const res = await request(app).get('/api/invitations/does-not-exist')
    expect(res.status).toBe(404)
  })
})
