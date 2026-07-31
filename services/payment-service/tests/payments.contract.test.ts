import request from 'supertest';
import { createApp } from '../src/app';

const INTERNAL_TOKEN = 'payment-internal-token';

function fakeProvider() {
  return {
    name: 'test',
    createCustomer: jest.fn(),
    getCustomer: jest.fn(),
    listInvoices: jest.fn(),
    createCheckoutSession: jest.fn().mockResolvedValue({
      providerSessionId: 'checkout-1',
      url: 'https://payments.example/checkout-1',
      status: 'open',
    }),
    setupPaymentMethod: jest.fn(),
    parseWebhook: jest.fn(),
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
