/**
 * INDEPENDENT BOLA / object-level-authorization acceptance test for billing.
 *
 * Acceptance criterion (security): an authenticated user MUST NOT be able to
 * create a subscription/checkout for, or read the subscription of, an
 * organization (or another user's account) they do NOT belong to. The
 * (entityType, entityId) in the request identifies WHOSE billing relationship is
 * being acted on; the platform must verify the caller owns/administers that
 * entity before forwarding to the billing-service.
 *
 * This test asserts the SECURE behavior. It is EXPECTED TO FAIL against the
 * current implementation, because backend/src/routes/billing.ts forwards the
 * client-supplied entityId verbatim with only `authenticateToken` (authN) and NO
 * object-level authZ check, and the billing-service trusts (entityType, entityId)
 * from the body. A failing test here is a VALID, valuable finding (a real BOLA
 * gap) — it is NOT to be "fixed" by weakening the assertion. Coordinated
 * conceptually with appsec; authored independently.
 *
 * The fix belongs to backend-engineer / billing-payments-engineer (add an
 * ownership/membership check, e.g. via Permit.io, keyed on req.user vs entityId),
 * NOT to this test.
 *
 * No live Stripe/billing-service: axios upstream is mocked; auth is stubbed to a
 * fixed caller identity so we can express "caller != entity owner".
 */

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// Caller is user "attacker-1", member of org ATTACKER_ORG only.
const ATTACKER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTACKER_ORG_ID = 'a0000000-0000-4000-8000-000000000000'
// Victim org the attacker does NOT belong to.
const VICTIM_ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VICTIM_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    // A fully-authenticated, NON-admin platform user who belongs ONLY to ATTACKER_ORG.
    req.user = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: '<EMAIL_b4f4af66c4cf>',
      roles: ['user'],
      organizationIds: ['a0000000-0000-4000-8000-000000000000'],
    }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import request from 'supertest'
import express from 'express'

process.env.BILLING_SERVICE_URL = 'http://billing.test:3006'
process.env.BILLING_INTERNAL_TOKEN = 'test-internal-token'

import billingRoutes from '../src/routes/billing'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/billing', billingRoutes)
  return app
}

function okUpstream(body: unknown, status = 200) {
  mockedAxios.request.mockResolvedValueOnce({
    status,
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify(body)),
  } as any)
}

describe('billing BOLA acceptance :: cross-tenant access must be denied', () => {
  let app: express.Application
  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('a user CANNOT create a subscription/checkout for an organization they do not belong to', async () => {
    // Upstream would happily create it — the platform is the trust boundary that
    // must stop this BEFORE forwarding.
    okUpstream({ subscription: { id: 's_victim' }, requiresAction: false }, 201)

    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer attacker-jwt')
      .send({ entityType: 'organization', entityId: VICTIM_ORG_ID, priceId: 'price_1TnCqVDaNn3aKLEz05TbFbFQ' })

    // SECURE expectation: rejected with 403 (or 401), and NOT forwarded upstream.
    expect([401, 403]).toContain(res.status)
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })

  it('a user CANNOT create a subscription/checkout for ANOTHER user account', async () => {
    okUpstream({ subscription: { id: 's_victim_user' }, requiresAction: false }, 201)

    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer attacker-jwt')
      .send({ entityType: 'user', entityId: VICTIM_USER_ID, priceId: 'price_1TnCqVDaNn3aKLEz05TbFbFQ' })

    expect([401, 403]).toContain(res.status)
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })

  it('a user CANNOT create a setup-intent for an organization they do not belong to', async () => {
    okUpstream({ clientSecret: 'seti_victim' })

    const res = await request(app)
      .post('/api/v1/billing/setup-intent')
      .set('Authorization', 'Bearer attacker-jwt')
      .send({ entityType: 'organization', entityId: VICTIM_ORG_ID })

    expect([401, 403]).toContain(res.status)
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })

  it('a user CAN act on an organization they DO belong to (control: must NOT be blocked)', async () => {
    // Control case so the BOLA assertion above is meaningful and not just
    // "everything is blocked". The attacker's own org should be allowed.
    okUpstream({ subscription: { id: 's_own' }, requiresAction: false }, 201)

    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer attacker-jwt')
      .send({ entityType: 'organization', entityId: ATTACKER_ORG_ID, priceId: 'price_1TnCqVDaNn3aKLEz05TbFbFQ' })

    // The caller's own org must succeed (forwarded upstream -> 201).
    expect(res.status).toBe(201)
    expect(mockedAxios.request).toHaveBeenCalled()
  })
})
