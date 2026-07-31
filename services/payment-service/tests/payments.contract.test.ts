import request from 'supertest';
import { createApp } from '../src/app';

const INTERNAL_TOKEN = 'payment-internal-token';

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
    const res = await request(createApp({ provider, internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/checkout-sessions')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
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
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/checkout-sessions')
      .send({ mode: 'subscription' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('POST /api/v1/payments/customers', () => {
  it('creates a customer with the declared 201 application/json response', async () => {
    // @fuzequality api createCustomer
    const provider = fakeProvider();
    const res = await request(createApp({ provider, internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/customers')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
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
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/customers')
      .send({ externalId: 'organization-1' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('GET /api/v1/payments/customers/:customerId', () => {
  it('gets a customer with the declared 200 application/json response', async () => {
    // @fuzequality api getCustomer
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers/customer-1')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .expect(200);

    expect(res.type).toMatch(/json/);
    expect(res.body.customer.providerCustomerId).toBe('customer-1');
  });

  it('returns 401 application/json when customer lookup authentication is missing', async () => {
    // @fuzequality api getCustomer
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers/customer-1')
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.error).toBe('unauthorized');
  });

  it('does not perform a lookup when the required customerId path parameter is missing', async () => {
    // @fuzequality api getCustomer
    await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers/')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .expect(404);
  });
});

describe('GET /api/v1/payments/customers/:customerId/invoices', () => {
  it('lists customer invoices with the declared 200 application/json response', async () => {
    // @fuzequality api listInvoices
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers/customer-1/invoices')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .expect(200);

    expect(res.type).toMatch(/json/);
    expect(res.body.items).toHaveLength(1);
  });

  it('returns 401 application/json when invoice-list authentication is missing', async () => {
    // @fuzequality api listInvoices
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers/customer-1/invoices')
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.error).toBe('unauthorized');
  });

  it('does not list invoices when the required customerId path parameter is missing', async () => {
    // @fuzequality api listInvoices
    await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .get('/api/v1/payments/customers//invoices')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .expect(404);
  });
});

describe('POST /api/v1/payments/payment-methods/setup', () => {
  it('creates a payment-method setup with the declared 201 application/json response', async () => {
    // @fuzequality api setupPaymentMethod
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/payment-methods/setup')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .send({ customerId: 'customer-1', usage: 'off_session' })
      .expect(201);

    expect(res.type).toMatch(/json/);
    expect(res.body.setup.providerSetupId).toBe('setup-1');
  });

  it('returns 401 application/json when payment-method setup authentication is missing', async () => {
    // @fuzequality api setupPaymentMethod
    const res = await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/payment-methods/setup')
      .send({ customerId: 'customer-1' })
      .expect(401);

    expect(res.type).toMatch(/json/);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('POST /api/v1/payments/webhooks/:provider', () => {
  it('receives a provider webhook with the declared 200 application/json response', async () => {
    // @fuzequality api receiveWebhook
    const provider = fakeProvider();
    const res = await request(createApp({ provider, internalToken: INTERNAL_TOKEN }))
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
    await request(createApp({ provider: fakeProvider(), internalToken: INTERNAL_TOKEN }))
      .post('/api/v1/payments/webhooks/')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .send('{}')
      .expect(404);
  });
});
