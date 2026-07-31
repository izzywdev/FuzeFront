import express from 'express'
import request from 'supertest'
import authzRoutes from '../src/routes/authz'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', authzRoutes)
  return app
}

const identityProvider = {
  getUserInfo: jest.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}

const authorizationProvider = {
  check: jest.fn().mockResolvedValue(false),
  bulkCheck: jest.fn().mockResolvedValue([true, false]),
  revoke: jest.fn().mockResolvedValue(undefined),
  listGrants: jest.fn().mockResolvedValue({
    items: [],
    page: { nextCursor: null, hasMore: false },
  }),
}

beforeEach(() => {
  jest.clearAllMocks()
  setIdentityProvider(identityProvider as any)
  setAuthorizationProvider(authorizationProvider as any)
})

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

describe('Security API OpenAPI authorization contracts', () => {
  describe('GET /api/v1/security/authz/grants', () => {
    it('returns a 200 application/json page for the caller subject without a 403 forbidden authorization result', async () => {
      // @fuzequality api listGrants
      const response = await request(buildApp())
        .get('/api/v1/security/authz/grants?tenant=tenant-1')
        .set('Authorization', 'Bearer valid-token')
        .expect(200)

      expect(response.type).toMatch(/json/)
      expect(response.body).toEqual({
        items: [],
        page: { nextCursor: null, hasMore: false },
      })
      expect(authorizationProvider.listGrants).toHaveBeenCalledWith({
        subject: 'user-1',
        tenant: 'tenant-1',
        limit: undefined,
        cursor: undefined,
      })
    })

    it('returns 401 when grants are listed without authentication', async () => {
      // @fuzequality api listGrants
      const response = await request(buildApp())
        .get('/api/v1/security/authz/grants?tenant=tenant-1')
        .expect(401)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('AUTH_REQUIRED')
    })

    it('returns 400 when the required query tenant is missing', async () => {
      // @fuzequality api listGrants
      const response = await request(buildApp())
        .get('/api/v1/security/authz/grants')
        .set('Authorization', 'Bearer valid-token')
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })
  })

  describe('DELETE /api/v1/security/authz/grants', () => {
    it('returns 204 for an authorized application/json revoke without a 403 forbidden result', async () => {
      // @fuzequality api revokeGrant
      await request(buildApp())
        .delete('/api/v1/security/authz/grants')
        .set('Authorization', 'Bearer valid-token')
        .send({ grantId: 'grant-1' })
        .expect(204)

      expect(authorizationProvider.revoke).toHaveBeenCalledWith({ grantId: 'grant-1' })
    })

    it('returns 401 when grant revocation is attempted without authentication', async () => {
      // @fuzequality api revokeGrant
      const response = await request(buildApp())
        .delete('/api/v1/security/authz/grants')
        .send({ grantId: 'grant-1' })
        .expect(401)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('AUTH_REQUIRED')
    })

    it('returns 400 for a malformed grant revocation request', async () => {
      // @fuzequality api revokeGrant
      const response = await request(buildApp())
        .delete('/api/v1/security/authz/grants')
        .set('Authorization', 'Bearer valid-token')
        .send({})
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })
  })

  describe('POST /api/v1/security/authz/check', () => {
    it('returns a 200 application/json response for an application/json request with a forbidden authorization decision', async () => {
      // @fuzequality api authzCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/check')
        .set('Authorization', 'Bearer valid-token')
        .send({ tenant: 'tenant-1', resource: { type: 'App' }, action: 'delete' })
        .expect(200)

      expect(response.type).toMatch(/json/)
      expect(response.body).toEqual({ allow: false })
    })

    it('returns 401 when authz check is called without authentication', async () => {
      // @fuzequality api authzCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/check')
        .send({ tenant: 'tenant-1', resource: { type: 'App' }, action: 'read' })
        .expect(401)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('AUTH_REQUIRED')
    })

    it('returns 400 for a malformed authz check request', async () => {
      // @fuzequality api authzCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/check')
        .set('Authorization', 'Bearer valid-token')
        .send({ tenant: 'tenant-1' })
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })

    it('rejects an unsupported text/plain authz check content type with 400', async () => {
      // @fuzequality api authzCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/check')
        .set('Authorization', 'Bearer valid-token')
        .set('Content-Type', 'text/plain')
        .send('tenant=tenant-1')
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })
  })

  describe('POST /api/v1/security/authz/bulk-check', () => {
    it('returns a 200 application/json response for an application/json batch including a forbidden authorization decision', async () => {
      // @fuzequality api authzBulkCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/bulk-check')
        .set('Authorization', 'Bearer valid-token')
        .send({
          checks: [
            { tenant: 'tenant-1', resource: { type: 'App' }, action: 'read' },
            { tenant: 'tenant-1', resource: { type: 'App' }, action: 'delete' },
          ],
        })
        .expect(200)

      expect(response.type).toMatch(/json/)
      expect(response.body).toEqual({
        decisions: [{ allow: true }, { allow: false }],
      })
    })

    it('returns 401 when bulk-check is called without authentication', async () => {
      // @fuzequality api authzBulkCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/bulk-check')
        .send({ checks: [] })
        .expect(401)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('AUTH_REQUIRED')
    })

    it('returns 400 for a malformed bulk-check request', async () => {
      // @fuzequality api authzBulkCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/bulk-check')
        .set('Authorization', 'Bearer valid-token')
        .send({ checks: [] })
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })

    it('rejects an unsupported text/plain content type with 400', async () => {
      // @fuzequality api authzBulkCheck
      const response = await request(buildApp())
        .post('/api/v1/security/authz/bulk-check')
        .set('Authorization', 'Bearer valid-token')
        .set('Content-Type', 'text/plain')
        .send('checks=invalid')
        .expect(400)

      expect(response.type).toMatch(/json/)
      expect(response.body.code).toBe('MALFORMED')
    })
  })
})
