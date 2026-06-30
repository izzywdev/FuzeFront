// Unit tests for the host-backend billing proxy's invoices + portal routes
// (backend/src/routes/billing.ts).
//
// Pure unit tests, mirroring backend/tests/billing-proxy.test.ts: the upstream
// billing-service HTTP client (axios), the JWT auth middleware, and the Permit.io
// org-permission check are all mocked, so the suite runs WITHOUT a database or a
// live billing-service. They assert:
//   * GET /invoices: authenticated + 'read'-authorized on the org -> forwards to
//     /invoices with the trusted X-Billing-*/X-FF-* headers and the limit/cursor
//     query; relays the upstream { invoices, nextCursor } body; a caller WITHOUT
//     'read' on the target org -> 403 (BOLA) with NO forward; unauthenticated ->
//     401.
//   * POST /portal: 'manage'-authorized -> forwards to /portal with returnUrl in
//     the body + trusted headers; a client-supplied organizationId/entityId in
//     the body is STRIPPED and cannot retarget another org (BOLA); a caller
//     without 'manage' -> 403; unauthenticated -> 401.

// --- mock the upstream HTTP client -----------------------------------------
jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// --- mock the JWT auth middleware ------------------------------------------
// Toggle authentication per-test: when `authedUser` is null the middleware
// rejects with 401 (so we can test the unauthenticated path); otherwise it sets
// req.user (the authenticated caller).
let authedUser: { id: string; email: string; roles: string[] } | null = {
  id: 'user-1',
  email: '<EMAIL_b4f4af66c4cf>',
  roles: ['user'],
}
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (!authedUser) {
      return res
        .status(401)
        .json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    }
    req.user = authedUser
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

// --- mock the Permit.io org-permission check (object-level authz) -----------
jest.mock('../src/utils/permit/permission-check', () => ({
  checkOrganizationPermission: jest.fn(),
}))
import { checkOrganizationPermission } from '../src/utils/permit/permission-check'
const mockCheckOrgPermission = checkOrganizationPermission as jest.MockedFunction<
  typeof checkOrganizationPermission
>

import request from 'supertest'
import express from 'express'

// Set env BEFORE importing the router (module reads env at load time).
process.env.BILLING_SERVICE_URL = 'http://billing.test:3006'
process.env.BILLING_INTERNAL_TOKEN = 'test-internal-token'

import billingRoutes from '../src/routes/billing'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/billing', billingRoutes)
  return app
}

function okUpstream(body: unknown, status = 200, contentType = 'application/json') {
  mockedAxios.request.mockResolvedValueOnce({
    status,
    headers: { 'content-type': contentType },
    data: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  } as any)
}

describe('billing proxy: invoices + portal', () => {
  let app: express.Application
  const ORG = '33333333-3333-3333-3333-333333333333'

  beforeEach(() => {
    jest.clearAllMocks()
    authedUser = { id: 'user-1', email: '<EMAIL_b4f4af66c4cf>', roles: ['user'] }
    // Default: caller IS authorized on the target org. Deny-path tests override.
    mockCheckOrgPermission.mockResolvedValue(true)
    app = buildApp()
  })

  // -------------------------------------------------------------------------
  // GET /invoices (read-scope, paginated)
  // -------------------------------------------------------------------------
  describe('GET /invoices', () => {
    it('unauthenticated -> 401, never reaches the billing-service', async () => {
      authedUser = null

      const res = await request(app).get('/api/v1/billing/invoices')

      expect(res.status).toBe(401)
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).not.toHaveBeenCalled()
    })

    it('user-scope: forwards to /invoices, identity server-derived (no org check), relays body', async () => {
      okUpstream({ invoices: [{ id: 'in_1' }], nextCursor: 'cur_2' })

      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .query({ limit: '10', cursor: 'cur_1' })
        .set('Authorization', 'Bearer user-jwt')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ invoices: [{ id: 'in_1' }], nextCursor: 'cur_2' })

      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.method).toBe('GET')
      expect(call.url).toBe('http://billing.test:3006/api/v1/billing/invoices')
      expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
      // limit/cursor relayed via the query allow-list.
      expect(call.params).toEqual({ limit: '10', cursor: 'cur_1' })
      // user-scope: identity is server-derived, no org permission consulted.
      expect((call.headers as any)['X-Billing-Entity-Type']).toBe('user')
      expect((call.headers as any)['X-Billing-Entity-Id']).toBe('user-1')
      expect((call.headers as any)['X-FF-Actor-Id']).toBe('user-1')
      expect(mockCheckOrgPermission).not.toHaveBeenCalled()
    })

    it('org-scope authorized (read) -> forwards with trusted headers + limit/cursor query', async () => {
      okUpstream({ invoices: [{ id: 'in_9' }], nextCursor: null })

      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .query({
          entityType: 'organization',
          organizationId: ORG,
          limit: '25',
          cursor: 'abc',
          evil: 'drop-me',
        })
        .set('Authorization', 'Bearer user-jwt')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ invoices: [{ id: 'in_9' }], nextCursor: null })
      // read gate, not manage.
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'read', ORG)

      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.url).toBe('http://billing.test:3006/api/v1/billing/invoices')
      // organizationId is NOT in the allow-list (identity stays server-derived);
      // only limit/cursor are forwarded, `evil` is dropped.
      expect(call.params).toEqual({ limit: '25', cursor: 'abc' })
      // Authorized org carried ONLY via trusted headers.
      expect((call.headers as any)['X-Billing-Entity-Type']).toBe('organization')
      expect((call.headers as any)['X-Billing-Entity-Id']).toBe(ORG)
      expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
      expect((call.headers as any)['X-FF-Actor-Id']).toBe('user-1')
    })

    it('BOLA: caller WITHOUT read on the target org -> 403, no forward', async () => {
      mockCheckOrgPermission.mockResolvedValue(false)

      const res = await request(app)
        .get('/api/v1/billing/invoices')
        .query({ entityType: 'organization', organizationId: ORG })
        .set('Authorization', 'Bearer user-jwt')

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('ORG_PERMISSION_DENIED')
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'read', ORG)
    })
  })

  // -------------------------------------------------------------------------
  // POST /portal (manage-scope)
  // -------------------------------------------------------------------------
  describe('POST /portal', () => {
    it('unauthenticated -> 401, never reaches the billing-service', async () => {
      authedUser = null

      const res = await request(app)
        .post('/api/v1/billing/portal')
        .send({ returnUrl: 'https://app/billing' })

      expect(res.status).toBe(401)
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).not.toHaveBeenCalled()
    })

    it('user-scope: forwards { returnUrl } + trusted headers, identity server-derived, relays { url }', async () => {
      okUpstream({ url: 'https://billing.stripe.com/p/sess_1' })

      const res = await request(app)
        .post('/api/v1/billing/portal')
        .set('Authorization', 'Bearer user-jwt')
        .send({ returnUrl: 'https://app/billing' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ url: 'https://billing.stripe.com/p/sess_1' })

      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.method).toBe('POST')
      expect(call.url).toBe('http://billing.test:3006/api/v1/billing/portal')
      expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
      // returnUrl survives; no entity selectors injected into the body.
      expect(call.data).toEqual({ returnUrl: 'https://app/billing' })
      // user-scope identity server-derived; no org check.
      expect((call.headers as any)['X-Billing-Entity-Type']).toBe('user')
      expect((call.headers as any)['X-Billing-Entity-Id']).toBe('user-1')
      expect((call.headers as any)['X-FF-Actor-Id']).toBe('user-1')
      expect(mockCheckOrgPermission).not.toHaveBeenCalled()
    })

    it('org-scope authorized (manage) -> forwards returnUrl + trusted headers', async () => {
      okUpstream({ url: 'https://billing.stripe.com/p/sess_org' })

      const res = await request(app)
        .post('/api/v1/billing/portal')
        .set('Authorization', 'Bearer user-jwt')
        .send({ entityType: 'organization', entityId: ORG, returnUrl: 'https://app/org-billing' })

      expect(res.status).toBe(200)
      // manage gate, not read.
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)

      const call = mockedAxios.request.mock.calls[0][0]
      // Client-supplied entity selectors STRIPPED from the body; returnUrl kept.
      expect(call.data).toEqual({ returnUrl: 'https://app/org-billing' })
      // Authorized org carried via trusted headers only.
      expect((call.headers as any)['X-Billing-Entity-Type']).toBe('organization')
      expect((call.headers as any)['X-Billing-Entity-Id']).toBe(ORG)
      expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
    })

    it('BOLA: a client-smuggled organizationId in the body cannot retarget another org', async () => {
      // Caller is authorized (manage) on ORG via the body selector. They ALSO
      // try to smuggle a victim org id. authorizeBillingEntity authorizes the
      // declared org, and forward() strips organizationId from the forwarded
      // body — only the authorized org travels (via headers).
      const VICTIM = '99999999-9999-9999-9999-999999999999'
      okUpstream({ url: 'https://billing.stripe.com/p/sess_x' })

      await request(app)
        .post('/api/v1/billing/portal')
        .set('Authorization', 'Bearer user-jwt')
        .send({
          entityType: 'organization',
          entityId: ORG,
          organizationId: VICTIM,
          returnUrl: 'https://app/billing',
        })

      // Authorization was performed against the declared entityId (ORG), and
      // organizationId is never trusted from the body for the forward.
      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.data).toEqual({ returnUrl: 'https://app/billing' })
      expect((call.data as any).organizationId).toBeUndefined()
      expect((call.data as any).entityId).toBeUndefined()
      // The trusted org header is the AUTHORIZED org, never the smuggled victim.
      expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
      expect((call.headers as any)['X-Billing-Entity-Id']).toBe(ORG)
    })

    it('BOLA: caller WITHOUT manage on the target org -> 403, no forward', async () => {
      mockCheckOrgPermission.mockResolvedValue(false)

      const res = await request(app)
        .post('/api/v1/billing/portal')
        .set('Authorization', 'Bearer user-jwt')
        .send({ entityType: 'organization', entityId: ORG, returnUrl: 'https://app/billing' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('ORG_PERMISSION_DENIED')
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)
    })
  })
})
