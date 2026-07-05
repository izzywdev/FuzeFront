/**
 * Unit tests for OIDC state cookie CSRF protection.
 * Verifies that /oidc/login sets an oidc_state HttpOnly cookie, and
 * /oidc/callback rejects requests whose state query param does not match the cookie.
 */
import express from 'express'
import request from 'supertest'

jest.mock('../src/services/oidc', () => ({
  oidcService: {
    isConfigured: () => true,
    generateAuthUrl: jest.fn().mockReturnValue('http://auth.example.com/auth?state=test-state'),
    handleCallback: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', roles: ['user'] }),
  },
}))

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
    insert: jest.fn().mockResolvedValue([]),
  }),
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn(),
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}))

import { db } from '../src/config/database'
import authRouter from '../src/routes/auth'

const dbMock = db as jest.MockedFunction<any>

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

beforeEach(() => {
  jest.clearAllMocks()

  // Default db mock: sessions.insert returns a resolved promise
  dbMock.mockImplementation((table: string) => {
    if (table === 'sessions') {
      return {
        insert: jest.fn().mockResolvedValue([]),
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
      }
    }
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue([]),
    }
  })
})

describe('OIDC state cookie CSRF protection', () => {
  it('sets oidc_state cookie on /oidc/login', async () => {
    const res = await request(app).get('/api/auth/oidc/login')
    expect(res.status).toBe(302)
    const cookies = res.headers['set-cookie']
    expect(Array.isArray(cookies) ? cookies.join(';') : cookies).toMatch(/oidc_state=/)
  })

  it('rejects callback when oidc_state cookie is missing', async () => {
    const res = await request(app).get('/api/auth/oidc/callback?code=abc&state=xyz')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=invalid_state/)
  })

  it('rejects callback when oidc_state cookie does not match state param', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/callback?code=abc&state=xyz')
      .set('Cookie', 'oidc_state=DIFFERENT_VALUE')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=invalid_state/)
  })

  it('rejects callback when oidc_state cookie is same length as state param but different content (exercises timingSafeEqual)', async () => {
    // Two distinct UUID-shaped strings of equal length — the length pre-check passes,
    // so timingSafeEqual is the only guard that can fire here.
    const cookieState = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const queryState  = 'z9y8x7w6-v5u4-3210-fedc-ba9876543210'
    expect(cookieState.length).toBe(queryState.length) // sanity
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=abc&state=${queryState}`)
      .set('Cookie', `oidc_state=${cookieState}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=invalid_state/)
  })

  it('accepts callback when oidc_state cookie matches state param', async () => {
    // First get the state from a login redirect
    const loginRes = await request(app).get('/api/auth/oidc/login')
    // The mock generates URL with state=test-state — extract oidc_state cookie
    const setCookie = loginRes.headers['set-cookie']
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie
    // cookieHeader looks like: oidc_state=test-state; HttpOnly; ...
    const stateValue = cookieHeader.split(';')[0].split('=')[1]

    const { oidcService } = require('../src/services/oidc')
    const callbackRes = await request(app)
      .get(`/api/auth/oidc/callback?code=authcode&state=${stateValue}`)
      .set('Cookie', `oidc_state=${stateValue}`)
    // Should NOT redirect to invalid_state
    expect(callbackRes.headers.location).not.toMatch(/error=invalid_state/)
    expect(oidcService.handleCallback).toHaveBeenCalled()
  })
})
