/**
 * FFRNT-307 — POST /api/v1/security/signup threads `bindToken` into the
 * external-invitee bind (behind `fuzefront.identity.invite-v2`). Signup itself
 * must be unaffected in every case: the bind is fail-closed and NON-fatal.
 */
import express from 'express'
import request from 'supertest'

jest.mock('../src/config/permit', () => ({
  default: { api: {} },
  permitConfig: { token: 'test', pdp: 'http://localhost:7766' },
}))
jest.mock('../src/utils/inviteV2Flag', () => ({ isInviteV2Enabled: jest.fn() }))
jest.mock('../src/services/invitationsV2', () => ({
  ...jest.requireActual('../src/services/invitationsV2'),
  redeemBindToken: jest.fn(),
}))

import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import { isInviteV2Enabled } from '../src/utils/inviteV2Flag'
import { redeemBindToken } from '../src/services/invitationsV2'
import type { IdentityProvider, BrokeredSession } from '../src/providers/IdentityProvider'

const flag = isInviteV2Enabled as jest.Mock
const redeem = redeemBindToken as jest.Mock

const USER = { id: 'u-new', email: 'new@example.com', firstName: 'N', lastName: 'E', roles: ['user'] }
const SESSION: BrokeredSession = { token: 'tok', sessionId: 'sess', user: USER }

function makeApp(signup = jest.fn().mockResolvedValue(SESSION)) {
  setIdentityProvider({ signup } as unknown as IdentityProvider)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return { app, signup }
}

beforeEach(() => {
  jest.clearAllMocks()
  flag.mockResolvedValue(true)
  redeem.mockResolvedValue({ bound: true, organizationId: 'org', role: 'member', memberType: 'customer' })
})
afterEach(() => setIdentityProvider(null))

const body = { email: 'new@example.com', password: 'Passw0rd!Passw0rd', bindToken: 'bt-123' }

describe('POST /signup bindToken', () => {
  it('flag ON: redeems the bindToken for the freshly created account, response unchanged', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/security/signup').send(body)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ token: 'tok', sessionId: 'sess' })
    expect(res.body).not.toHaveProperty('bound') // the outcome is never an oracle
    expect(redeem).toHaveBeenCalledWith('bt-123', { id: 'u-new' })
  })

  it('flag OFF: the bindToken is ignored entirely', async () => {
    flag.mockResolvedValue(false)
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/security/signup').send(body)
    expect(res.status).toBe(201)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('no bindToken: plain signup, no redeem', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/security/signup').send({ email: 'a@b.co', password: 'pw' })
    expect(res.status).toBe(201)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('a failed / rejected bind never fails the signup', async () => {
    redeem.mockResolvedValue({ bound: false, reason: 'identity-mismatch' })
    const a = await request(makeApp().app).post('/api/v1/security/signup').send(body)
    expect(a.status).toBe(201)
    redeem.mockRejectedValue(new Error('db down'))
    const b = await request(makeApp().app).post('/api/v1/security/signup').send(body)
    expect(b.status).toBe(201)
  })

  it('a malformed bindToken is ignored (not redeemed), signup still succeeds', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/security/signup').send({ ...body, bindToken: { $ne: 1 } })
    expect(res.status).toBe(201)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('does not attempt a bind when signup itself fails', async () => {
    const { app } = makeApp(jest.fn().mockRejectedValue(new Error('conflict')))
    const res = await request(app).post('/api/v1/security/signup').send(body)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(redeem).not.toHaveBeenCalled()
  })
})
