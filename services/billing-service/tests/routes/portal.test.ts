/**
 * Unit/route tests for POST /api/v1/billing/portal (Stripe Customer Portal).
 *
 * Drives the REAL createApp wiring via supertest with mocked deps (Stripe never
 * hit). Asserts: happy path returns the portal url; no customer -> 409; bad /
 * absent returnUrl -> 400; missing actor context -> 401.
 *
 * As in invoices.test.ts we supply a FULL stripe stub (buildApp shallow-merges
 * opts.stubs.stripe over its default, replacing the whole key) including
 * billingPortal.sessions.create plus the pre-existing sub-resources.
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  actorOrgHeaders,
  INTERNAL_TOKEN,
  ORG_ID,
  USER_ID,
} from '../contract/helpers';

const URL = '/api/v1/billing/portal';

function stripeStub(createImpl?: jest.Mock) {
  const constructEvent = jest.fn();
  return {
    stripe: {
      setupIntents: { create: jest.fn() },
      customers: { createBalanceTransaction: jest.fn() },
      checkout: { sessions: { create: jest.fn() } },
      billingPortal: {
        sessions: {
          create:
            createImpl ??
            jest.fn().mockResolvedValue({
              id: 'bps_1',
              url: 'https://billing.stripe.com/p/session/bps_1',
            }),
        },
      },
      invoices: { list: jest.fn() },
      webhooks: { constructEvent },
    },
  } as any;
}

function orgCustomerRepoStub(stripeCustomerId = 'cus_org_1') {
  return {
    customerRepo: {
      findByEntity: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId,
      }),
      findByStripeCustomerId: jest.fn().mockResolvedValue(null),
      insert: jest.fn(),
    },
  } as any;
}

const RETURN_URL = 'https://app.fuzefront.com/billing';

describe('POST /portal — Stripe Customer Portal session', () => {
  it('200 {url} on the happy path; creates the session for the resolved customer', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'bps_1',
      url: 'https://billing.stripe.com/p/session/bps_1',
    });
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(create), ...orgCustomerRepoStub() },
    });

    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({ returnUrl: RETURN_URL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://billing.stripe.com/p/session/bps_1' });
    expect(stubs.customerRepo.findByEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(create).toHaveBeenCalledWith({ customer: 'cus_org_1', return_url: RETURN_URL });
  });

  it('409 when the entity has no billing customer', async () => {
    const create = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      // default customerRepo.findByEntity -> null
      stubs: { ...stripeStub(create) },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({ returnUrl: RETURN_URL });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({ error: 'no billing customer', message: expect.any(String) }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('400 when returnUrl is absent', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid request');
  });

  it('400 when returnUrl is not a valid url', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({ returnUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('401 when the proxy actor-context headers are absent', async () => {
    const create = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(create), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader()) // valid token, NO actor headers
      .send({ returnUrl: RETURN_URL });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('401 when the internal token is missing', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({ returnUrl: RETURN_URL });
    expect(res.status).toBe(401);
  });

  it('maps a Stripe error (502 on an unknown/upstream throw)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('stripe boom'));
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(create), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .post(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID))
      .send({ returnUrl: RETURN_URL });
    expect(res.status).toBe(502);
  });
});
