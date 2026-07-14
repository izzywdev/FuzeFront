/**
 * Billing-service API contract tests vs services/billing-service/openapi.yaml.
 *
 * INDEPENDENT verification: drives the real `createApp(deps)` router wiring via
 * supertest with mocked deps. Asserts status codes, required fields, and exact
 * response shapes (additionalProperties:false) for every operation in the spec.
 *
 * Stripe is mocked — NEVER hits live Stripe. Basic price: price_1TnCqVDaNn3aKLEz05TbFbFQ.
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  adminHeader,
  makeSubscription,
  makeBasicPlan,
  BASIC_PRICE_ID,
  INTERNAL_TOKEN,
  USER_ID,
  ORG_ID,
} from './helpers';
import {
  assertPlan,
  assertBillingSubscription,
  assertCreateSubscriptionResponse,
  assertSubscriptionWrapper,
  assertValidationErrorBody,
  assertStripeErrorBody,
  assertErrorBody,
} from './schema-assertions';

const BASE = '/api/v1/billing';

describe('billing-service contract :: getHealth (GET /health)', () => {
  it('200 {status, service} at the bare root (NOT under /api/v1/billing)', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'billing-service' });
    // Contract NOTE: health is mounted at root, not under /api/v1/billing.
    const underBase = await request(app).get(`${BASE}/health`);
    expect(underBase.status).toBe(404);
  });
});

describe('billing-service contract :: getPlans (GET /plans)', () => {
  it('200 {plans: Plan[]} — public, no auth required', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).get(`${BASE}/plans`); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plans');
    expect(Object.keys(res.body)).toEqual(['plans']); // additionalProperties:false
    expect(Array.isArray(res.body.plans)).toBe(true);
    res.body.plans.forEach(assertPlan);
  });

  it('the Basic $9/mo plan is contract-shaped', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        plans: {
          getActivePlans: jest
            .fn()
            .mockResolvedValue([makeBasicPlan({ unitAmount: 900, currency: 'usd', displayName: 'Basic' })]),
        },
      },
    });
    const res = await request(app).get(`${BASE}/plans`);
    expect(res.status).toBe(200);
    const basic = res.body.plans.find((p: any) => p.priceId === BASIC_PRICE_ID);
    expect(basic).toBeDefined();
    expect(basic.unitAmount).toBe(900);
    expect(basic.currency).toBe('usd');
  });

  it('500 {error} (InternalError) when the plan cache load fails', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { plans: { getActivePlans: jest.fn().mockRejectedValue(new Error('db down')) } },
    });
    const res = await request(app).get(`${BASE}/plans`);
    expect(res.status).toBe(500);
    assertErrorBody(res.body);
  });
});

describe('billing-service contract :: createSubscription (POST /subscriptions)', () => {
  it('201 CreateSubscriptionResponse on success', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.create.mockResolvedValue({
      subscription: makeSubscription(),
      clientSecret: 'pi_secret_abc',
      requiresAction: true,
    });
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: USER_ID, priceId: BASIC_PRICE_ID });
    expect(res.status).toBe(201); // spec: 201, not 200
    assertCreateSubscriptionResponse(res.body);
  });

  it('400 ValidationError on bad body (missing priceId)', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: USER_ID });
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('400 ValidationError when entityId is not a uuid', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: 'not-a-uuid', priceId: BASIC_PRICE_ID });
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('401 Unauthorized when the internal token is missing', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .send({ entityType: 'user', entityId: USER_ID, priceId: BASIC_PRICE_ID });
    expect(res.status).toBe(401);
    assertErrorBody(res.body);
  });

  it('401 Unauthorized when the internal token is wrong', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .set('Authorization', 'Bearer wrong-token')
      .send({ entityType: 'user', entityId: USER_ID, priceId: BASIC_PRICE_ID });
    expect(res.status).toBe(401);
  });

  it('502 StripeError when Stripe throws', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.create.mockRejectedValue(new Error('card_declined'));
    const res = await request(app)
      .post(`${BASE}/subscriptions`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: USER_ID, priceId: BASIC_PRICE_ID });
    expect(res.status).toBe(502);
    assertStripeErrorBody(res.body);
  });
});

describe('billing-service contract :: getSubscription (GET /subscriptions/{id})', () => {
  it('200 {subscription} when the mirror exists', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionRepo.findByStripeId.mockResolvedValue(makeSubscription());
    const res = await request(app)
      .get(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader());
    expect(res.status).toBe(200);
    assertSubscriptionWrapper(res.body);
  });

  it('404 NotFound when no mirror exists', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionRepo.findByStripeId.mockResolvedValue(null);
    const res = await request(app)
      .get(`${BASE}/subscriptions/sub_missing`)
      .set(...authHeader());
    expect(res.status).toBe(404);
    assertErrorBody(res.body);
  });

  it('401 Unauthorized without token', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).get(`${BASE}/subscriptions/sub_test123`);
    expect(res.status).toBe(401);
  });
});

describe('billing-service contract :: updateSubscription (PATCH /subscriptions/{id})', () => {
  it('200 {subscription} on a valid plan change', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.update.mockResolvedValue(makeSubscription({ priceId: 'price_pro' }));
    const res = await request(app)
      .patch(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader())
      .send({ priceId: 'price_pro' });
    expect(res.status).toBe(200);
    assertSubscriptionWrapper(res.body);
  });

  it('200 on a seat-quantity-only change', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.update.mockResolvedValue(makeSubscription({ seatQuantity: 5 }));
    const res = await request(app)
      .patch(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader())
      .send({ seatQuantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.subscription.seatQuantity).toBe(5);
  });

  it('CONTRACT GAP: empty body {} should be 400 (UpdateSubscriptionRequest.minProperties:1)', async () => {
    // openapi.yaml declares UpdateSubscriptionRequest.minProperties: 1, so PATCH {}
    // must be rejected with 400. The Zod updateSchema has no non-empty refinement,
    // so this is expected to FAIL against the implementation — a real contract gap,
    // not a test bug. (See findings in the done report.)
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .patch(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader())
      .send({});
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('400 ValidationError when seatQuantity is not a positive int', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .patch(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader())
      .send({ seatQuantity: -3 });
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('502 StripeError when Stripe throws on update', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.update.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .patch(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader())
      .send({ priceId: 'price_pro' });
    expect(res.status).toBe(502);
    assertStripeErrorBody(res.body);
  });

  it('401 Unauthorized without token', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).patch(`${BASE}/subscriptions/sub_test123`).send({ priceId: 'price_pro' });
    expect(res.status).toBe(401);
  });
});

describe('billing-service contract :: cancelSubscription (DELETE /subscriptions/{id})', () => {
  it('200 {subscription} with cancellation scheduled', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.cancel.mockResolvedValue(makeSubscription({ cancelAtPeriodEnd: true }));
    const res = await request(app)
      .delete(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader());
    expect(res.status).toBe(200);
    assertSubscriptionWrapper(res.body);
    expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('502 StripeError when Stripe throws on cancel', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.subscriptionService.cancel.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .delete(`${BASE}/subscriptions/sub_test123`)
      .set(...authHeader());
    expect(res.status).toBe(502);
    assertStripeErrorBody(res.body);
  });

  it('401 Unauthorized without token', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).delete(`${BASE}/subscriptions/sub_test123`);
    expect(res.status).toBe(401);
  });
});

describe('billing-service contract :: createSetupIntent (POST /setup-intent)', () => {
  it('200 {clientSecret} on success', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.setupIntents.create.mockResolvedValue({ client_secret: 'seti_secret_xyz' });
    const res = await request(app)
      .post(`${BASE}/setup-intent`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: USER_ID });
    expect(res.status).toBe(200); // spec: 200, not 201
    expect(Object.keys(res.body)).toEqual(['clientSecret']); // additionalProperties:false
    expect(typeof res.body.clientSecret).toBe('string');
  });

  it('400 ValidationError when entityId is not a uuid', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/setup-intent`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: 'nope' });
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('502 StripeError when Stripe throws', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.setupIntents.create.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .post(`${BASE}/setup-intent`)
      .set(...authHeader())
      .send({ entityType: 'user', entityId: USER_ID });
    expect(res.status).toBe(502);
    assertStripeErrorBody(res.body);
  });

  it('401 Unauthorized without token', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).post(`${BASE}/setup-intent`).send({ entityType: 'user', entityId: USER_ID });
    expect(res.status).toBe(401);
  });
});

describe('billing-service contract :: addCredits (POST /credits)', () => {
  it('201 {id, endingBalance} on success', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.customers.createBalanceTransaction.mockResolvedValue({
      id: 'cbtxn_1',
      ending_balance: -500,
    });
    const res = await request(app)
      .post(`${BASE}/credits`)
      .set(...authHeader())
      .set(adminHeader())
      .send({ entityType: 'organization', entityId: ORG_ID, amount: 500, note: 'goodwill' });
    expect(res.status).toBe(201); // spec: 201
    expect(Object.keys(res.body).sort()).toEqual(['endingBalance', 'id']);
    expect(typeof res.body.id).toBe('string');
    expect(Number.isInteger(res.body.endingBalance)).toBe(true);
  });

  it('flips the sign: positive amount credits the customer (amount -> -amount, currency usd)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.customers.createBalanceTransaction.mockResolvedValue({ id: 'cbtxn_2', ending_balance: -500 });
    await request(app)
      .post(`${BASE}/credits`)
      .set(...authHeader())
      .set(adminHeader())
      .send({ entityType: 'organization', entityId: ORG_ID, amount: 500 });
    expect(stubs.stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_test123',
      expect.objectContaining({ amount: -500, currency: 'usd' }),
    );
  });

  it('400 ValidationError when amount is missing', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/credits`)
      .set(...authHeader())
      .set(adminHeader())
      .send({ entityType: 'organization', entityId: ORG_ID });
    expect(res.status).toBe(400);
    assertValidationErrorBody(res.body);
  });

  it('502 StripeError when Stripe throws', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.stripe.customers.createBalanceTransaction.mockRejectedValue(new Error('stripe boom'));
    const res = await request(app)
      .post(`${BASE}/credits`)
      .set(...authHeader())
      .set(adminHeader())
      .send({ entityType: 'organization', entityId: ORG_ID, amount: 500 });
    expect(res.status).toBe(502);
    assertStripeErrorBody(res.body);
  });

  it('401 Unauthorized without token', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app).post(`${BASE}/credits`).send({ entityType: 'organization', entityId: ORG_ID, amount: 500 });
    expect(res.status).toBe(401);
  });

  it('403 Forbidden with a valid token but WITHOUT admin context (HIGH-1)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(`${BASE}/credits`)
      .set(...authHeader()) // valid internal token, but no X-Billing-Actor-Is-Admin
      .send({ entityType: 'organization', entityId: ORG_ID, amount: 500 });
    expect(res.status).toBe(403);
    expect(typeof res.body.error).toBe('string');
    // Must NOT have touched Stripe.
    expect(stubs.stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });
});
