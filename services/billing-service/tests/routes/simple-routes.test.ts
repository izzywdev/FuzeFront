import express from 'express';
import request from 'supertest';
import { createPlansRouter } from '../../src/routes/plans';
import { createSetupIntentRouter } from '../../src/routes/setup-intent';
import { createCreditsRouter } from '../../src/routes/credits';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('GET /plans', () => {
  function app(plans: any) {
    const a = express();
    a.use(express.json());
    a.use('/api/v1/billing', createPlansRouter(plans));
    return a;
  }

  it('returns the active plans list', async () => {
    const plans = { getActivePlans: jest.fn().mockResolvedValue([{ tierName: 'pro' }]) };
    const res = await request(app(plans)).get('/api/v1/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([{ tierName: 'pro' }]);
  });

  it('returns 500 when the plan service throws', async () => {
    const plans = { getActivePlans: jest.fn().mockRejectedValue(new Error('boom')) };
    const res = await request(app(plans)).get('/api/v1/billing/plans');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /setup-intent', () => {
  function app(stripe: any, customers: any) {
    const a = express();
    a.use(express.json());
    a.use('/api/v1/billing', createSetupIntentRouter(stripe, customers));
    return a;
  }

  const customers = {
    ensureCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }),
  };

  it('400s on an invalid body', async () => {
    const res = await request(app({ setupIntents: { create: jest.fn() } }, customers))
      .post('/api/v1/billing/setup-intent')
      .send({ entityType: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns the client secret on success', async () => {
    const stripe = {
      setupIntents: { create: jest.fn().mockResolvedValue({ client_secret: 'seti_secret_1' }) },
    };
    const res = await request(app(stripe, customers))
      .post('/api/v1/billing/setup-intent')
      .send({ entityType: 'user', entityId: VALID_UUID });
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('seti_secret_1');
  });

  it('502s when Stripe throws', async () => {
    const stripe = {
      setupIntents: { create: jest.fn().mockRejectedValue(new Error('stripe down')) },
    };
    const res = await request(app(stripe, customers))
      .post('/api/v1/billing/setup-intent')
      .send({ entityType: 'user', entityId: VALID_UUID });
    expect(res.status).toBe(502);
  });
});

describe('POST /credits', () => {
  function app(stripe: any, customers: any) {
    const a = express();
    a.use(express.json());
    a.use('/api/v1/billing', createCreditsRouter(stripe, customers));
    return a;
  }

  const customers = {
    ensureCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }),
  };

  it('400s on an invalid body', async () => {
    const res = await request(app({ customers: {} }, customers))
      .post('/api/v1/billing/credits')
      .send({ entityType: 'user', entityId: VALID_UUID }); // missing amount
    expect(res.status).toBe(400);
  });

  it('credits the customer (flips sign) and returns the txn id + balance', async () => {
    const createBalanceTransaction = jest
      .fn()
      .mockResolvedValue({ id: 'cbtxn_1', ending_balance: -500 });
    const stripe = { customers: { createBalanceTransaction } };
    const res = await request(app(stripe, customers))
      .post('/api/v1/billing/credits')
      .send({ entityType: 'organization', entityId: VALID_UUID, amount: 500, note: 'goodwill' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'cbtxn_1', endingBalance: -500 });
    // positive amount -> negative balance adjustment (a credit).
    expect(createBalanceTransaction).toHaveBeenCalledWith(
      'cus_1',
      expect.objectContaining({ amount: -500, currency: 'usd', description: 'goodwill' }),
    );
  });

  it('502s when Stripe throws', async () => {
    const stripe = {
      customers: { createBalanceTransaction: jest.fn().mockRejectedValue(new Error('x')) },
    };
    const res = await request(app(stripe, customers))
      .post('/api/v1/billing/credits')
      .send({ entityType: 'user', entityId: VALID_UUID, amount: 100 });
    expect(res.status).toBe(502);
  });
});
