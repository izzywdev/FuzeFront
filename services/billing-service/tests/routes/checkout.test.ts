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

  // BUG 1: the idempotency key must be a deterministic function of the request
  // params. Identical requests -> identical key (dedupe double-clicks); a changed
  // successUrl -> a DIFFERENT key (no Stripe "same parameters" 24h poisoning).
  async function postCheckout(app: any, body: Record<string, unknown>) {
    return request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(body);
  }

  it('idempotency key: identical params -> SAME key; changed successUrl -> DIFFERENT key (BUG 1)', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });

    const base = {
      planId: 'basic',
      organizationId: ORG_ID,
      successUrl: 'https://app.fuzefront.com/billing/success',
      cancelUrl: 'https://app.fuzefront.com/billing/cancel',
    };

    await postCheckout(app, base);
    await postCheckout(app, { ...base }); // identical
    await postCheckout(app, { ...base, successUrl: 'https://app.fuzefront.com/billing/done' });

    const keyOf = (i: number) =>
      stubs.stripe.checkout.sessions.create.mock.calls[i][1].idempotencyKey as string;

    const k0 = keyOf(0);
    const k1 = keyOf(1);
    const k2 = keyOf(2);

    expect(k0).toBe(k1); // identical params -> same key (true retry / dedupe)
    expect(k2).not.toBe(k0); // changed successUrl -> new key
    expect(k0).toMatch(/^checkout-/); // human-readable prefix retained
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

  it('502 when Stripe throws an unknown/upstream error creating the session', async () => {
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
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String), code: expect.any(String), message: expect.any(String) }),
    );
  });

  // BUG 2: an idempotency-key conflict (reuse with different params) is a
  // CLIENT/caller problem, not an upstream failure -> 409, NOT 502.
  it('409 when Stripe raises an idempotency_error (BUG 2)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    stubs.stripe.checkout.sessions.create.mockRejectedValue(
      Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
        type: 'StripeIdempotencyError',
        code: 'idempotency_error',
        statusCode: 400,
      }),
    );
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({ planId: 'basic', organizationId: ORG_ID, successUrl: 'https://a/s', cancelUrl: 'https://a/c' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'idempotency_error', message: expect.stringContaining('same parameters') }),
    );
  });

  // BUG 2: a StripeInvalidRequestError / 4xx is a client error -> forward the
  // Stripe statusCode (here 400), NOT a blanket 502.
  it('400 when Stripe raises a StripeInvalidRequestError (BUG 2)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    stubs.stripe.checkout.sessions.create.mockRejectedValue(
      Object.assign(new Error('No such price'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 400,
      }),
    );
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({ planId: 'basic', organizationId: ORG_ID, successUrl: 'https://a/s', cancelUrl: 'https://a/c' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ code: 'resource_missing' }));
  });

  // BUG 2: a card decline (402) forwards faithfully rather than collapsing to 502.
  it('402 when Stripe raises a StripeCardError (BUG 2)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    stubs.stripe.checkout.sessions.create.mockRejectedValue(
      Object.assign(new Error('Your card was declined'), {
        type: 'StripeCardError',
        code: 'card_declined',
        statusCode: 402,
      }),
    );
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID))
      .send({ planId: 'basic', organizationId: ORG_ID, successUrl: 'https://a/s', cancelUrl: 'https://a/c' });
    expect(res.status).toBe(402);
    expect(res.body).toEqual(expect.objectContaining({ code: 'card_declined' }));
  });
});
