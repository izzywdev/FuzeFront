/**
 * FFRNT-307 — Org invitations v2: create / bulk / list / resend / revoke /
 * POST /:id/members, behind `fuzefront.identity.invite-v2`.
 *
 * Runs the REAL routes + service against an in-memory knex stand-in
 * (tests/helpers/fakeDb) so CAS, keyset pagination and outbox atomicity are
 * asserted as behavior. BOTH flag states are exercised.
 */
import request from 'supertest'
import express from 'express'

jest.mock('../src/config/database', () => ({ db: require('./helpers/fakeDb').db }))
jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn((...a: any[]) => (require('./helpers/fakeDb').enqueueEvent as any)(...a)),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) =>
    req.user ? next() : res.status(401).json({ error: 'no token' }),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))
jest.mock('../src/middleware/permissions', () => ({
  PermissionMiddleware: {
    canReadOrganization: (_r: any, _s: any, n: any) => n(),
    canUpdateOrganization: (_r: any, _s: any, n: any) => n(),
    canDeleteOrganization: (_r: any, _s: any, n: any) => n(),
    canInviteUsers: (_r: any, _s: any, n: any) => n(),
    canViewMembers: (_r: any, _s: any, n: any) => n(),
  },
  requireOwnership: () => (_r: any, _s: any, n: any) => n(),
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
jest.mock('../src/utils/employeeFlag', () => ({ isEmployeeConsoleEnabled: jest.fn().mockResolvedValue(false) }))
jest.mock('../src/utils/memberDirectoryFlag', () => ({ isMemberDirectoryEnabled: jest.fn().mockResolvedValue(false) }))
jest.mock('../src/utils/inviteV2Flag', () => ({ isInviteV2Enabled: jest.fn() }))
jest.mock('../src/identity/flags', () => ({ isPrefixedIdsEnabled: jest.fn().mockResolvedValue(false) }))

import { enqueueEvent } from '@fuzefront/core'
import { identityInvitationCreatedSchemaV1, TOPICS } from '@fuzefront/shared/kafka'
import { defaultEventPublisher } from '../src/services/eventPublisher'
import { isInviteV2Enabled } from '../src/utils/inviteV2Flag'
import { isPrefixedIdsEnabled } from '../src/identity/flags'
import organizationsRouter from '../src/routes/organizations'
import { fakeDb, outbox, ROOT } from './helpers/fakeDb'

const flag = isInviteV2Enabled as jest.Mock
const emailPublish = defaultEventPublisher.publishNotifyEmailRequested as jest.Mock

const ORG_A = '11111111-1111-4111-8111-111111111111' // portal root (child of ROOT)
const ORG_A1 = '11111111-1111-4111-8111-111111111112' // sub-org of A
const ORG_B = '22222222-2222-4222-8222-222222222222' // a different portal
const U_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const U_MEMBER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const U_EXT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function seed() {
  fakeDb.reset()
  const t = fakeDb.tables
  t.users.push(
    { id: U_OWNER, email: 'owner@example.com', first_name: 'Olive', last_name: 'Owner' },
    { id: U_ADMIN, email: 'admin@example.com' },
    { id: U_MEMBER, email: 'member@example.com' },
    { id: U_EXT, email: 'ext@example.com' }
  )
  t.organizations.push(
    { id: ROOT, name: 'Root', owner_id: U_OWNER, parent_id: null },
    { id: ORG_A, name: 'Portal A', owner_id: U_OWNER, parent_id: ROOT },
    { id: ORG_A1, name: 'Sub A1', owner_id: U_OWNER, parent_id: ORG_A },
    { id: ORG_B, name: 'Portal B', owner_id: U_OWNER, parent_id: ROOT }
  )
  const m = (user_id: string, organization_id: string, role: string, member_type = 'employee') =>
    t.organization_memberships.push({ id: `m-${user_id}-${organization_id}`, user_id, organization_id, role, member_type, status: 'active' })
  m(U_OWNER, ROOT, 'owner')
  m(U_OWNER, ORG_A, 'owner')
  m(U_ADMIN, ORG_A, 'admin')
  m(U_ADMIN, ROOT, 'admin')
  m(U_MEMBER, ORG_A, 'member')
}

function appAs(userId: string | null) {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    if (userId) req.user = { id: userId, email: `${userId}@x.test` }
    next()
  })
  app.use('/api/organizations', organizationsRouter)
  return app
}

const extEmail = (email: string) => ({ kind: 'external', channel: 'email', email })
const invs = () => fakeDb.tables.organization_invitations

beforeEach(() => {
  jest.clearAllMocks()
  seed()
  flag.mockResolvedValue(true)
  ;(isPrefixedIdsEnabled as jest.Mock).mockResolvedValue(false)
})

describe('flag OFF — legacy behavior is untouched', () => {
  beforeEach(() => flag.mockResolvedValue(false))

  it('the contract body is NOT honored (legacy requires { email }) and nothing v2 is written', async () => {
    const res = await request(appAs(U_OWNER))
      .post(`/api/organizations/${ORG_A}/invitations`)
      .send({ invitee: extEmail('new@example.com'), memberType: 'customer' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/valid email/i)
    expect(invs()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
  })

  it('legacy list still returns the unbounded { invitations } shape', async () => {
    const res = await request(appAs(U_OWNER)).get(`/api/organizations/${ORG_A}/invitations`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('invitations')
    expect(res.body).not.toHaveProperty('page')
  })
})

describe('flag ON — POST /:id/invitations', () => {
  const post = (body: any, as: string | null = U_OWNER, org = ORG_A) =>
    request(appAs(as)).post(`/api/organizations/${org}/invitations`).send(body)

  it('creates an external email invite: contract-shaped 201, persisted, event + email', async () => {
    const res = await post({ invitee: extEmail('New@Example.com'), role: 'viewer', memberType: 'customer' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      organizationId: ORG_A,
      invitee: { kind: 'external', channel: 'email', email: 'new@example.com' },
      channel: 'email',
      role: 'viewer',
      memberType: 'customer',
      status: 'pending',
      invitedByUserId: U_OWNER,
    })
    expect(res.body).not.toHaveProperty('token')
    expect(res.body).not.toHaveProperty('bindToken')
    expect(res.body).not.toHaveProperty('invitation') // no legacy wrapper

    expect(invs()).toHaveLength(1)
    expect(invs()[0]).toMatchObject({ member_type: 'customer', channel: 'email', email: 'new@example.com', status: 'pending' })
    expect(invs()[0].id).toBe(res.body.id) // server-minted

    const ev = outbox(TOPICS.IDENTITY_INVITATION_CREATED)
    expect(ev).toHaveLength(1)
    const payload = identityInvitationCreatedSchemaV1.parse(ev[0].payload) // valid against the frozen schema
    expect(payload).toMatchObject({ organizationId: ORG_A, memberType: 'customer', channel: 'email', email: 'new@example.com', role: 'viewer' })

    expect(emailPublish).toHaveBeenCalledTimes(1)
    expect(emailPublish.mock.calls[0][0]).toMatchObject({ to: 'new@example.com', template: 'org-invite' })
  })

  it('creates a WhatsApp invite: phone persisted, no email, event carries the E.164 phone', async () => {
    const res = await post({ invitee: { kind: 'external', channel: 'whatsapp', phone: '+14155552671' }, memberType: 'employee' })
    expect(res.status).toBe(201)
    expect(res.body.invitee).toEqual({ kind: 'external', channel: 'whatsapp', phone: '+14155552671' })
    expect(invs()[0]).toMatchObject({ channel: 'whatsapp', phone: '+14155552671', email: null })
    const payload = identityInvitationCreatedSchemaV1.parse(outbox(TOPICS.IDENTITY_INVITATION_CREATED)[0].payload)
    expect(payload).toMatchObject({ channel: 'whatsapp', phone: '+14155552671' })
    expect(payload.email).toBeUndefined()
    expect(emailPublish).not.toHaveBeenCalled() // telephony send is sms-service's, via the event
  })

  it('creates an invite for an existing account (kind: account) by typed userId', async () => {
    const res = await post({ invitee: { kind: 'account', userId: U_EXT }, memberType: 'employee' })
    expect(res.status).toBe(201)
    expect(res.body.invitee).toEqual({ kind: 'account', userId: U_EXT })
    expect(invs()[0]).toMatchObject({ invitee_user_id: U_EXT, email: 'ext@example.com', channel: 'email' })
    expect(identityInvitationCreatedSchemaV1.parse(outbox(TOPICS.IDENTITY_INVITATION_CREATED)[0].payload).inviteeUserId).toBe(U_EXT)
  })

  it('404 when the account invitee does not exist', async () => {
    const res = await post({ invitee: { kind: 'account', userId: '99999999-9999-4999-8999-999999999999' }, memberType: 'employee' })
    expect(res.status).toBe(404)
  })

  it.each([
    ['owner role', { invitee: extEmail('a@b.co'), role: 'owner', memberType: 'employee' }],
    ['unknown role', { invitee: extEmail('a@b.co'), role: 'god', memberType: 'employee' }],
    ['client-chosen id', { id: 'ivt_x', invitee: extEmail('a@b.co'), memberType: 'employee' }],
    ['client-chosen token', { token: 'x', invitee: extEmail('a@b.co'), memberType: 'employee' }],
    ['missing memberType', { invitee: extEmail('a@b.co') }],
    ['bad memberType', { invitee: extEmail('a@b.co'), memberType: 'vip' }],
    ['bad email', { invitee: extEmail('nope'), memberType: 'employee' }],
    ['non-E.164 phone', { invitee: { kind: 'external', channel: 'whatsapp', phone: '0415555' }, memberType: 'employee' }],
    ['unknown kind', { invitee: { kind: 'robot' }, memberType: 'employee' }],
    ['extra invitee field', { invitee: { ...extEmail('a@b.co'), id: 'z' }, memberType: 'employee' }],
    ['malformed userId', { invitee: { kind: 'account', userId: 'org_notauser' }, memberType: 'employee' }],
    ['legacy bare { email }', { email: 'a@b.co' }],
  ])('400 on %s', async (_name, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED') // the contract's ErrorBody enum
    expect(invs()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
  })

  it('403 for a plain member and for an unauthenticated-membership user; 401 without a token', async () => {
    expect((await post({ invitee: extEmail('a@b.co'), memberType: 'employee' }, U_MEMBER)).status).toBe(403)
    expect((await post({ invitee: extEmail('a@b.co'), memberType: 'employee' }, U_EXT)).status).toBe(403)
    expect((await post({ invitee: extEmail('a@b.co'), memberType: 'employee' }, null)).status).toBe(401)
    expect(invs()).toHaveLength(0)
  })

  it('an admin of an org can invite employees there; a malformed org id is a 404 (no oracle)', async () => {
    expect((await post({ invitee: extEmail('a@b.co'), memberType: 'employee' }, U_ADMIN)).status).toBe(201)
    expect((await post({ invitee: extEmail('a@b.co'), memberType: 'employee' }, U_OWNER, 'not-an-id' as any)).status).toBe(404)
  })

  it('409 on a duplicate pending invite and on an already-active member', async () => {
    const body = { invitee: extEmail('dup@example.com'), memberType: 'employee' }
    expect((await post(body)).status).toBe(201)
    const dup = await post(body)
    expect(dup.status).toBe(409)
    expect(dup.body).toMatchObject({ code: 'CONFLICT', reason: 'already-pending' })
    const member = await post({ invitee: { kind: 'account', userId: U_MEMBER }, memberType: 'employee' })
    expect(member.status).toBe(409)
    expect(member.body.reason).toBe('already-member')
    expect(invs()).toHaveLength(1)
  })

  it('rolls the invitation row back if the outbox write fails (same transaction)', async () => {
    ;(enqueueEvent as jest.Mock).mockRejectedValueOnce(new Error('outbox down'))
    const res = await post({ invitee: extEmail('atomic@example.com'), memberType: 'employee' })
    expect(res.status).toBe(500)
    expect(invs()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
    expect(emailPublish).not.toHaveBeenCalled()
  })

  it('an email-dispatch failure never un-creates the invitation', async () => {
    emailPublish.mockRejectedValueOnce(new Error('smtp down'))
    const res = await post({ invitee: extEmail('mail@example.com'), memberType: 'employee' })
    expect(res.status).toBe(201)
    expect(invs()).toHaveLength(1)
  })

  describe('root-org customer invites', () => {
    it('the ROOT owner can invite an external identity as customer', async () => {
      const res = await post({ invitee: extEmail('cust@example.com'), role: 'member', memberType: 'customer' }, U_OWNER, ROOT)
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ organizationId: ROOT, memberType: 'customer' })
    })

    it('a ROOT ADMIN (not owner) can NOT invite customers into root', async () => {
      const res = await post({ invitee: extEmail('cust@example.com'), memberType: 'customer' }, U_ADMIN, ROOT)
      expect(res.status).toBe(403)
      expect(invs()).toHaveLength(0)
    })

    it('a customer is never granted admin on root', async () => {
      const res = await post({ invitee: extEmail('cust@example.com'), role: 'admin', memberType: 'customer' }, U_OWNER, ROOT)
      expect(res.status).toBe(400)
    })

    it('a ROOT admin may still invite EMPLOYEES into root (existing capability unchanged)', async () => {
      const res = await post({ invitee: extEmail('emp@example.com'), memberType: 'employee' }, U_ADMIN, ROOT)
      expect(res.status).toBe(201)
    })

    it('owning a different org grants nothing on root (an id is never a capability)', async () => {
      fakeDb.tables.organization_memberships = fakeDb.tables.organization_memberships.filter(
        m => !(m.user_id === U_ADMIN && m.organization_id === ROOT)
      )
      const res = await post({ invitee: extEmail('cust@example.com'), memberType: 'employee' }, U_ADMIN, ROOT)
      expect(res.status).toBe(403)
    })
  })

  describe('portal scoping — no cross-portal attach', () => {
    const makeCustomer = (org: string) =>
      fakeDb.tables.organization_memberships.push({ id: `c-${org}`, user_id: U_EXT, organization_id: org, role: 'member', member_type: 'customer', status: 'active' })

    it('refuses to invite an existing customer of ANOTHER portal tree as a customer', async () => {
      makeCustomer(ORG_B)
      const res = await post({ invitee: { kind: 'account', userId: U_EXT }, memberType: 'customer' })
      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', reason: 'PORTAL_CONTEXT_MISMATCH' })
      expect(invs()).toHaveLength(0)
    })

    it('also matches an existing account reached by external email', async () => {
      makeCustomer(ORG_B)
      const res = await post({ invitee: extEmail('ext@example.com'), memberType: 'customer' })
      expect(res.status).toBe(403)
    })

    it('allows it within the SAME portal tree (sub-org of the same portal)', async () => {
      makeCustomer(ORG_A1)
      const res = await post({ invitee: { kind: 'account', userId: U_EXT }, memberType: 'customer' })
      expect(res.status).toBe(201)
    })

    it('does not restrict employees across portals', async () => {
      makeCustomer(ORG_B)
      const res = await post({ invitee: { kind: 'account', userId: U_EXT }, memberType: 'employee' })
      expect(res.status).toBe(201)
    })
  })
})

describe('flag ON — POST /:id/invitations/bulk', () => {
  const bulk = (body: any, as = U_OWNER) =>
    request(appAs(as)).post(`/api/organizations/${ORG_A}/invitations/bulk`).send(body)

  it('reports per-invitee created / skipped / failed', async () => {
    await request(appAs(U_OWNER))
      .post(`/api/organizations/${ORG_A}/invitations`)
      .send({ invitee: extEmail('already@example.com'), memberType: 'employee' })
    fakeDb.tables.organization_memberships.push({ id: 'cx', user_id: U_EXT, organization_id: ORG_B, role: 'member', member_type: 'customer', status: 'active' })
    const res = await bulk({
      memberType: 'customer',
      invitees: [
        extEmail('one@example.com'),
        extEmail('already@example.com'),
        { kind: 'external', channel: 'whatsapp', phone: '+14155552671' },
        { kind: 'account', userId: U_EXT }, // customer of another portal -> failed
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 2, skipped: 1, failed: 1 })
    expect(res.body.results.map((r: any) => r.status)).toEqual(['created', 'skipped', 'created', 'failed'])
    expect(res.body.results[1].reason).toBe('already-pending')
    expect(res.body.results[3].reason).toBe('portal_context_mismatch')
    expect(res.body.results[0].invitationId).toBeDefined()
    expect(invs().filter(i => i.member_type === 'customer')).toHaveLength(2)
    expect(outbox(TOPICS.IDENTITY_INVITATION_CREATED)).toHaveLength(3) // 1 pre-existing + 2 new
  })

  it('400 on > 50, on an empty list, and on a client-chosen field', async () => {
    const many = Array.from({ length: 51 }, (_, i) => extEmail(`u${i}@example.com`))
    expect((await bulk({ memberType: 'employee', invitees: many })).status).toBe(400)
    expect((await bulk({ memberType: 'employee', invitees: [] })).status).toBe(400)
    expect((await bulk({ memberType: 'employee', invitees: [extEmail('a@b.co')], ids: ['x'] })).status).toBe(400)
    expect(invs()).toHaveLength(0)
  })

  it('403 for a plain member', async () => {
    expect((await bulk({ memberType: 'employee', invitees: [extEmail('a@b.co')] }, U_MEMBER)).status).toBe(403)
  })
})

describe('flag ON — GET /:id/invitations (cursor pagination)', () => {
  const list = (q = '', as = U_OWNER) => request(appAs(as)).get(`/api/organizations/${ORG_A}/invitations${q}`)

  function seedInvitations(n: number) {
    for (let i = 0; i < n; i++) {
      invs().push({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        organization_id: ORG_A,
        email: `p${i}@example.com`,
        channel: 'email',
        role: 'member',
        member_type: 'employee',
        token: `t${i}`,
        status: i === 0 ? 'revoked' : 'pending',
        invited_by: U_OWNER,
        expires_at: new Date(Date.now() + 86_400_000),
        // identical timestamps for pairs to exercise the (created_at, id) tiebreaker
        created_at: new Date(1_700_000_000_000 + Math.floor(i / 2) * 1000),
      })
    }
  }

  it('returns the { items, page } envelope', async () => {
    seedInvitations(2)
    const res = await list()
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false })
    expect(res.body.items[0]).toMatchObject({ organizationId: ORG_A, channel: 'email', memberType: 'employee' })
    expect(res.body.items[0]).not.toHaveProperty('token')
  })

  it('walks the whole set with no gaps or dupes, honouring limit', async () => {
    seedInvitations(7)
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res: any = await list(`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeLessThanOrEqual(3)
      seen.push(...res.body.items.map((i: any) => i.id))
      cursor = res.body.page.nextCursor
      expect(res.body.page.hasMore).toBe(cursor !== null)
      pages++
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('stays gap/dupe-free when a newer row is inserted between pages', async () => {
    seedInvitations(5)
    const first = await list('?limit=2')
    invs().push({ ...invs()[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'pending', created_at: new Date(1_800_000_000_000) })
    const second = await list(`?limit=10&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
    const ids = [...first.body.items, ...second.body.items].map((i: any) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(5) // the newer row sorts before the cursor, so it is not re-served
  })

  it('clamps an over-max limit to 200 and rejects a malformed limit / cursor', async () => {
    seedInvitations(3)
    expect((await list('?limit=100000')).status).toBe(200)
    expect((await list('?limit=0')).status).toBe(400)
    expect((await list('?limit=abc')).status).toBe(400)
    expect((await list('?cursor=not-a-cursor')).status).toBe(400)
  })

  it('filters by status (revoked / pending / expired)', async () => {
    seedInvitations(3)
    invs()[2].expires_at = new Date(Date.now() - 1000) // pending but past expiry
    expect((await list('?status=revoked')).body.items).toHaveLength(1)
    expect((await list('?status=pending')).body.items).toHaveLength(1)
    const expired = await list('?status=expired')
    expect(expired.body.items).toHaveLength(1)
    expect(expired.body.items[0].status).toBe('expired')
    expect((await list('?status=weird')).status).toBe(400)
  })

  it('403 for a non-admin', async () => {
    expect((await list('', U_MEMBER)).status).toBe(403)
  })
})

describe('flag ON — resend / revoke', () => {
  async function createPending(body: any = { invitee: extEmail('r@example.com'), memberType: 'employee' }) {
    const res = await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/invitations`).send(body)
    expect(res.status).toBe(201)
    return res.body.id as string
  }

  it('resend extends expiry, re-dispatches email, returns the Invitation', async () => {
    const id = await createPending()
    invs()[0].expires_at = new Date(Date.now() + 1000)
    emailPublish.mockClear()
    const res = await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/invitations/${id}/resend`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(id)
    expect(new Date(invs()[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)
    expect(emailPublish).toHaveBeenCalledTimes(1)
  })

  it('resend of a WhatsApp invite re-emits identity.invitation.created (no email)', async () => {
    const id = await createPending({ invitee: { kind: 'external', channel: 'whatsapp', phone: '+14155552671' }, memberType: 'customer' })
    expect(outbox(TOPICS.IDENTITY_INVITATION_CREATED)).toHaveLength(1)
    const res = await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/invitations/${id}/resend`)
    expect(res.status).toBe(200)
    expect(outbox(TOPICS.IDENTITY_INVITATION_CREATED)).toHaveLength(2)
    expect(emailPublish).not.toHaveBeenCalled()
  })

  it('resend of a non-pending invite is 409; of another org\'s invite is 404', async () => {
    const id = await createPending()
    invs()[0].status = 'revoked'
    expect((await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/invitations/${id}/resend`)).status).toBe(409)
    fakeDb.tables.organization_memberships.push({ id: 'ob', user_id: U_OWNER, organization_id: ORG_B, role: 'owner', member_type: 'employee', status: 'active' })
    expect((await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_B}/invitations/${id}/resend`)).status).toBe(404)
  })

  it('revoke -> 204, status revoked, bind token cleared; idempotent; accepted -> 409', async () => {
    const id = await createPending()
    invs()[0].bind_token = 'digest'
    const del = () => request(appAs(U_OWNER)).delete(`/api/organizations/${ORG_A}/invitations/${id}`)
    expect((await del()).status).toBe(204)
    expect(invs()[0]).toMatchObject({ status: 'revoked', bind_token: null })
    expect((await del()).status).toBe(204)
    invs()[0].status = 'accepted'
    expect((await del()).status).toBe(409)
    expect(invs()[0].status).toBe('accepted')
  })

  it('revoke / resend need org admin', async () => {
    const id = await createPending()
    expect((await request(appAs(U_MEMBER)).delete(`/api/organizations/${ORG_A}/invitations/${id}`)).status).toBe(403)
    expect((await request(appAs(U_MEMBER)).post(`/api/organizations/${ORG_A}/invitations/${id}/resend`)).status).toBe(403)
  })
})

describe('flag ON — POST /:id/members (legacy path, v2 behavior)', () => {
  it('adapts the legacy { email, role } body to an external employee invite', async () => {
    const res = await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/members`).send({ email: 'Legacy@Example.com', role: 'admin' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ role: 'admin', memberType: 'employee', invitee: { kind: 'external', channel: 'email', email: 'legacy@example.com' } })
  })

  it('accepts the contract body incl. memberType + channel', async () => {
    const res = await request(appAs(U_OWNER))
      .post(`/api/organizations/${ORG_A}/members`)
      .send({ invitee: { kind: 'external', channel: 'whatsapp', phone: '+14155552671' }, memberType: 'customer' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ channel: 'whatsapp', memberType: 'customer' })
  })

  it('owner is still not invitable', async () => {
    const res = await request(appAs(U_OWNER)).post(`/api/organizations/${ORG_A}/members`).send({ email: 'a@b.co', role: 'owner' })
    expect(res.status).toBe(400)
  })
})

describe('prefixed-ids flag ON — wire ids', () => {
  it('renders TypeIDs and accepts a prefixed org id in the path', async () => {
    ;(isPrefixedIdsEnabled as jest.Mock).mockResolvedValue(true)
    const { fromUuid } = require('@izzywdev/fuzefront-identity')
    const orgWire = fromUuid('organization', ORG_A)
    const res = await request(appAs(U_OWNER))
      .post(`/api/organizations/${orgWire}/invitations`)
      .send({ invitee: extEmail('wire@example.com'), memberType: 'employee' })
    expect(res.status).toBe(201)
    expect(res.body.organizationId).toBe(orgWire)
    expect(res.body.id).toMatch(/^ivt_/)
    expect(res.body.invitedByUserId).toMatch(/^usr_/)
    expect(invs()[0].organization_id).toBe(ORG_A) // storage stays a native uuid
  })
})
