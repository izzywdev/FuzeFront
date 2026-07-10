/**
 * OIDC auth endpoint shape tests.
 *
 * These tests do NOT require a live Authentik instance — they assert the
 * response shape when OIDC is not configured (the common case in CI and
 * unit test runs) and verify that the endpoints exist and return stable
 * contracts.
 */
import request from 'supertest'
import express from 'express'
import authRoutes from '../src/routes/auth'
import { initializeDatabase } from '../src/config/database'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  return app
}

// Single DB init + app build for the whole file to avoid multiple seed runs
// and leftover DB connections that prevent Jest from exiting cleanly.
let app: express.Application

beforeAll(async () => {
  await initializeDatabase()
  app = buildApp()
})

describe('GET /api/auth/method', () => {
  it('returns 200 with a methods array that always includes "local"', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)

    expect(Array.isArray(res.body.methods)).toBe(true)
    expect(res.body.methods).toContain('local')
  })

  it('returns oidcConfigured boolean', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(typeof res.body.oidcConfigured).toBe('boolean')
  })

  it('returns defaultMethod string', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(typeof res.body.defaultMethod).toBe('string')
    expect(['local', 'oidc']).toContain(res.body.defaultMethod)
  })

  it('when oidcConfigured is false, oidcLoginUrl is null', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)

    if (!res.body.oidcConfigured) {
      expect(res.body.oidcLoginUrl).toBeNull()
    }
  })

  it('when oidcConfigured is false, methods does not include "oidc"', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)

    if (!res.body.oidcConfigured) {
      expect(res.body.methods).not.toContain('oidc')
    }
  })
})

describe('GET /api/auth/oidc/login (OIDC not configured)', () => {
  it('returns 500 with a descriptive error when OIDC is not configured', async () => {
    const res = await request(app).get('/api/auth/oidc/login')

    if (res.status === 500) {
      expect(res.body.error).toMatch(/OIDC.*not configured/i)
    } else {
      expect(res.status).toBe(302)
    }
  })
})

describe('GET /api/auth/oidc/callback error cases', () => {
  it('redirects with error=oidc_error when error query param is present', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/callback?error=access_denied&state=abc')

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=oidc_error')
  })

  it('redirects with error=missing_parameters when code is absent', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/callback?state=abc')

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=missing_parameters')
  })

  it('redirects with error=missing_parameters when state is absent', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/callback?code=somecode')

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=missing_parameters')
  })

  it('redirects to some URL on authentication failure (code+state present but OIDC misconfigured)', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/callback?code=badcode&state=badstate')

    expect(res.status).toBe(302)
    expect(res.headers.location).toBeDefined()
  })
})
