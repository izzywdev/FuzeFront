/**
 * FFRNT-307 — Org invitations v2: public resolve, accept (200 bound / 202 enroll
 * + bindToken), and the signup-time bindToken redemption. Both flag states.
 *
 * Real routes + service over the in-memory knex stand-in (tests/helpers/fakeDb).
 */
import request from 'supertest'
import express from 'express'
import crypto from 'crypto'

jest.mock('../src/config/database', () => ({ db: require('./helpers/fakeDb').db }))
jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn((...a: any[]) => (require('./helpers/fakeDb').enqueueEvent as any)(...a)),
}))
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) =>
    req.user ? next() : res.status(401).json({ error: 'bad token' }),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))
jest.mock('../src/providers/authentik/tenants', () => ({
  currentTenant: () => ({ issuerUrl: 'https://auth.test' }),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/utils/inviteV2Flag', () => ({ isInviteV2Enabled: jest.fn() }))
jest.mock('../src/identity/flags', () => ({ isPrefixedIdsEnabled: jest.fn().mockResolvedValue(false) }))

import {
  identityInvitationAcceptedSchemaV1,
  TOPICS,
} from '@fuzefront/shared/kafka'
import { assignOrganizationRole } from '../src/utils/permit/role-assignment'
import { isInviteV2Enabled } from '../src/utils/inviteV2Flag'
import invitationsRouter from '../src/routes/invitations'
import { hashBindToken, redeemBindToken } from '../src/services/invitationsV2'
import { fakeDb, outbox, ROOT } from './helpers/fakeDb'

const flag = isInviteV2Enabled as jest.Mock

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const U_INVITER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U_NEW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' // signs up as new@example.com
const U_OTHER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const INV_ID = '99999999-9999-4999-8999-999999999999'
const TOKEN = 'a'.repeat(64)

const inv = () => fakeDb.tables.organization_invitations
const memberships = (user: string, org: string) =>
  fakeDb.tables.organization_memberships.filter(m => m.user_id === user && m.organization_id === org)

function seed(over: Record<string, any> = {}) {
  fakeDb.reset()
  const t = fakeDb.tables
  t.users.push(
    { id: U_INVITER, email: 'inviter@example.com' },
    { id: U_NEW, email: 'new@example.com', email_verified: true, phone: null, phone_verified: false },
    { id: U_OTHER, email: 'other@example.com', email_verified: true, phone: '+14155550000', phone_verified: true }
  )
  t.organizations.push(
    { id: ROOT, name: 'Root', owner_id: U_INVITER, parent_id: null },
    { id: ORG_A, name: 'Portal A', slug: 'portal-a', owner_id: U_INVITER, parent_id: ROOT },
    { id: ORG_B, name: 'Portal B', slug: 'portal-b', owner_id: U_INVITER, parent_id: ROOT }
  )
  t.organization_invitations.push({
    id: INV_ID,
    organization_id: ORG_A,
    email: 'new@example.com',
    channel: 'email',
    role: 'viewer',
    member_type: 'customer',
    token: TOKEN,
    bind_token: null,
    status: 'pending',
    invited_by: U_INVITER,
    expires_at: new Date(Date.now() + 86_400_000),
    created_at: new Date(),
    ...over,
  })
}

function appAs(userId: string | null) {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    // The accept route only authenticates when a bearer header is PRESENTED.
    if (userId) req.user = { id: userId, email: fakeDb.tables.users.find(u => u.id === userId)?.email }
    next()
  })
  app.use('/api/invitations', invitationsRouter)
  return app
}
const withBearer = (r: request.Test) => r.set('Authorization', 'Bearer t')

beforeEach(() => {
  jest.clearAllMocks()
  flag.mockResolvedValue(true)
  seed()
})

describe('GET /:token (resolve)', () => {
  it('flag ON: contract shape with masked contact, memberType and channel', async () => {
    const res = await request(appAs(null)).get(`/api/invitations/${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.invitation).toMatchObject({
      id: INV_ID,
      maskedContact: 'n***@example.com',
      channel: 'email',
      role: 'viewer',
      memberType: 'customer',
      status: 'pending',
    })
    expect(JSON.stringify(res.body)).not.toContain('new@example.com')
    expect(res.body.organization).toMatchObject({ id: ORG_A, name: 'Portal A', slug: 'portal-a' })
  })

  it('flag ON: WhatsApp contact is masked to country lead + last 4', async () => {
    seed({ channel: 'whatsapp', phone: '+14155552671', email: null })
    const res = await request(appAs(null)).get(`/api/invitations/${TOKEN}`)
    expect(res.body.invitation.maskedContact).toBe('+1 *** *** 2671')
    expect(JSON.stringify(res.body)).not.toContain('4155552671')
  })

  it('410 when revoked or expired; 404 when unknown', async () => {
    inv()[0].status = 'revoked'
    expect((await request(appAs(null)).get(`/api/invitations/${TOKEN}`)).status).toBe(410)
    seed({ expires_at: new Date(Date.now() - 1000) })
    expect((await request(appAs(null)).get(`/api/invitations/${TOKEN}`)).status).toBe(410)
    expect((await request(appAs(null)).get(`/api/invitations/nope`)).status).toBe(404)
  })

  it('flag OFF: legacy shape (masked email, no memberType)', async () => {
    flag.mockResolvedValue(false)
    const res = await request(appAs(null)).get(`/api/invitations/${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.invitation.email).toBe('n***@example.com')
    expect(res.body.invitation).not.toHaveProperty('memberType')
  })
})

describe('POST /:token/accept — anonymous (202 + bindToken)', () => {
  it('flag ON: returns the enroll action AND a bindToken; stores only its digest + short expiry', async () => {
    const res = await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ action: 'enroll', enrollUrl: 'https://auth.test/if/flow/enrollment/' })
    expect(typeof res.body.bindToken).toBe('string')
    expect(res.body.bindToken.length).toBeGreaterThanOrEqual(32)

    const row = inv()[0]
    expect(row.bind_token).toBe(hashBindToken(res.body.bindToken))
    expect(row.bind_token).not.toBe(res.body.bindToken) // plaintext is never stored
    expect(row.bind_token).toBe(crypto.createHash('sha256').update(res.body.bindToken).digest('hex'))
    const ttl = new Date(row.bind_token_expires_at).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000) // short-lived
    expect(row.status).toBe('pending') // 202 binds nothing
  })

  it('each 202 rotates the bindToken (the previous one stops working)', async () => {
    const a = await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)
    const b = await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)
    expect(a.body.bindToken).not.toBe(b.body.bindToken)
    expect((await redeemBindToken(a.body.bindToken, { id: U_NEW })).reason).toBe('invalid-token')
    expect((await redeemBindToken(b.body.bindToken, { id: U_NEW })).bound).toBe(true)
  })

  it('flag ON: 410 for a revoked/expired invite and 409 for an already-accepted one (no token minted)', async () => {
    inv()[0].status = 'revoked'
    expect((await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)).status).toBe(410)
    inv()[0].status = 'pending'
    inv()[0].expires_at = new Date(Date.now() - 1)
    expect((await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)).status).toBe(410)
    inv()[0].expires_at = new Date(Date.now() + 100000)
    inv()[0].status = 'accepted'
    expect((await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)).status).toBe(409)
    expect(inv()[0].bind_token).toBeNull()
  })

  it('flag OFF: legacy 202 WITHOUT a bindToken, nothing written', async () => {
    flag.mockResolvedValue(false)
    const res = await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)
    expect(res.status).toBe(202)
    expect(res.body).not.toHaveProperty('bindToken')
    expect(inv()[0].bind_token).toBeNull()
  })

  it('404 for an unknown token', async () => {
    expect((await request(appAs(null)).post(`/api/invitations/nope/accept`)).status).toBe(404)
  })
})

describe('POST /:token/accept — authenticated (200 bound)', () => {
  const accept = (as: string) => withBearer(request(appAs(as)).post(`/api/invitations/${TOKEN}/accept`))

  it('binds the membership with the invited role AND memberType, emits both events', async () => {
    const res = await accept(U_NEW)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'bound', organizationId: ORG_A, userId: U_NEW, role: 'viewer', memberType: 'customer' })

    const m = memberships(U_NEW, ORG_A)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ role: 'viewer', member_type: 'customer', status: 'active' })
    expect(inv()[0]).toMatchObject({ status: 'accepted', bind_token: null })

    const accepted = outbox(TOPICS.IDENTITY_INVITATION_ACCEPTED)
    expect(accepted).toHaveLength(1)
    expect(identityInvitationAcceptedSchemaV1.parse(accepted[0].payload)).toEqual({
      organizationId: ORG_A,
      invitationId: INV_ID,
      userId: U_NEW,
      role: 'viewer',
      memberType: 'customer',
    })
    expect(outbox(TOPICS.IDENTITY_MEMBERSHIP_ADDED)).toHaveLength(1)
    expect(assignOrganizationRole).toHaveBeenCalledWith(U_NEW, ORG_A, 'viewer')
  })

  it('a Permit outage does not undo the accept', async () => {
    ;(assignOrganizationRole as jest.Mock).mockRejectedValueOnce(new Error('permit down'))
    const res = await accept(U_NEW)
    expect(res.status).toBe(200)
    expect(memberships(U_NEW, ORG_A)).toHaveLength(1)
  })

  it('403 when the accepting account is not the invited identity — nothing changes', async () => {
    const res = await accept(U_OTHER)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('IDENTITY_MISMATCH')
    expect(inv()[0].status).toBe('pending')
    expect(memberships(U_OTHER, ORG_A)).toHaveLength(0)
    expect(outbox(TOPICS.IDENTITY_INVITATION_ACCEPTED)).toHaveLength(0)
  })

  it('401 (never silently anonymous) when a bearer is presented but invalid', async () => {
    // authenticateToken mock rejects when req.user is unset
    const res = await withBearer(request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`))
    expect(res.status).toBe(401)
    expect(inv()[0].bind_token).toBeNull()
  })

  it('a WhatsApp invite needs a VERIFIED matching phone', async () => {
    seed({ channel: 'whatsapp', phone: '+14155550000', email: null, member_type: 'employee', role: 'member' })
    const ok = await accept(U_OTHER)
    expect(ok.status).toBe(200)
    seed({ channel: 'whatsapp', phone: '+14155550000', email: null })
    fakeDb.tables.users.find(u => u.id === U_OTHER)!.phone_verified = false
    expect((await accept(U_OTHER)).status).toBe(403)
    expect((await accept(U_NEW)).status).toBe(403)
  })

  it('an account invitee must be that exact account (kind: account)', async () => {
    seed({ invitee_user_id: U_OTHER, email: 'other@example.com' })
    expect((await accept(U_NEW)).status).toBe(403)
    expect((await accept(U_OTHER)).status).toBe(200)
  })

  it('when email verification is enforced, an unverified email can not accept', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    process.env.EMAIL_SERVICE_URL = 'http://email'
    try {
      fakeDb.tables.users.find(u => u.id === U_NEW)!.email_verified = false
      expect((await accept(U_NEW)).status).toBe(403)
    } finally {
      delete process.env.REQUIRE_EMAIL_VERIFICATION
      delete process.env.EMAIL_SERVICE_URL
    }
  })

  it('NEVER rewrites an existing membership (an owner invited as viewer stays owner — FFRNT-300)', async () => {
    fakeDb.tables.organization_memberships.push({ id: 'm-owner', user_id: U_NEW, organization_id: ORG_A, role: 'owner', member_type: 'employee', status: 'active' })
    const res = await accept(U_NEW)
    expect(res.status).toBe(200)
    const m = memberships(U_NEW, ORG_A)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ role: 'owner', member_type: 'employee' })
    expect(outbox(TOPICS.IDENTITY_MEMBERSHIP_ADDED)).toHaveLength(0)
  })

  it('concurrent accepts: exactly one wins (CAS), one membership, the other gets 409', async () => {
    const [a, b] = await Promise.all([accept(U_NEW), accept(U_NEW)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(memberships(U_NEW, ORG_A)).toHaveLength(1)
    expect(outbox(TOPICS.IDENTITY_INVITATION_ACCEPTED)).toHaveLength(1)
  })

  it('a second accept after success is 409', async () => {
    expect((await accept(U_NEW)).status).toBe(200)
    expect((await accept(U_NEW)).status).toBe(409)
  })

  it('410 for revoked / expired', async () => {
    inv()[0].status = 'revoked'
    expect((await accept(U_NEW)).status).toBe(410)
    seed({ expires_at: new Date(Date.now() - 5) })
    expect((await accept(U_NEW)).status).toBe(410)
  })

  it('no cross-portal attach: an existing customer of another portal can not accept a customer invite', async () => {
    fakeDb.tables.organization_memberships.push({ id: 'cb', user_id: U_NEW, organization_id: ORG_B, role: 'member', member_type: 'customer', status: 'active' })
    const res = await accept(U_NEW)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PORTAL_CONTEXT_MISMATCH')
    expect(inv()[0].status).toBe('pending') // CAS never ran
    expect(memberships(U_NEW, ORG_A)).toHaveLength(0)
  })

  it('flag OFF: legacy accept shape (no memberType, no action)', async () => {
    flag.mockResolvedValue(false)
    const res = await accept(U_NEW)
    // Legacy: nothing populates req.user on this router in production, but the
    // test app injects one — the legacy handler binds with its own shape.
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ message: expect.any(String), organizationId: ORG_A, role: 'viewer' })
    expect(res.body).not.toHaveProperty('memberType')
    expect(outbox(TOPICS.IDENTITY_INVITATION_ACCEPTED)).toHaveLength(0)
  })
})

describe('redeemBindToken — external-signup binding', () => {
  async function issue(): Promise<string> {
    const res = await request(appAs(null)).post(`/api/invitations/${TOKEN}/accept`)
    return res.body.bindToken
  }

  it('end to end: 202 -> signup as the invited identity -> auto-bound with role + memberType', async () => {
    const bindToken = await issue()
    const out = await redeemBindToken(bindToken, { id: U_NEW })
    expect(out).toMatchObject({ bound: true, organizationId: ORG_A, role: 'viewer', memberType: 'customer' })
    expect(memberships(U_NEW, ORG_A)[0]).toMatchObject({ role: 'viewer', member_type: 'customer' })
    expect(inv()[0]).toMatchObject({ status: 'accepted', bind_token: null })
    expect(identityInvitationAcceptedSchemaV1.parse(outbox(TOPICS.IDENTITY_INVITATION_ACCEPTED)[0].payload).memberType).toBe('customer')
  })

  it('is SINGLE-USE', async () => {
    const bindToken = await issue()
    expect((await redeemBindToken(bindToken, { id: U_NEW })).bound).toBe(true)
    expect((await redeemBindToken(bindToken, { id: U_NEW })).reason).toBe('invalid-token')
    expect(memberships(U_NEW, ORG_A)).toHaveLength(1)
  })

  it('fails closed for an unknown token', async () => {
    expect(await redeemBindToken('not-a-token', { id: U_NEW })).toEqual({ bound: false, reason: 'invalid-token' })
  })

  it('fails closed for an expired bind token', async () => {
    const bindToken = await issue()
    inv()[0].bind_token_expires_at = new Date(Date.now() - 1000)
    expect((await redeemBindToken(bindToken, { id: U_NEW })).reason).toBe('expired')
    expect(memberships(U_NEW, ORG_A)).toHaveLength(0)
  })

  it('fails closed when the signup identity is NOT the invited identity', async () => {
    const bindToken = await issue()
    expect((await redeemBindToken(bindToken, { id: U_OTHER })).reason).toBe('identity-mismatch')
    expect(memberships(U_OTHER, ORG_A)).toHaveLength(0)
    expect(inv()[0].status).toBe('pending') // the invite is still usable by the right person
  })

  it('a WhatsApp invite can not be bound by an email-only signup (phone not verified)', async () => {
    seed({ channel: 'whatsapp', phone: '+14155550000', email: null })
    const bindToken = await issue()
    expect((await redeemBindToken(bindToken, { id: U_NEW })).reason).toBe('identity-mismatch')
  })

  it('a revoked invite can not be redeemed even with a once-valid bind token', async () => {
    const bindToken = await issue()
    inv()[0].status = 'revoked'
    expect((await redeemBindToken(bindToken, { id: U_NEW })).bound).toBe(false)
    expect(memberships(U_NEW, ORG_A)).toHaveLength(0)
  })

  it('respects the portal scope on redeem as well', async () => {
    const bindToken = await issue()
    fakeDb.tables.organization_memberships.push({ id: 'cb', user_id: U_NEW, organization_id: ORG_B, role: 'member', member_type: 'customer', status: 'active' })
    expect((await redeemBindToken(bindToken, { id: U_NEW })).reason).toBe('forbidden')
    expect(memberships(U_NEW, ORG_A)).toHaveLength(0)
  })
})
