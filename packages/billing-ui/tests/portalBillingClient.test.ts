import { describe, it, expect, vi } from 'vitest';
import { createPortalBillingClient, deriveConnectStatus } from '../src/api/portalBillingClient';
import { HttpError } from '../src/api/http';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status',
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('createPortalBillingClient — REAL endpoints', () => {
  it('getPlans() hits GET /api/v1/billing/plans and returns the plan list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { plans: [{ priceId: 'price_pro' }] }));
    const client = createPortalBillingClient({ fetchImpl });
    const plans = await client.getPlans();
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/billing/plans', expect.objectContaining({ method: 'GET' }));
    expect(plans).toEqual([{ priceId: 'price_pro' }]);
  });

  it('getPlans() surfaces a load failure as an HttpError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.getPlans()).rejects.toBeInstanceOf(HttpError);
  });

  it('getSubscription(organizationId) hits GET /subscriptions?organizationId=... and returns the subscription', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { subscription: { id: 'sub_1', status: 'active' } }));
    const client = createPortalBillingClient({ fetchImpl });
    const sub = await client.getSubscription('org_northwind');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/billing/subscriptions?organizationId=org_northwind',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(sub).toEqual({ id: 'sub_1', status: 'active' });
  });

  it('getSubscription() returns null for a portal with no subscription yet (200 {subscription:null})', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { subscription: null }));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.getSubscription('org_1')).resolves.toBeNull();
  });

  it('getSubscription() surfaces a 403 (non-portal-admin / no read authority) as an HttpError with status 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden', code: 'ORG_PERMISSION_DENIED' }));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.getSubscription('org_1')).rejects.toMatchObject({ status: 403 });
  });

  it('openBillingPortal() POSTs organizationId + returnUrl to /portal and returns the redirect url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { url: 'https://billing.stripe.com/session/abc' }));
    const client = createPortalBillingClient({ fetchImpl });
    const res = await client.openBillingPortal('org_1', 'https://portal.example.com/billing');
    const [, init] = fetchImpl.mock.calls[0];
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/billing/portal');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ organizationId: 'org_1', returnUrl: 'https://portal.example.com/billing' });
    expect(res).toEqual({ url: 'https://billing.stripe.com/session/abc' });
  });

  it('openBillingPortal() surfaces a 409 (no billing customer yet) as an HttpError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'no billing customer' }));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.openBillingPortal('org_1', 'https://x')).rejects.toMatchObject({ status: 409 });
  });
});

describe('createPortalBillingClient — ANTICIPATED endpoints (FF-EPIC-15, pending)', () => {
  it('getConnectStatus() hits GET /api/v1/portal/connect/status and derives the UI status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { chargesEnabled: true, payoutsEnabled: true, onboardingStatus: 'complete', steps: [] }));
    const client = createPortalBillingClient({ fetchImpl });
    const status = await client.getConnectStatus();
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/portal/connect/status', expect.objectContaining({ method: 'GET' }));
    expect(status.status).toBe('active');
  });

  it('getConnectStatus() rejects with a 404 HttpError until the backend ships (no route today)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not found' }));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.getConnectStatus()).rejects.toMatchObject({ status: 404 });
  });

  it('startConnectOnboarding() POSTs returnUrl to /connect/account-link', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { url: 'https://connect.stripe.com/setup/abc' }));
    const client = createPortalBillingClient({ fetchImpl });
    const res = await client.startConnectOnboarding('https://portal.example.com/billing');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/portal/connect/account-link');
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(res.url).toContain('stripe.com');
  });

  it('startConnectOnboarding() rejects with a 404 HttpError until the backend ships', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.startConnectOnboarding('https://x')).rejects.toMatchObject({ status: 404 });
  });

  it('listPriceBook() hits GET /api/v1/portal/price-book and returns the price list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { prices: [{ id: 'price_starter' }] }));
    const client = createPortalBillingClient({ fetchImpl });
    const res = await client.listPriceBook();
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/portal/price-book', expect.objectContaining({ method: 'GET' }));
    expect(res.prices).toEqual([{ id: 'price_starter' }]);
  });

  it('listPriceBook() rejects with a 404 HttpError until the backend ships', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.listPriceBook()).rejects.toMatchObject({ status: 404 });
  });

  it('createPrice() POSTs the input to /api/v1/portal/price-book', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'price_new', planName: 'Team', amountCents: 9900, currency: 'usd', status: 'active' }));
    const client = createPortalBillingClient({ fetchImpl });
    const input = { planName: 'Team', amountCents: 9900, currency: 'usd', interval: 'month' };
    const created = await client.createPrice(input);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/portal/price-book');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(input);
    expect(created.id).toBe('price_new');
  });

  it('createPrice() rejects with a 404 HttpError until the backend ships', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const client = createPortalBillingClient({ fetchImpl });
    await expect(client.createPrice({ planName: 'X', amountCents: 100, currency: 'usd' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('deriveConnectStatus', () => {
  it('is "active" only when BOTH charges_enabled and payouts_enabled are true', () => {
    expect(deriveConnectStatus({ chargesEnabled: true, payoutsEnabled: true })).toBe('active');
    expect(deriveConnectStatus({ chargesEnabled: true, payoutsEnabled: false })).toBe('in-progress');
    expect(deriveConnectStatus({ chargesEnabled: false, payoutsEnabled: true })).toBe('in-progress');
  });

  it('is "restricted" regardless of the flags when the account is restricted', () => {
    expect(deriveConnectStatus({ chargesEnabled: true, payoutsEnabled: true, restricted: true })).toBe('restricted');
  });

  it('is "not-started" when onboarding has not begun', () => {
    expect(deriveConnectStatus({ chargesEnabled: false, payoutsEnabled: false, started: false })).toBe('not-started');
  });
});
