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
//   * upstream unreachability surfaces as 502.

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

  it('POST /subscriptions forwards the JSON body + internal token', async () => {
    okUpstream({ subscription: { id: 's1' }, requiresAction: false }, 201)

    const payload = { entityType: 'user', entityId: 'abc', priceId: 'price_1' }
    const res = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', 'Bearer user-jwt')
      .send(payload)

    expect(res.status).toBe(201)
    const call = mockedAxios.request.mock.calls[0][0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe('http://billing.test:3006/api/v1/billing/subscriptions')
    expect(call.data).toEqual(payload)
    expect((call.headers as any).Authorization).toBe('Bearer test-internal-token')
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
})
