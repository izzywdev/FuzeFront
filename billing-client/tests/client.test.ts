import { BillingClient } from '../src/client';

// Mock axios.create to return a stub instance whose verbs we can assert on.
const verbs = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => verbs) },
}));

import axios from 'axios';

describe('BillingClient', () => {
  beforeEach(() => {
    Object.values(verbs).forEach((m) => m.mockReset());
  });

  it('configures axios with baseURL + Bearer token', () => {
    new BillingClient({ baseUrl: 'http://billing:3006/', internalToken: 'tok' });
    expect((axios as any).default?.create ?? (axios as any).create).toBeDefined();
    const createMock = (axios as unknown as { create: jest.Mock }).create;
    const cfg = createMock.mock.calls[0][0];
    expect(cfg.baseURL).toBe('http://billing:3006/api/v1/billing');
    expect(cfg.headers.Authorization).toBe('Bearer tok');
  });

  it('getPlans GETs /plans and unwraps the list', async () => {
    verbs.get.mockResolvedValue({ data: { plans: [{ tierName: 'pro' }] } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const plans = await c.getPlans();
    expect(verbs.get).toHaveBeenCalledWith('/plans');
    expect(plans).toEqual([{ tierName: 'pro' }]);
  });

  it('createSubscription POSTs the request body', async () => {
    verbs.post.mockResolvedValue({ data: { subscription: {}, requiresAction: false } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    await c.createSubscription({ entityType: 'user', entityId: 'u1', priceId: 'price_x' });
    expect(verbs.post).toHaveBeenCalledWith('/subscriptions', {
      entityType: 'user',
      entityId: 'u1',
      priceId: 'price_x',
    });
  });

  it('updateSubscription PATCHes the encoded id', async () => {
    verbs.patch.mockResolvedValue({ data: { subscription: { id: 'x' } } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    await c.updateSubscription('sub_1', { seatQuantity: 5 });
    expect(verbs.patch).toHaveBeenCalledWith('/subscriptions/sub_1', { seatQuantity: 5 });
  });

  it('cancelSubscription DELETEs the id', async () => {
    verbs.delete.mockResolvedValue({ data: { subscription: { id: 'x' } } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    await c.cancelSubscription('sub_1');
    expect(verbs.delete).toHaveBeenCalledWith('/subscriptions/sub_1');
  });

  it('createPaymentCheckout POSTs the request body (no actor headers when omitted)', async () => {
    verbs.post.mockResolvedValue({ data: { sessionId: 'cs_1', url: 'https://stripe/x' } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const req = {
      productKey: 'mendys-datasets',
      externalOrderId: 'order-42',
      entityType: 'organization' as const,
      entityId: 'org-1',
      currency: 'usd',
      lineItems: [{ name: 'Recording hours', unitAmountCents: 15000, quantity: 4 }],
      successUrl: 'https://a/s',
      cancelUrl: 'https://a/c',
    };
    const out = await c.createPaymentCheckout(req);
    expect(verbs.post).toHaveBeenCalledWith('/payments/checkout', req, { headers: {} });
    expect(out).toEqual({ sessionId: 'cs_1', url: 'https://stripe/x' });
  });

  it('createPaymentCheckout maps the actor context to the X-Billing-* headers', async () => {
    verbs.post.mockResolvedValue({ data: { sessionId: 'cs_1', url: null } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    await c.createPaymentCheckout(
      {
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        entityType: 'user',
        entityId: 'u1',
        currency: 'eur',
        lineItems: [{ name: 'X', unitAmountCents: 100, quantity: 1 }],
        successUrl: 'https://a/s',
        cancelUrl: 'https://a/c',
      },
      { actorUserId: 'u1', entityType: 'user', entityId: 'u1' },
    );
    expect(verbs.post.mock.calls[0][2]).toEqual({
      headers: {
        'X-Billing-Actor-User-Id': 'u1',
        'X-Billing-Entity-Type': 'user',
        'X-Billing-Entity-Id': 'u1',
      },
    });
  });

  it('getPaymentSession GETs the encoded id with actor headers and unwraps {payment}', async () => {
    verbs.get.mockResolvedValue({
      data: { payment: { sessionId: 'cs 1', status: 'paid' } },
    });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const out = await c.getPaymentSession('cs 1', {
      actorUserId: 'u1',
      entityType: 'organization',
      entityId: 'org-1',
    });
    expect(verbs.get).toHaveBeenCalledWith('/payments/sessions/cs%201', {
      headers: {
        'X-Billing-Actor-User-Id': 'u1',
        'X-Billing-Entity-Type': 'organization',
        'X-Billing-Entity-Id': 'org-1',
      },
    });
    expect(out).toEqual({ sessionId: 'cs 1', status: 'paid' });
  });

  it('listInvoices GETs /invoices with limit + cursor query params', async () => {
    verbs.get.mockResolvedValue({
      data: { invoices: [{ id: 'uuid-1' }], nextCursor: 'opaque-cursor' },
    });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const out = await c.listInvoices({ limit: 50, cursor: 'prev-cursor' });
    expect(verbs.get).toHaveBeenCalledWith('/invoices', {
      params: { limit: 50, cursor: 'prev-cursor' },
    });
    expect(out).toEqual({ invoices: [{ id: 'uuid-1' }], nextCursor: 'opaque-cursor' });
  });

  it('listInvoices omits absent params (no limit/cursor)', async () => {
    verbs.get.mockResolvedValue({ data: { invoices: [], nextCursor: null } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    await c.listInvoices();
    expect(verbs.get).toHaveBeenCalledWith('/invoices', { params: {} });
  });

  it('syncInvoices POSTs /invoices/sync and returns {synced}', async () => {
    verbs.post.mockResolvedValue({ data: { synced: 3 } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const out = await c.syncInvoices();
    expect(verbs.post).toHaveBeenCalledWith('/invoices/sync', {});
    expect(out).toEqual({ synced: 3 });
  });

  it('createSetupIntent POSTs entity + returns clientSecret', async () => {
    verbs.post.mockResolvedValue({ data: { clientSecret: 'seti_secret' } });
    const c = new BillingClient({ baseUrl: 'http://b', internalToken: 't' });
    const out = await c.createSetupIntent('organization', 'org-1');
    expect(verbs.post).toHaveBeenCalledWith('/setup-intent', {
      entityType: 'organization',
      entityId: 'org-1',
    });
    expect(out.clientSecret).toBe('seti_secret');
  });
});
