import request from 'supertest';
import { ServiceAuthError, type MachineTokenVerifier } from '@fuzefront/service-auth';
import { createApp } from '../src/app';

// A valid managed service token the stub verifier accepts. With the migration to
// @fuzefront/service-auth the guard no longer compares a static shared secret —
// it introspects the presented token against security-service. Tests inject a
// stub verifier (the `verifier` app dep) so no live security-service is needed.
const VALID_TOKEN = 'valid-service-token';

/** Stub verifier: `VALID_TOKEN` is an active machine identity; anything else is denied (fail-closed). */
function stubVerifier(): MachineTokenVerifier {
  return {
    verifyMachineToken: jest.fn(async (token: string) => {
      if (token === VALID_TOKEN) {
        return {
          subject: 'svc:billing-service',
          tenantId: null,
          scopes: [],
          raw: { active: true, subject: 'svc:billing-service' } as any,
        };
      }
      throw new ServiceAuthError('TOKEN_INACTIVE', 'Token is not active.', 401);
    }),
  };
}

function appWith(provider: any) {
  return createApp({ provider, verifier: stubVerifier() });
}

function fakeProvider() {
  return {
    name: 'test',
    createCustomer: jest.fn().mockResolvedValue({
      providerCustomerId: 'customer-1',
      email: 'owner@example.com',
      name: 'Example Owner',
    }),
    getCustomer: jest.fn().mockResolvedValue({
      providerCustomerId: 'customer-1',
      email: 'owner@example.com',
      name: 'Example Owner',
    }),
    listInvoices: jest.fn().mockResolvedValue({
      items: [{ providerInvoiceId: 'invoice-1', status: 'paid', amountDue: 1000, currency: 'usd' }],
      nextCursor: null,
    }),
    createCheckoutSession: jest.fn().mockResolvedValue({
      providerSessionId: 'checkout-1',
      url: 'https://payments.example/checkout-1',
      status: 'open',
    }),
    setupPaymentMethod: jest.fn().mockResolvedValue({
      clientSecret: 'setup-secret',
      providerSetupId: 'setup-1',
    }),
    parseWebhook: jest.fn().mockReturnValue({
      provider: 'stripe',
      providerEventId: 'event-1',
      type: 'invoice.paid',
      data: {},
    }),
    parseInvoiceEvent: jest.fn(),
  } as any;
}

describe('POST /api/v1/payments/checkout-sessions', () => {
  it('creates a checkout session with the declared 201 application/json response', async () => {
    // @fuzequality api createCheckoutSession
    const provider = fakeProvider();
    const res = await request(appWith(provider))
      .post('/api/v1/payments/checkout-sessions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        mode: 'subscription',
        customerId: 'customer-1',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      })
      .expect(201);

    expect(res.type).toMatch(/json/);
    expect(res.body.session.providerSessionId).toBe('checkout-1');
  });

  it('returns 401 application/json when checkout authentication is missing', async () => {
    // @fuzequality api createCheckoutSession
    const res = await request(appWith(fakeProvider()))
      .post('/api/v1/payments/checkout-sessions')
      .send({ mode: 'subscription' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    // Fail-closed: no bearer token -> requireMachineAuth denies with a coded body.
    expect(res.body.code).toBe('NO_TOKEN');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 401 application/json when the presented service token is invalid', async () => {
    // @fuzequality api createCheckoutSession
    const res = await request(appWith(fakeProvider()))
      .post('/api/v1/payments/checkout-sessions')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ mode: 'subscription' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    // Fail-closed: an inactive/invalid token is a denial, never a pass.
    expect(res.body.code).toBe('TOKEN_INACTIVE');
  });
});

describe('POST /api/v1/payments/customers', () => {
  it('creates a customer with the declared 201 application/json response', async () => {
    // @fuzequality api createCustomer
    const provider = fakeProvider();
    const res = await request(appWith(provider))
      .post('/api/v1/payments/customers')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        externalId: 'organization-1',
        email: 'owner@example.com',
        name: 'Example Owner',
      })
      .expect(201);

    expect(res.type).toMatch(/json/);
    expect(res.body.customer.providerCustomerId).toBe('customer-1');
  });

  it('returns 401 application/json when customer creation authentication is missing', async () => {
    // @fuzequality api createCustomer
    const res = await request(appWith(fakeProvider()))
      .post('/api/v1/payments/customers')
      .send({ externalId: 'organization-1' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.code).toBe('NO_TOKEN');
  });
});

describe('GET /api/v1/payments/customers/:customerId', () => {
  it('gets a customer with the declared 200 application/json response', async () => {
    // @fuzequality api getCustomer
    const res = await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers/customer-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(200);

    expect(res.type).toMatch(/json/);
    expect(res.body.customer.providerCustomerId).toBe('customer-1');
  });

  it('returns 401 application/json when customer lookup authentication is missing', async () => {
    // @fuzequality api getCustomer
    const res = await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers/customer-1')
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  it('does not perform a lookup when the required customerId path parameter is missing', async () => {
    // @fuzequality api getCustomer
    await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(404);
  });
});

describe('GET /api/v1/payments/customers/:customerId/invoices', () => {
  it('lists customer invoices with the declared 200 application/json response', async () => {
    // @fuzequality api listInvoices
    const res = await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers/customer-1/invoices')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(200);

    expect(res.type).toMatch(/json/);
    expect(res.body.items).toHaveLength(1);
  });

  it('returns 401 application/json when invoice-list authentication is missing', async () => {
    // @fuzequality api listInvoices
    const res = await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers/customer-1/invoices')
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  it('does not list invoices when the required customerId path parameter is missing', async () => {
    // @fuzequality api listInvoices
    await request(appWith(fakeProvider()))
      .get('/api/v1/payments/customers//invoices')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(404);
  });
});

describe('POST /api/v1/payments/payment-methods/setup', () => {
  it('creates a payment-method setup with the declared 201 application/json response', async () => {
    // @fuzequality api setupPaymentMethod
    const res = await request(appWith(fakeProvider()))
      .post('/api/v1/payments/payment-methods/setup')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ customerId: 'customer-1', usage: 'off_session' })
      .expect(201);

    expect(res.type).toMatch(/json/);
    expect(res.body.setup.providerSetupId).toBe('setup-1');
  });

  it('returns 401 application/json when payment-method setup authentication is missing', async () => {
    // @fuzequality api setupPaymentMethod
    const res = await request(appWith(fakeProvider()))
      .post('/api/v1/payments/payment-methods/setup')
      .send({ customerId: 'customer-1' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.code).toBe('NO_TOKEN');
  });
});

describe('POST /api/v1/payments/webhooks/:provider', () => {
  it('receives a provider webhook with the declared 200 application/json response', async () => {
    // @fuzequality api receiveWebhook
    // Webhook is PUBLIC (authenticity is the provider signature, not the internal
    // token) — it must succeed with no Authorization header.
    const provider = fakeProvider();
    const res = await request(appWith(provider))
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid-signature')
      .send(JSON.stringify({ id: 'event-1', type: 'invoice.paid' }))
      .expect(200);

    expect(res.type).toMatch(/json/);
    expect(res.body).toEqual({ received: true, handled: true });
    expect(provider.parseWebhook).toHaveBeenCalled();
  });

  it('does not dispatch a webhook when the required provider path parameter is missing', async () => {
    // @fuzequality api receiveWebhook
    // `/webhooks/` (empty provider) doesn't match the public `/webhooks/:provider`
    // router, so it falls through to the guarded API; present a valid token so the
    // assertion isolates the missing-param 404 rather than the guard's 401.
    await request(appWith(fakeProvider()))
      .post('/api/v1/payments/webhooks/')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send('{}')
      .expect(404);
  });
});

describe('machine auth left unconfigured (no verifier, SECURITY_SERVICE_URL unset)', () => {
  // This is the security point of the migration off PAYMENT_INTERNAL_TOKEN: the
  // OLD static-bearer guard was a NO-OP (open) when its token env var was unset.
  // The new guard flips that — an absent `verifier` dep (mirroring an unset
  // `SECURITY_SERVICE_URL` in `index.ts`) denies EVERY request on the neutral
  // API with 503, even one carrying what would otherwise be a valid token.
  function appWithNoVerifier(provider: any) {
    return createApp({ provider }); // no `verifier` -> deny-all guard
  }

  it('returns 503 with a machine-auth-not-configured body, never reaching the provider', async () => {
    const provider = fakeProvider();
    const res = await request(appWithNoVerifier(provider))
      .post('/api/v1/payments/customers')
      .send({ externalId: 'organization-1' })
      .expect(503);

    expect(res.type).toMatch(/json/);
    expect(res.body).toEqual({ error: 'machine auth not configured' });
    expect(provider.createCustomer).not.toHaveBeenCalled();
  });

  it('still denies with 503 even when a bearer token is presented (no verifier to check it against)', async () => {
    const res = await request(appWithNoVerifier(fakeProvider()))
      .get('/api/v1/payments/customers/customer-1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(503);

    expect(res.body).toEqual({ error: 'machine auth not configured' });
  });

  it('leaves the public webhook route reachable — machine auth only guards the neutral API', async () => {
    const provider = fakeProvider();
    const res = await request(appWithNoVerifier(provider))
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid-signature')
      .send(JSON.stringify({ id: 'event-1', type: 'invoice.paid' }))
      .expect(200);

    expect(res.body).toEqual({ received: true, handled: true });
  });
});
