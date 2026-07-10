/**
 * Unit tests for OIDC code-exchange endpoint.
 * Verifies that /oidc/callback issues a short-lived opaque code (not a token in URL),
 * and that POST /api/auth/token-exchange redeems it exactly once within the TTL.
 */
import express from 'express'
import request from 'supertest'

jest.mock('../src/services/oidc', () => ({
  oidcService: {
    isConfigured: () => true,
    generateAuthUrl: jest.fn().mockReturnValue({ url: 'http://auth.example.com/auth?state=test-state', codeVerifier: 'mock-code-verifier' }),
    handleCallback: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', firstName: 'U', lastName: 'E', roles: ['user'] })
  }
}))

jest.mock('../src/config/database', () => ({
  db: Object.assign(
    jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue([]) }),
    { transaction: jest.fn(), insert: jest.fn().mockResolvedValue([]) }
  )
}))

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn()
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('mock-session-uuid') }))

import authRouter from '../src/routes/auth'

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

describe('OIDC code-exchange endpoint', () => {
  it('callback redirects with ?code= not ?token=', async () => {
    const STATE = 'test-state'
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=authcode&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=mock-code-verifier`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/[?&]code=/)
    expect(res.headers.location).not.toMatch(/[?&]token=/)
    expect(res.headers.location).not.toMatch(/[?&]sessionId=/)
  })

  it('POST /token-exchange returns token and sessionId for valid code', async () => {
    const STATE = 'test-state'
    const cbRes = await request(app)
      .get(`/api/auth/oidc/callback?code=authcode&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=mock-code-verifier`)
    const location = cbRes.headers.location
    const code = new URL(location).searchParams.get('code')

    const exRes = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(exRes.status).toBe(200)
    expect(exRes.body).toHaveProperty('token')
    expect(exRes.body).toHaveProperty('sessionId')
  })

  it('second token-exchange with same code returns 401', async () => {
    const STATE = 'test-state'
    const cbRes = await request(app)
      .get(`/api/auth/oidc/callback?code=authcode&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=mock-code-verifier`)
    const code = new URL(cbRes.headers.location).searchParams.get('code')

    await request(app).post('/api/auth/token-exchange').send({ code })
    const second = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(second.status).toBe(401)
  })

  it('expired code returns 401', async () => {
    jest.useFakeTimers()
    const STATE = 'test-state'
    const cbRes = await request(app)
      .get(`/api/auth/oidc/callback?code=authcode&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=mock-code-verifier`)
    const code = new URL(cbRes.headers.location).searchParams.get('code')

    // Advance time past 60s TTL
    jest.advanceTimersByTime(61_000)

    const exRes = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(exRes.status).toBe(401)
    jest.useRealTimers()
  })

  it('unknown code returns 401', async () => {
    const res = await request(app).post('/api/auth/token-exchange').send({ code: 'nonexistent' })
    expect(res.status).toBe(401)
  })

  it('missing code body returns 400', async () => {
    const res = await request(app).post('/api/auth/token-exchange').send({})
    expect(res.status).toBe(400)
  })
})
