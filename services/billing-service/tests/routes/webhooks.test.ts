import express from 'express';
import request from 'supertest';
import { createWebhookRouter, WebhookDeps } from '../../src/routes/webhooks';
import { EventRepository } from '../../src/repositories/event.repository';

class FakeEventRepo implements EventRepository {
  seen = new Set<string>();
  async recordIfNew(id: string): Promise<boolean> {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}

function buildApp(deps: WebhookDeps) {
  const app = express();
  app.use('/api/v1/billing', createWebhookRouter(deps));
  return app;
}

const baseCtx: any = {
  customers: { findByStripeCustomerId: jest.fn().mockResolvedValue(null) },
  subscriptions: {},
  plans: {},
  permit: {},
  emitter: {},
  writePlanCache: jest.fn(),
};

describe('POST /api/v1/billing/webhooks/stripe', () => {
  it('returns 400 when the signature header is missing', async () => {
    const deps: WebhookDeps = {
      stripe: { webhooks: { constructEvent: jest.fn() } },
      webhookSecret: 'whsec_test',
      events: new FakeEventRepo(),
      ctx: baseCtx,
    };
    const res = await request(buildApp(deps)).post('/api/v1/billing/webhooks/stripe').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification throws', async () => {
    const constructEvent = jest.fn(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const deps: WebhookDeps = {
      stripe: { webhooks: { constructEvent } },
      webhookSecret: 'whsec_test',
      events: new FakeEventRepo(),
      ctx: baseCtx,
    };
    const res = await request(buildApp(deps))
      .post('/api/v1/billing/webhooks/stripe')
      .set('stripe-signature', 'bad')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error');
  });

  it('dedups a duplicate payment-mode event (mirror written once, emitted once)', async () => {
    const event = {
      id: 'evt_pay_dup',
      type: 'checkout.session.completed',
      created: 1_752_000_000,
      data: {
        object: {
          id: 'cs_pay_1',
          mode: 'payment',
          status: 'complete',
          payment_status: 'paid',
          customer: 'cus_1',
          payment_intent: 'pi_1',
          amount_total: 85000,
          currency: 'usd',
          client_reference_id: 'order-42',
          metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
        },
      },
    };
    const ctx: any = {
      ...baseCtx,
      payments: {
        upsert: jest.fn().mockImplementation(async (row: any) => ({
          id: 'row-1',
          createdAt: 'x',
          updatedAt: 'x',
          ...row,
        })),
        getBySessionId: jest.fn().mockResolvedValue(null),
        findByOrder: jest.fn().mockResolvedValue(null),
      },
      customers: {
        findByStripeCustomerId: jest.fn().mockResolvedValue({
          id: 'localcust_1',
          entityType: 'organization',
          entityId: '33333333-3333-4333-8333-333333333333',
          stripeCustomerId: 'cus_1',
        }),
      },
      emitter: { paymentCompleted: jest.fn().mockResolvedValue(undefined) },
    };
    const deps: WebhookDeps = {
      stripe: { webhooks: { constructEvent: jest.fn().mockReturnValue(event) } },
      webhookSecret: 'whsec_test',
      events: new FakeEventRepo(),
      ctx,
    };
    const app = buildApp(deps);

    const send = () =>
      request(app)
        .post('/api/v1/billing/webhooks/stripe')
        .set('stripe-signature', 'good')
        .set('Content-Type', 'application/json')
        .send(Buffer.from('{}'));

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    // The duplicate delivery never re-runs the handler.
    expect(ctx.payments.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledTimes(1);
  });

  it('processes a valid event once and dedups the duplicate', async () => {
    const event = { id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } };
    const constructEvent = jest.fn().mockReturnValue(event);
    const events = new FakeEventRepo();
    const deps: WebhookDeps = {
      stripe: { webhooks: { constructEvent } },
      webhookSecret: 'whsec_test',
      events,
      ctx: baseCtx,
    };
    const app = buildApp(deps);

    const first = await request(app)
      .post('/api/v1/billing/webhooks/stripe')
      .set('stripe-signature', 'good')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const second = await request(app)
      .post('/api/v1/billing/webhooks/stripe')
      .set('stripe-signature', 'good')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });
});
