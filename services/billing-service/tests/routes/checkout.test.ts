/**
 * Unit/route tests for POST /api/v1/billing/checkout (hosted Stripe Checkout).
 *
 * Drives the REAL createApp wiring via supertest with mocked deps (Stripe never
 * hit). Asserts: a Checkout Session is created for the right price + customer in
 * subscription mode; the CRITICAL-2 org↔entity re-check (mismatch/missing actor
 * context); plan validation (MEDIUM-1); and the {url, sessionId} response.
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  actorOrgHeaders,
  BASIC_PRICE_ID,
  INTERNAL_TOKEN,
  ORG_ID,
  OTHER_ORG_ID,
  USER_ID,
} from '../contract/helpers';

const URL = '/api/v1/billing/checkout';

function orgCustomerStub() {
  return {
    customers: {
      ensureCustomer: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId: 'cus_org_1',
      }),
    },
  };
}

describe('POST /checkout — hosted Stripe Checkout Session', () => {
  it('200 {url, sessionId}; creates a subscription-mode session for the resolved price + customer', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });

    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({
        planId: 'basic',
        organizationId: ORG_ID,
        successUrl: 'https://app.fuzefront.com/billing/success',
        cancelUrl: 'https://app.fuzefront.com/billing/cancel',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_session',
      sessionId: 'cs_test_session',
    });

    expect(stubs.customers.ensureCustomer).toHaveBeenCalledWith('organization', ORG_ID);
    const arg = stubs.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_org_1',
        line_items: [{ price: BASIC_PRICE_ID, quantity: 1 }],
        success_url: 'https://app.fuzefront.com/billing/success',
        cancel_url: 'https://app.fuzefront.com/billing/cancel',
        subscription_data: { metadata: { organizationId: ORG_ID } },
      }),
    );
    // Idempotency key supplied (second positional arg).
    const opts = stubs.stripe.checkout.sessions.create.mock.calls[0][1];
    expect(opts).toEqual(expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('401 when the internal token is missing', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(actorOrgHeaders(ORG_ID))
      .send({ planId: 'basic', organizationId: ORG_ID, successUrl: 'https://a/s', cancelUrl: 'https://a/c' });
    expect(res.status).toBe(401);
  });

  it('401 when the proxy actor-context headers are absent (CRITICAL-2)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader()) // valid token but NO actor headers
      .send({
        planId: 'basic',
        organizationId: ORG_ID,
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      });
    expect(res.status).toBe(401);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('403 when organizationId does not match the proxy-authorized org (CRITICAL-2 / IDOR)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      // proxy authorized OTHER_ORG_ID, but the body targets ORG_ID
      .set(actorOrgHeaders(OTHER_ORG_ID, USER_ID))
      .send({
        planId: 'basic',
        organizationId: ORG_ID,
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      });
    expect(res.status).toBe(403);
    expect(stubs.customers.ensureCustomer).not.toHaveBeenCalled();
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('403 when the authorized entity is a user (not an organization)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set({
        'X-Billing-Actor-User-Id': USER_ID,
        'X-Billing-Entity-Type': 'user',
        'X-Billing-Entity-Id': USER_ID,
      })
      .send({
        planId: 'basic',
        organizationId: ORG_ID,
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      });
    expect(res.status).toBe(403);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 when planId is unknown / not in the active catalogue (MEDIUM-1)', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({
        planId: 'price_attacker_controlled',
        organizationId: ORG_ID,
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      });
    expect(res.status).toBe(400);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 on a malformed body (missing successUrl)', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({ planId: 'basic', organizationId: ORG_ID, cancelUrl: 'https://a/c' });
    expect(res.status).toBe(400);
  });

  it('502 when Stripe throws creating the session', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    stubs.stripe.checkout.sessions.create.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({
        planId: 'basic',
        organizationId: ORG_ID,
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      });
    expect(res.status).toBe(502);
  });
});
