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
