/**
 * Unit/route tests for the one-time payment-mode Checkout slice:
 *   POST /api/v1/billing/payments/checkout
 *   GET  /api/v1/billing/payments/sessions/:sessionId
 *
 * Drives the REAL createApp wiring via supertest with mocked deps (Stripe never
 * hit). Asserts: a payment-mode session is created from price_data line items
 * with product metadata + client_reference_id; the CRITICAL-2 entity re-check;
 * the productKey/currency allowlists and cent bounds; param-fingerprint
 * idempotency-key stability; the pending mirror write; and the session GET
 * (mirror row, ownership 403, 404, live-Stripe fallback).
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  actorOrgHeaders,
  INTERNAL_TOKEN,
  ORG_ID,
  OTHER_ORG_ID,
  USER_ID,
} from '../contract/helpers';
import { paymentCheckoutIdempotencyKey } from '../../src/routes/payments';

const URL = '/api/v1/billing/payments/checkout';
const SESSION_URL = (id: string) => `/api/v1/billing/payments/sessions/${id}`;

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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    productKey: 'mendys-datasets',
    externalOrderId: 'order-42',
    entityType: 'organization',
    entityId: ORG_ID,
    currency: 'usd',
    lineItems: [
      { name: 'Recording hours', description: '4h on-site', unitAmountCents: 15000, quantity: 4 },
      { name: 'LIDAR rig rental', unitAmountCents: 25000, quantity: 1 },
    ],
    successUrl: 'https://marketplace.mendysrobotics.com/orders/order-42/success',
    cancelUrl: 'https://marketplace.mendysrobotics.com/orders/order-42/cancel',
    ...overrides,
  };
}

function mirrorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    stripeSessionId: 'cs_test_session',
    stripePaymentIntentId: null,
    productKey: 'mendys-datasets',
    externalOrderId: 'order-42',
    entityType: 'organization',
    entityId: ORG_ID,
    amountTotalCents: 85000,
    currency: 'usd',
    status: 'pending',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('POST /payments/checkout — one-time payment-mode Checkout Session', () => {
  it('200 {sessionId, url}; creates a payment-mode session from price_data line items', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });

    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionId: 'cs_test_session',
      url: 'https://checkout.stripe.com/c/pay/cs_test_session',
    });

    expect(stubs.customers.ensureCustomer).toHaveBeenCalledWith('organization', ORG_ID);
    const arg = stubs.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_org_1',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Recording hours', description: '4h on-site' },
              unit_amount: 15000,
            },
            quantity: 4,
          },
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'LIDAR rig rental' },
              unit_amount: 25000,
            },
            quantity: 1,
          },
        ],
        success_url: 'https://marketplace.mendysrobotics.com/orders/order-42/success',
        cancel_url: 'https://marketplace.mendysrobotics.com/orders/order-42/cancel',
        metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
        payment_intent_data: {
          metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
        },
        client_reference_id: 'order-42',
      }),
    );
    // Idempotency key supplied (second positional arg).
    const opts = stubs.stripe.checkout.sessions.create.mock.calls[0][1];
    expect(opts).toEqual(expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('mirrors the session as a pending billing.payments row', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });

    await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());

    expect(stubs.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: 'cs_test_session',
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        entityType: 'organization',
        entityId: ORG_ID,
        amountTotalCents: 85000, // 4×15000 + 1×25000 (session has no amount_total)
        currency: 'usd',
        status: 'pending',
      }),
    );
  });

  it('still 200s when the pending mirror write fails (webhook/GET fallback converge later)', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });
    stubs.payments.upsert.mockRejectedValue(new Error('db down'));

    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('cs_test_session');
  });

  // Same BUG-1 scheme as /checkout: identical params -> identical key (dedupe
  // double-clicks); ANY changed param -> different key (no 24h poisoning).
  it('idempotency key: identical params -> SAME key; changed param -> DIFFERENT key', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
    });

    const post = (body: Record<string, unknown>) =>
      request(app)
        .post(URL)
        .set(...authHeader())
        .set(actorOrgHeaders(ORG_ID, USER_ID))
        .send(body);

    await post(validBody());
    await post(validBody()); // identical
    await post(validBody({ externalOrderId: 'order-43' }));
    await post(
      validBody({
        lineItems: [{ name: 'Recording hours', unitAmountCents: 15000, quantity: 5 }],
      }),
    );

    const keyOf = (i: number) =>
      stubs.stripe.checkout.sessions.create.mock.calls[i][1].idempotencyKey as string;

    expect(keyOf(0)).toBe(keyOf(1)); // true retry -> same key
    expect(keyOf(2)).not.toBe(keyOf(0)); // changed order id -> new key
    expect(keyOf(3)).not.toBe(keyOf(0)); // changed line items -> new key
    expect(keyOf(0)).toMatch(/^payment-checkout-mendys-datasets-/); // readable prefix
  });

  it('idempotency key function is deterministic and param-sensitive (pure)', () => {
    const parts = {
      actorUserId: USER_ID,
      productKey: 'mendys-datasets',
      externalOrderId: 'order-42',
      entityType: 'organization',
      entityId: ORG_ID,
      currency: 'usd',
      lineItems: [{ name: 'A', unitAmountCents: 100, quantity: 1 }],
      successUrl: 'https://a/s',
      cancelUrl: 'https://a/c',
    };
    expect(paymentCheckoutIdempotencyKey(parts)).toBe(paymentCheckoutIdempotencyKey({ ...parts }));
    expect(paymentCheckoutIdempotencyKey({ ...parts, currency: 'eur' })).not.toBe(
      paymentCheckoutIdempotencyKey(parts),
    );
  });

  it('401 when the internal token is missing', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app).post(URL).set(actorOrgHeaders(ORG_ID)).send(validBody());
    expect(res.status).toBe(401);
  });

  it('401 when the proxy actor-context headers are absent (CRITICAL-2)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader()) // valid token but NO actor headers
      .send(validBody());
    expect(res.status).toBe(401);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('403 when the body entity does not match the proxy-authorized entity (CRITICAL-2 / IDOR)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      // proxy authorized OTHER_ORG_ID, but the body targets ORG_ID
      .set(actorOrgHeaders(OTHER_ORG_ID, USER_ID))
      .send(validBody());
    expect(res.status).toBe(403);
    expect(stubs.customers.ensureCustomer).not.toHaveBeenCalled();
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('403 when the body entityType differs from the authorized one', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID)) // authorized as organization ORG_ID
      .send(validBody({ entityType: 'user', entityId: USER_ID }));
    expect(res.status).toBe(403);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 when productKey is not allowlisted', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody({ productKey: 'evil-product' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid productKey');
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 for every product when the allowlist is empty (fail closed / merge dark)', async () => {
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerStub() },
      paymentsConfig: { productKeys: [], currencies: ['usd', 'eur'], maxTotalCents: 5_000_000 },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());
    expect(res.status).toBe(400);
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 when the currency is not allowlisted', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody({ currency: 'jpy' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid currency');
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('accepts an uppercase currency (lowercased server-side)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody({ currency: 'EUR' }));
    expect(res.status).toBe(200);
    const arg = stubs.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.line_items[0].price_data.currency).toBe('eur');
  });

  it('400 when a single line exceeds the cent cap', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody({ lineItems: [{ name: 'Huge', unitAmountCents: 5_000_001, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount out of bounds');
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('400 when the order TOTAL exceeds the cent cap even though each line is under it', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(
        validBody({
          lineItems: [
            { name: 'A', unitAmountCents: 3_000_000, quantity: 1 },
            { name: 'B', unitAmountCents: 3_000_000, quantity: 1 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount out of bounds');
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing successUrl', validBody({ successUrl: undefined })],
    ['empty lineItems', validBody({ lineItems: [] })],
    ['zero unitAmountCents', validBody({ lineItems: [{ name: 'X', unitAmountCents: 0, quantity: 1 }] })],
    ['fractional unitAmountCents', validBody({ lineItems: [{ name: 'X', unitAmountCents: 10.5, quantity: 1 }] })],
    ['zero quantity', validBody({ lineItems: [{ name: 'X', unitAmountCents: 100, quantity: 0 }] })],
    ['non-uuid entityId', validBody({ entityId: 'not-a-uuid' })],
    ['bad entityType', validBody({ entityType: 'team' })],
    ['4-char currency', validBody({ currency: 'usdd' })],
  ])('400 on a malformed body (%s)', async (_label, body) => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid request');
    expect(stubs.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('502 when Stripe throws an unknown/upstream error creating the session', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN, stubs: { ...orgCustomerStub() } });
    stubs.stripe.checkout.sessions.create.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());
    expect(res.status).toBe(502);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String), code: expect.any(String), message: expect.any(String) }),
    );
  });

  it('409 when Stripe raises an idempotency_error (BUG 2 classification)', async () => {
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
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send(validBody());
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ code: 'idempotency_error' }));
  });
});

describe('GET /payments/sessions/:sessionId — reconciliation polling', () => {
  it('200 {payment} when the mirror row exists and belongs to the authorized entity', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.payments.getBySessionId.mockResolvedValue(mirrorRow({ status: 'paid' }));

    const res = await request(app)
      .get(SESSION_URL('cs_test_session'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(res.body.payment).toEqual(
      expect.objectContaining({
        stripeSessionId: 'cs_test_session',
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        status: 'paid',
      }),
    );
    expect(stubs.payments.getBySessionId).toHaveBeenCalledWith('cs_test_session');
  });

  it('403 when the mirror row belongs to a different entity (IDOR)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.payments.getBySessionId.mockResolvedValue(mirrorRow({ entityId: OTHER_ORG_ID }));

    const res = await request(app)
      .get(SESSION_URL('cs_test_session'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(403);
    expect(res.body.payment).toBeUndefined();
  });

  it('401 without actor-context headers', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .get(SESSION_URL('cs_test_session'))
      .set(...authHeader());
    expect(res.status).toBe(401);
  });

  it('404 when neither the mirror row nor the Stripe session exists', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .get(SESSION_URL('cs_unknown'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(404);
  });

  it('live-Stripe fallback: re-mirrors and returns an allowlisted session owned by the caller', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.payments.getBySessionId.mockResolvedValue(null);
    stubs.customerRepo.findByStripeCustomerId.mockResolvedValue({
      id: 'localcust_1',
      entityType: 'organization',
      entityId: ORG_ID,
      stripeCustomerId: 'cus_org_1',
    });
    stubs.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_live_9',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_org_1',
      payment_intent: 'pi_9',
      amount_total: 85000,
      currency: 'usd',
      client_reference_id: 'order-42',
      metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
    });

    const res = await request(app)
      .get(SESSION_URL('cs_live_9'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(stubs.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: 'cs_live_9',
        stripePaymentIntentId: 'pi_9',
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        entityType: 'organization',
        entityId: ORG_ID,
        amountTotalCents: 85000,
        currency: 'usd',
        status: 'paid',
      }),
    );
    expect(res.body.payment).toEqual(expect.objectContaining({ stripeSessionId: 'cs_live_9' }));
  });

  it('fallback 404s a live session whose productKey is NOT allowlisted', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_live_10',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_org_1',
      metadata: { productKey: 'unknown-product', externalOrderId: 'x' },
    });

    const res = await request(app)
      .get(SESSION_URL('cs_live_10'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(404);
    expect(stubs.payments.upsert).not.toHaveBeenCalled();
  });

  it('fallback 403s a live session owned by a different entity', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.customerRepo.findByStripeCustomerId.mockResolvedValue({
      id: 'localcust_2',
      entityType: 'organization',
      entityId: OTHER_ORG_ID,
      stripeCustomerId: 'cus_other',
    });
    stubs.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_live_11',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_other',
      metadata: { productKey: 'mendys-datasets', externalOrderId: 'x' },
    });

    const res = await request(app)
      .get(SESSION_URL('cs_live_11'))
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(403);
    expect(stubs.payments.upsert).not.toHaveBeenCalled();
  });
});
