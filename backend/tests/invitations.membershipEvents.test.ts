/**
 * Unit test — invite-accept (monolith, /api/invitations/:token/accept) enqueues
 * `identity.membership.added` on the transactional outbox, in the SAME
 * transaction as the membership insert, and only when a membership row was
 * actually created. No Postgres: `db` and `enqueueEvent` are mocked.
 */
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), { transaction: jest.fn() }),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  __esModule: true,
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/utils/identityFlag', () => ({
  getRequestPortalScopingEnabled: jest.fn().mockResolvedValue(false),
}))
jest.mock('../src/identity/flags', () => ({
  isPrefixedIdsEnabled: jest.fn().mockResolvedValue(false),
}))
jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn().mockResolvedValue(undefined),
}))

import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'
import { db } from '../src/config/database'
import invitationsRouter from '../src/routes/invitations'

const dbMock = db as unknown as jest.Mock & { transaction: jest.Mock }
const enqueueEventMock = enqueueEvent as jest.Mock

const USER_ID = 'user-aaaa'
const ORG_ID = 'org-bbbb'
const TOKEN = 'tok-123'
const EMAIL = 'invitee@example.com'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const app = express()
app.use(express.json())
app.use('/api/invitations', invitationsRouter)

function chain(result: any) {
  const c: any = {
    select: () => c,
    where: () => c,
    first: async () => result,
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
  }
  return c
}

/** Wires db()/trx() for one accept request. */
function wire(opts: { existingMembership?: any; casRowCount?: number }) {
  const invitation = {
    id: 'inv-1',
    token: TOKEN,
    email: EMAIL,
    organization_id: ORG_ID,
    role: 'viewer',
    status: 'pending',
    portal_id: null,
    expires_at: new Date(Date.now() + 3_600_000),
  }
  const membershipInsert = jest.fn().mockResolvedValue([1])
  const trx: any = jest.fn((table: string) => {
    if (table === 'organization_memberships') {
      const c = chain(opts.existingMembership)
      c.insert = membershipInsert
      return c
    }
    return chain(undefined)
  })
  trx.raw = jest.fn().mockResolvedValue({ rowCount: opts.casRowCount ?? 1 })

  dbMock.mockImplementation((table: string) => {
    if (table === 'organization_invitations') return chain(invitation)
    if (table === 'users') return chain({ id: USER_ID, email: EMAIL, home_portal_id: null })
    return chain(undefined)
  })
  dbMock.transaction.mockImplementation(async (cb: any) => cb(trx))
  return { trx, membershipInsert }
}

const auth = () => `Bearer ${jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET!)}`

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/invitations/:token/accept — membership.added outbox emit (site 5)', () => {
  it('enqueues identity.membership.added with invitation.role inside the txn when the membership is created', async () => {
    const { trx, membershipInsert } = wire({ existingMembership: undefined })

    const res = await request(app)
      .post(`/api/invitations/${TOKEN}/accept`)
      .set('Authorization', auth())

    expect(res.status).toBe(200)
    expect(membershipInsert).toHaveBeenCalledTimes(1)
    expect(enqueueEventMock).toHaveBeenCalledTimes(1)
    const [trxArg, topic, payload, correlationId] = enqueueEventMock.mock.calls[0]
    expect(trxArg).toBe(trx) // same transaction as the insert
    expect(topic).toBe(TOPICS.IDENTITY_MEMBERSHIP_ADDED)
    expect(payload).toEqual({ organizationId: ORG_ID, userId: USER_ID, role: 'viewer' })
    expect(correlationId).toMatch(/^identity-membership-added-[0-9a-f-]{36}$/)
  })

  it('does NOT enqueue when the user was already a member (no membership inserted)', async () => {
    const { membershipInsert } = wire({ existingMembership: { id: 'm-existing' } })

    const res = await request(app)
      .post(`/api/invitations/${TOKEN}/accept`)
      .set('Authorization', auth())

    expect(res.status).toBe(200)
    expect(membershipInsert).not.toHaveBeenCalled()
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('does NOT enqueue when the CAS accept lost the race (409)', async () => {
    const { membershipInsert } = wire({ existingMembership: undefined, casRowCount: 0 })

    const res = await request(app)
      .post(`/api/invitations/${TOKEN}/accept`)
      .set('Authorization', auth())

    expect(res.status).toBe(409)
    expect(membershipInsert).not.toHaveBeenCalled()
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })
})
