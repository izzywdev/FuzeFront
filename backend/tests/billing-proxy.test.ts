// Unit tests for the host-backend billing proxy (backend/src/routes/billing.ts).
//
// These are pure unit tests: the upstream billing-service HTTP client (axios)
// and the JWT auth middleware are both mocked, so the suite runs WITHOUT a
// database or a live billing-service. They assert the proxy's wiring:
//   * correct upstream URL/method/path are built from the contract,
//   * the internal token is injected on user-facing routes,
//   * GET /plans is reachable without a JWT,
//   * the upstream status/body are relayed verbatim,
//   * the Stripe webhook forwards the RAW body + Stripe-Signature unauthenticated
//     and is mounted before any JSON parsing,
//   * upstream unreachability surfaces as 502,
//   * object-level authorization (BOLA/IDOR) is enforced before any forward:
//     non-member -> 403, member/owner -> forwarded, and the forwarded body's
//     entity selectors are SERVER-DERIVED (client values cannot target another
//     entity).

// --- mock the upstream HTTP client -----------------------------------------
jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

// --- mock the JWT auth middleware: pass-through, sets a fake user -----------
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: '<EMAIL_b4f4af66c4cf>', roles: ['user'] }
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

import billingRoutes, { billingWebhookRouter } from '../src/routes/billing'

// Build an app wired exactly like src/index.ts: webhook (raw) before json().
function buildApp(): express.Application {
  const app = express()
  app.use('/api/v1/billing/webhooks/stripe', billingWebhookRouter)
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

describe('billing proxy', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    // Default: caller IS authorized on the target org. Individual tests
    // override this to assert the deny path.
    mockCheckOrgPermission.mockResolvedValue(true)
    app = buildApp()
  })

  it('GET /plans is reachable without a JWT and relays the upstream body', async () => {
    okUpstream({ plans: [{ tierName: 'pro' }] })

    const res = await request(app).get('/api/v1/billing/plans')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ plans: [{ tierName: 'pro' }] })

    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('GET')
    expect(call.url).toBe('http://billing.test:3006/api/v1/billing/plans')
    // internal token injected upstream
    expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
  })

  it('POST /subscriptions forwards the JSON body + internal token (user-scope, entityId server-derived)', async () => {
    okUpstream({ subscription: { id: 's1' }, requiresAction: false }, 201)

    // Client TRIES to target user 'abc' — the proxy must override entityId to
    // the authenticated user (user-1) for user-scoped billing.
    const payload = { entityType: 'user', entityId: 'abc', priceId: 'price_1' }
    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer user-jwt')
      .send(payload)

    expect(res.status).toBe(201)
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe('http://billing.test:3006/api/v1/billing/subscriptions')
    // entityId is SERVER-DERIVED to the authenticated user; the client's 'abc'
    // is dropped. priceId (a non-identity field) passes through.
    expect(call.data).toEqual({
      entityType: 'user',
      entityId: 'user-1',
      priceId: 'price_1',
    })
    expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
    // user-scope does NOT consult the org permission layer.
    expect(mockCheckOrgPermission).not.toHaveBeenCalled()
  })

  it('GET subscription forwards the path param', async () => {
    okUpstream({ subscription: { stripeSubscriptionId: 'sub_123' } })

    const res = await request(app)
      .get('/api/v1/billing/subscriptions/sub_123')
      .set('Authorization', 'Bearer user-jwt')

    expect(res.status).toBe(200)
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('GET')
    expect(call.url).toBe(
      'http://billing.test:3006/api/v1/billing/subscriptions/sub_123'
    )
  })

  it('PATCH subscription forwards body + path', async () => {
    okUpstream({ subscription: { stripeSubscriptionId: 'sub_123' } })

    const res = await request(app)
      .patch('/api/v1/billing/subscriptions/sub_123')
      .set('Authorization', 'Bearer user-jwt')
      .send({ seatQuantity: 3 })

    expect(res.status).toBe(200)
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('PATCH')
    expect(call.url).toBe(
      'http://billing.test:3006/api/v1/billing/subscriptions/sub_123'
    )
    expect(call.data).toEqual({ seatQuantity: 3 })
  })

  it('DELETE subscription forwards as cancel', async () => {
    okUpstream({ subscription: { cancelAtPeriodEnd: true } })

    const res = await request(app)
      .delete('/api/v1/billing/subscriptions/sub_123')
      .set('Authorization', 'Bearer user-jwt')

    expect(res.status).toBe(200)
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('DELETE')
    expect(call.url).toBe(
      'http://billing.test:3006/api/v1/billing/subscriptions/sub_123'
    )
  })

  it('POST /setup-intent forwards body + token', async () => {
    okUpstream({ clientSecret: 'seti_secret' })

    const res = await request(app)
      .post('/api/v1/billing/setup-intent')
      .set('Authorization', 'Bearer user-jwt')
      .send({ entityType: 'user', entityId: 'abc' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ clientSecret: 'seti_secret' })
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.url).toBe('http://billing.test:3006/api/v1/billing/setup-intent')
  })

  describe('stripe webhook passthrough', () => {
    it('forwards the RAW body + Stripe-Signature, unauthenticated upstream', async () => {
      okUpstream({ received: true })

      const raw = '{"id":"evt_1","type":"customer.subscription.updated"}'
      const res = await request(app)
        .post('/api/v1/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=deadbeef')
        .send(raw)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ received: true })

      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.url).toBe(
        'http://billing.test:3006/api/v1/billing/webhooks/stripe'
      )
      // raw body preserved verbatim (Buffer), not re-serialized JSON
      expect(Buffer.isBuffer(call.data)).toBe(true)
      expect((call.data as Buffer).toString()).toBe(raw)
      // Stripe-Signature forwarded
      expect((call.headers as any)['Stripe-Signature']).toBe('t=1,v1=deadbeef')
      // NO internal token on the public webhook route
      expect((call.headers as any).Authorization).toBeUndefined()
    })
  })

  it('relays a non-2xx upstream status + body verbatim (e.g. 502 StripeError)', async () => {
    okUpstream({ error: 'stripe error', message: 'card_declined' }, 502)

    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer user-jwt')
      .send({ entityType: 'user', entityId: 'abc', priceId: 'p' })

    expect(res.status).toBe(502)
    expect(res.body.error).toBe('stripe error')
  })

  it('returns 502 when the billing-service is unreachable', async () => {
    mockedAxios.request.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )

    const res = await request(app).get('/api/v1/billing/plans')

    expect(res.status).toBe(502)
    expect(res.body.error).toBe('Billing service unavailable')
    expect(res.body.code).toBe('ECONNREFUSED')
  })

  // -------------------------------------------------------------------------
  // Object-level authorization (BOLA/IDOR). The authenticated user is 'user-1'
  // (from the mocked auth middleware). These assert that a caller can only act
  // on entities they are authorized for, and that no forward happens on deny.
  // -------------------------------------------------------------------------
  describe('object-level authorization (BOLA/IDOR)', () => {
    const ORG = '11111111-1111-1111-1111-111111111111'

    describe('org-scoped: non-member -> 403, no forward', () => {
      const cases: Array<{
        verb: string
        run: () => request.Test
      }> = [
        {
          verb: 'POST /subscriptions',
          run: () =>
            request(app)
              .post('/api/v1/billing/subscriptions')
              .set('Authorization', 'Bearer user-jwt')
              .send({ entityType: 'organization', entityId: ORG, priceId: 'p' }),
        },
        {
          verb: 'POST /setup-intent',
          run: () =>
            request(app)
              .post('/api/v1/billing/setup-intent')
              .set('Authorization', 'Bearer user-jwt')
              .send({ entityType: 'organization', entityId: ORG }),
        },
        {
          verb: 'GET /subscriptions/:id',
          run: () =>
            request(app)
              .get('/api/v1/billing/subscriptions/sub_123')
              .query({ entityType: 'organization', organizationId: ORG })
              .set('Authorization', 'Bearer user-jwt'),
        },
        {
          verb: 'PATCH /subscriptions/:id',
          run: () =>
            request(app)
              .patch('/api/v1/billing/subscriptions/sub_123')
              .set('Authorization', 'Bearer user-jwt')
              .send({ entityType: 'organization', entityId: ORG, seatQuantity: 3 }),
        },
        {
          verb: 'DELETE /subscriptions/:id',
          run: () =>
            request(app)
              .delete('/api/v1/billing/subscriptions/sub_123')
              .query({ entityType: 'organization', organizationId: ORG })
              .set('Authorization', 'Bearer user-jwt'),
        },
      ]

      for (const c of cases) {
        it(`${c.verb} -> 403 for a non-member`, async () => {
          mockCheckOrgPermission.mockResolvedValue(false)

          const res = await c.run()

          expect(res.status).toBe(403)
          expect(res.body.code).toBe('ORG_PERMISSION_DENIED')
          // CRITICAL: the request must NEVER reach the billing-service.
          expect(mockedAxios.request).not.toHaveBeenCalled()
          // And the check was for THIS caller against THIS org.
          expect(mockCheckOrgPermission).toHaveBeenCalledWith(
            'user-1',
            expect.any(String),
            ORG
          )
        })
      }
    })

    describe('org-scoped: member/owner -> forwarded', () => {
      it('POST /subscriptions forwards with server-derived org entity + trusted headers', async () => {
        mockCheckOrgPermission.mockResolvedValue(true)
        okUpstream({ subscription: { id: 's1' }, requiresAction: false }, 201)

        const res = await request(app)
          .post('/api/v1/billing/subscriptions')
          .set('Authorization', 'Bearer user-jwt')
          // Attacker also tries to smuggle a different entityId in the body.
          .send({ entityType: 'organization', entityId: ORG, priceId: 'price_1' })

        expect(res.status).toBe(201)
        expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)

        const call = mockedAxios.request.mock.calls[0][0]
        // Body carries the AUTHORIZED org as the entity.
        expect(call.data).toEqual({
          entityType: 'organization',
          entityId: ORG,
          priceId: 'price_1',
        })
        // Trusted actor/entity context forwarded for service-side re-check.
        expect((call.headers as any)['X-Billing-Actor-User-Id']).toBe('user-1')
        expect((call.headers as any)['X-Billing-Entity-Type']).toBe('organization')
        expect((call.headers as any)['X-Billing-Entity-Id']).toBe(ORG)
        // Service-tier defence-in-depth headers (the billing-service re-verifies
        // ownership against these exact names).
        expect((call.headers as any)['X-FF-Actor-Id']).toBe('user-1')
        expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
      })

      it('PATCH /subscriptions/:id forwards (manage) without polluting the body schema', async () => {
        mockCheckOrgPermission.mockResolvedValue(true)
        okUpstream({ subscription: { stripeSubscriptionId: 'sub_123' } })

        const res = await request(app)
          .patch('/api/v1/billing/subscriptions/sub_123')
          .set('Authorization', 'Bearer user-jwt')
          .send({ entityType: 'organization', entityId: ORG, seatQuantity: 5 })

        expect(res.status).toBe(200)
        expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)

        const call = mockedAxios.request.mock.calls[0][0]
        // The :id route's upstream schema forbids entity selectors, so the body
        // must contain ONLY the update fields — entity travels via headers.
        expect(call.data).toEqual({ seatQuantity: 5 })
        expect((call.headers as any)['X-Billing-Entity-Id']).toBe(ORG)
        expect((call.headers as any)['X-Billing-Entity-Type']).toBe('organization')
      })

      it('GET /subscriptions/:id requires only read permission', async () => {
        mockCheckOrgPermission.mockResolvedValue(true)
        okUpstream({ subscription: { stripeSubscriptionId: 'sub_123' } })

        const res = await request(app)
          .get('/api/v1/billing/subscriptions/sub_123')
          .query({ entityType: 'organization', organizationId: ORG })
          .set('Authorization', 'Bearer user-jwt')

        expect(res.status).toBe(200)
        expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'read', ORG)
      })
    })

    describe('user-scoped: identity is server-derived, never client-controlled', () => {
      it('POST /subscriptions ignores a client entityId and uses the JWT user', async () => {
        okUpstream({ subscription: { id: 's1' }, requiresAction: false }, 201)

        await request(app)
          .post('/api/v1/billing/subscriptions')
          .set('Authorization', 'Bearer user-jwt')
          // Attacker tries to act as a different user.
          .send({ entityType: 'user', entityId: 'victim-user', priceId: 'p' })

        const call = mockedAxios.request.mock.calls[0][0]
        expect((call.data as any).entityId).toBe('user-1')
        expect((call.data as any).entityType).toBe('user')
        // user-scope must not invoke the org permission layer.
        expect(mockCheckOrgPermission).not.toHaveBeenCalled()
      })

      it('defaults to user-scope (self) when no entityType is declared', async () => {
        okUpstream({ subscription: { id: 's1' }, requiresAction: false }, 201)

        await request(app)
          .post('/api/v1/billing/subscriptions')
          .set('Authorization', 'Bearer user-jwt')
          .send({ priceId: 'p' })

        const call = mockedAxios.request.mock.calls[0][0]
        expect((call.data as any).entityId).toBe('user-1')
        expect((call.data as any).entityType).toBe('user')
        expect(mockCheckOrgPermission).not.toHaveBeenCalled()
      })
    })

    describe('org-scoped requires an org id; bad entityType -> 400', () => {
      it('400 when entityType=organization but no org id supplied', async () => {
        const res = await request(app)
          .post('/api/v1/billing/subscriptions')
          .set('Authorization', 'Bearer user-jwt')
          .send({ entityType: 'organization', priceId: 'p' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('ORG_ID_REQUIRED')
        expect(mockedAxios.request).not.toHaveBeenCalled()
      })

      it('400 on an invalid entityType', async () => {
        const res = await request(app)
          .post('/api/v1/billing/subscriptions')
          .set('Authorization', 'Bearer user-jwt')
          .send({ entityType: 'platform', entityId: ORG, priceId: 'p' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('INVALID_ENTITY_TYPE')
        expect(mockedAxios.request).not.toHaveBeenCalled()
      })
    })

    describe('query param allow-list (no verbatim pass-through)', () => {
      it('drops unknown query params and forwards only the allow-list', async () => {
        okUpstream({ subscription: { stripeSubscriptionId: 'sub_123' } })

        await request(app)
          .get('/api/v1/billing/subscriptions/sub_123')
          // entityType/organizationId are consumed for authz (user-scope here);
          // `evil` and `entityId` must NOT be forwarded upstream; `limit` is.
          .query({ limit: '10', evil: 'drop-me', entityId: 'victim' })
          .set('Authorization', 'Bearer user-jwt')

        const call = mockedAxios.request.mock.calls[0][0]
        expect(call.params).toEqual({ limit: '10' })
      })
    })
  })

  // -------------------------------------------------------------------------
  // POST /checkout — start a Stripe Checkout Session. Always org-scoped: the
  // caller must hold 'manage' on the target org. Asserts deny (non-member ->
  // 403, no forward) and the authorized forward (server-derived org in the
  // body, X-FF-Actor-Id / X-FF-Org-Id present, plan/url fields forwarded, and
  // the upstream { url, sessionId } relayed back).
  // -------------------------------------------------------------------------
  describe('POST /checkout', () => {
    const ORG = '22222222-2222-2222-2222-222222222222'

    it('non-member -> 403 and the request never reaches the billing-service', async () => {
      mockCheckOrgPermission.mockResolvedValue(false)

      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', 'Bearer user-jwt')
        .send({
          planId: 'plan_pro',
          organizationId: ORG,
          successUrl: 'https://app/ok',
          cancelUrl: 'https://app/no',
        })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('ORG_PERMISSION_DENIED')
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)
    })

    it('400 when no organizationId is supplied (checkout is always org-scoped)', async () => {
      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', 'Bearer user-jwt')
        .send({ planId: 'plan_pro', successUrl: 'https://app/ok', cancelUrl: 'https://app/no' })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('ORG_ID_REQUIRED')
      expect(mockedAxios.request).not.toHaveBeenCalled()
      expect(mockCheckOrgPermission).not.toHaveBeenCalled()
    })

    it('owner -> forwarded with X-FF-Actor-Id/X-FF-Org-Id + body forwarded, relays { url, sessionId }', async () => {
      mockCheckOrgPermission.mockResolvedValue(true)
      okUpstream({ url: 'https://checkout.stripe.com/c/sess_1', sessionId: 'sess_1' })

      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', 'Bearer user-jwt')
        .send({
          planId: 'plan_pro',
          organizationId: ORG,
          successUrl: 'https://app/ok',
          cancelUrl: 'https://app/no',
        })

      expect(res.status).toBe(200)
      // Upstream { url, sessionId } relayed to the browser verbatim.
      expect(res.body).toEqual({
        url: 'https://checkout.stripe.com/c/sess_1',
        sessionId: 'sess_1',
      })
      expect(mockCheckOrgPermission).toHaveBeenCalledWith('user-1', 'manage', ORG)

      const call = mockedAxios.request.mock.calls[0][0]
      expect(call.method).toBe('POST')
      expect(call.url).toBe('http://billing.test:3006/api/v1/billing/checkout')
      expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
      // Body: plan + url fields forwarded; organizationId is SERVER-DERIVED to
      // the authorized org (entityType/entityId selectors are not used here).
      expect(call.data).toEqual({
        planId: 'plan_pro',
        organizationId: ORG,
        successUrl: 'https://app/ok',
        cancelUrl: 'https://app/no',
      })
      // Service-tier defence-in-depth headers present and authoritative.
      expect((call.headers as any)['X-FF-Actor-Id']).toBe('user-1')
      expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
    })

    it('overrides a client-smuggled organizationId with the authorized org', async () => {
      mockCheckOrgPermission.mockResolvedValue(true)
      okUpstream({ url: 'https://checkout.stripe.com/c/sess_2', sessionId: 'sess_2' })

      // Client authorizes against ORG (via the route body) but tries to smuggle
      // a victim org. authorizeCheckout reads organizationId for the authz, and
      // the forwarded body must carry exactly the authorized org id.
      await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', 'Bearer user-jwt')
        .send({ planId: 'plan_pro', organizationId: ORG, successUrl: 'u', cancelUrl: 'c' })

      const call = mockedAxios.request.mock.calls[0][0]
      expect((call.data as any).organizationId).toBe(ORG)
      expect((call.headers as any)['X-FF-Org-Id']).toBe(ORG)
    })
  })
})
