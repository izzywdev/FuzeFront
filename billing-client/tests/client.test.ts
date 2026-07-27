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
