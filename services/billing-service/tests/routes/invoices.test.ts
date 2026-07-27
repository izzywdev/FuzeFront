/**
 * Unit/route tests for GET /api/v1/billing/invoices.
 *
 * Drives the REAL createApp wiring via supertest with mocked deps (Stripe never
 * hit). Asserts: field mapping + nextCursor; no-customer -> empty list; missing
 * actor context -> 401; limit clamping; cursor -> starting_after passthrough;
 * Stripe error -> mapped status.
 *
 * The shared helper's DepStubs.stripe does not include `invoices` (it predates
 * this slice), so we supply a FULL stripe stub via opts.stubs.stripe — buildApp
 * shallow-merges opts.stubs over its defaults, so the whole `stripe` key is
 * replaced. We keep the other stripe sub-resources present so unrelated wiring
 * (checkout/credits/setup-intent/webhooks) still constructs.
 */
import request from 'supertest';
import {
  buildApp,
  authHeader,
  actorOrgHeaders,
  INTERNAL_TOKEN,
  ORG_ID,
  USER_ID,
} from '../contract/helpers';

const URL = '/api/v1/billing/invoices';

/** A full Stripe stub including invoices.list + the pre-existing sub-resources. */
function stripeStub(listImpl?: jest.Mock) {
  const constructEvent = jest.fn();
  return {
    stripe: {
      setupIntents: { create: jest.fn() },
      customers: { createBalanceTransaction: jest.fn() },
      checkout: { sessions: { create: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      invoices: { list: listImpl ?? jest.fn() },
      webhooks: { constructEvent },
    },
  } as any;
}

/** Customer-with-billing stub for the authorized org. */
function orgCustomerRepoStub(stripeCustomerId = 'cus_org_1') {
  return {
    customerRepo: {
      findByEntity: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId,
      }),
      findByStripeCustomerId: jest.fn().mockResolvedValue(null),
      insert: jest.fn(),
    },
  } as any;
}

function rawInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    number: 'INV-0001',
    created: 1_700_000_000, // 2023-11-14T22:13:20.000Z
    amount_due: 900,
    amount_paid: 900,
    currency: 'USD',
    status: 'paid',
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
    invoice_pdf: 'https://invoice.stripe.com/i/in_1.pdf',
    ...overrides,
  };
}

describe('GET /invoices — Stripe-backed invoice history', () => {
  it('200 maps Stripe fields to the frozen shape and sets nextCursor when has_more', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [rawInvoice({ id: 'in_1' }), rawInvoice({ id: 'in_last', number: null })],
      has_more: true,
    });
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });

    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBe('in_last');
    expect(res.body.invoices).toHaveLength(2);
    expect(res.body.invoices[0]).toEqual({
      id: 'in_1',
      number: 'INV-0001',
      created: '2023-11-14T22:13:20.000Z',
      amountDue: 900,
      amountPaid: 900,
      currency: 'usd', // lowercased
      status: 'paid',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      invoicePdf: 'https://invoice.stripe.com/i/in_1.pdf',
    });
    // null passthrough for number when absent.
    expect(res.body.invoices[1].number).toBeNull();

    expect(stubs.customerRepo.findByEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_org_1', limit: 20 }),
    );
    // No cursor supplied -> no starting_after.
    expect(list.mock.calls[0][0]).not.toHaveProperty('starting_after');
  });

  it('200 nextCursor=null when Stripe reports has_more=false', async () => {
    const list = jest.fn().mockResolvedValue({ data: [rawInvoice()], has_more: false });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
  });

  it('200 empty list when the entity has no billing customer (not an error)', async () => {
    const list = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      // customerRepo default findByEntity resolves null.
      stubs: { ...stripeStub(list) },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invoices: [], nextCursor: null });
    expect(list).not.toHaveBeenCalled();
  });

  it('401 when the proxy actor-context headers are absent', async () => {
    const list = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader()); // valid token, NO actor headers
    expect(res.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('401 when the internal token is missing', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(jest.fn()), ...orgCustomerRepoStub() },
    });
    const res = await request(app).get(URL).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(401);
  });

  it('clamps limit: over-max -> 100, under-min -> 1, non-numeric -> default 20', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], has_more: false });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });

    await request(app).get(`${URL}?limit=9999`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(list.mock.calls[0][0].limit).toBe(100);

    await request(app).get(`${URL}?limit=0`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(list.mock.calls[1][0].limit).toBe(1);

    await request(app).get(`${URL}?limit=abc`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(list.mock.calls[2][0].limit).toBe(20);
  });

  it('passes the cursor through as starting_after', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], has_more: false });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });
    await request(app)
      .get(`${URL}?cursor=in_prevpage`)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(list.mock.calls[0][0]).toEqual(
      expect.objectContaining({ starting_after: 'in_prevpage' }),
    );
  });

  it('maps a Stripe error to its status (502 on an unknown/upstream throw)', async () => {
    const list = jest.fn().mockRejectedValue(new Error('stripe boom'));
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(502);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String), message: expect.any(String) }),
    );
  });

  it('forwards a StripeInvalidRequestError as its 4xx status', async () => {
    const list = jest.fn().mockRejectedValue(
      Object.assign(new Error('No such customer'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 400,
      }),
    );
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...stripeStub(list), ...orgCustomerRepoStub() },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ code: 'resource_missing' }));
  });
});
