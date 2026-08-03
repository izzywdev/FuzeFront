import express from 'express';
import request from 'supertest';
import { graphCreate } from '@fuzefront/shared/dist/identity';
import type { EntityType } from '@fuzefront/shared/dist/identity';
import { createWebhookRouter } from '../src/routes/webhooks';

/**
 * Verifies the identifier wiring in src/app.ts — specifically that mounting
 * graph-create does not break the provider webhook path.
 *
 * The middleware rejects any create body carrying an `id`, and EVERY Stripe
 * webhook object carries one. If the ordering in app.ts were wrong, the entire
 * provider integration would 422. That is not something a unit test of the
 * middleware can catch, so it is asserted here against the real routers in the
 * real mount order.
 */

const API_BASE = '/api/v1/billing';
const BILLING_AGGREGATE = new Set<EntityType>([
  'customer',
  'subscription',
  'payment',
  'invoice',
  'credit',
]);

/** The app.ts mount order, reproduced: webhook (raw) -> json -> graphCreate. */
function buildApp(opts: { webhookSecret?: string } = {}) {
  const app = express();

  const constructEvent = jest.fn(() => {
    throw new Error('signature verification failed');
  });

  app.use(
    API_BASE,
    createWebhookRouter({
      stripe: { webhooks: { constructEvent } } as never,
      webhookSecret: opts.webhookSecret ?? 'whsec_test',
      ctx: {} as never,
    } as never),
  );
  app.use(express.json());
  app.use(API_BASE, graphCreate({ aggregate: BILLING_AGGREGATE }));

  // Stand-in for a guarded create route: echoes what the handler actually saw.
  app.post(`${API_BASE}/things`, (req, res) => {
    res.status(201).json({ received: req.body });
  });

  return { app, constructEvent };
}

describe('billing-service — server-owned identifiers', () => {
  it('rejects a client-supplied id on create', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(`${API_BASE}/things`)
      .send({ type: 'customer', lid: '1', id: 'cus_forged' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLIENT_SUPPLIED_ID');
  });

  it('mints ids for a lid graph and returns idMap without the route helping', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(`${API_BASE}/things`)
      .send({
        type: 'customer',
        lid: '1',
        invoices: [{ type: 'invoice', lid: '2', customerId: 'lid:1' }],
      });

    expect(res.status).toBe(201);

    // The handler saw real ids and no lid...
    const seen = res.body.received;
    expect(seen.id).toMatch(/^cus_/);
    expect(seen.lid).toBeUndefined();
    expect(seen.invoices[0].id).toMatch(/^inv_/);
    expect(seen.invoices[0].customerId).toBe(seen.id);

    // ...and the client got the mapping back.
    expect(res.body.idMap['1']).toBe(seen.id);
    expect(res.body.idMap['2']).toBe(seen.invoices[0].id);
  });

  it('refuses to create an entity billing does not own', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(`${API_BASE}/things`)
      .send({ type: 'portal', lid: '1' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CROSS_AGGREGATE_LID');
  });

  it('does NOT intercept provider webhooks, whose payloads always carry an id', async () => {
    // The regression this file exists for. The webhook router is mounted before
    // express.json() and consumes the raw body, so graph-create must never see
    // it. Reaching signature verification proves the request got through.
    const { app, constructEvent } = buildApp();
    const res = await request(app)
      .post(`${API_BASE}/webhooks/stripe`)
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('content-type', 'application/json')
      .send({ id: 'evt_123', object: 'event', data: { object: { id: 'in_456' } } });

    expect(res.status).not.toBe(422);
    expect(constructEvent).toHaveBeenCalled();
  });

  it('leaves an ordinary create body untouched', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(`${API_BASE}/things`)
      .send({ entityType: 'organization', entityId: 'org_123', amount: 500 });

    expect(res.status).toBe(201);
    expect(res.body.received).toEqual({
      entityType: 'organization',
      entityId: 'org_123',
      amount: 500,
    });
    expect(res.body.idMap).toBeUndefined();
  });
});
