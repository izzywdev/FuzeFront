/**
 * Route tests for GET /api/v1/billing/invoices and POST /api/v1/billing/invoices/sync.
 *
 * Drives the REAL createApp wiring via supertest with mocked deps. Invoices are
 * now VENDOR-NEUTRAL and DB-backed: the route reads the local invoice store via
 * InvoiceService -> invoiceRepo.listByCustomer, exposing OUR uuid as `id` and an
 * OPAQUE keyset cursor. No Stripe id or cursor leaks through the contract.
 *
 * Asserts: neutral field mapping + opaque nextCursor passthrough; no-customer ->
 * empty list; missing actor -> 401; missing token -> 401; limit clamping +
 * cursor passthrough to the repo; the lazy sync-once-then-read path; and
 * POST /invoices/sync returning {synced}.
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
const SYNC_URL = '/api/v1/billing/invoices/sync';

/** A billing.invoices row (snake_case) as returned by invoiceRepo.listByCustomer. */
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    customer_id: 'localcust_1',
    provider: 'stripe',
    provider_invoice_id: 'in_1',
    number: 'INV-0001',
    status: 'paid',
    amount_due_cents: 900,
    amount_paid_cents: 900,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.provider/i/in_1',
    invoice_pdf_url: 'https://invoice.provider/i/in_1.pdf',
    issued_at: new Date('2023-11-14T22:13:20.000Z'),
    created_at: new Date('2023-11-14T22:13:20.000Z'),
    updated_at: new Date('2023-11-14T22:13:20.000Z'),
    ...overrides,
  };
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

/** A full Stripe stub including invoices.list (needed only on the sync path). */
function stripeStub(listImpl?: jest.Mock) {
  return {
    stripe: {
      setupIntents: { create: jest.fn() },
      customers: { createBalanceTransaction: jest.fn() },
      checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      invoices: { list: listImpl ?? jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    },
  } as any;
}

/** A provider invoice, as Stripe.invoices.list().data items map from. */
function rawStripeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    object: 'invoice',
    number: 'INV-0001',
    created: 1_700_000_000,
    amount_due: 900,
    amount_paid: 900,
    currency: 'USD',
    status: 'paid',
    hosted_invoice_url: 'https://invoice.provider/i/in_1',
    invoice_pdf: 'https://invoice.provider/i/in_1.pdf',
    customer: 'cus_org_1',
    ...overrides,
  };
}

describe('GET /invoices — provider-backed, DB-served invoice history', () => {
  it('200 maps stored rows to the neutral shape (id=uuid) and passes the opaque nextCursor through', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({
      rows: [rawRow(), rawRow({ id: 'aaaa1111-1111-4111-8111-111111111111', number: null })],
      nextCursor: 'b3BhcXVlLWN1cnNvcg==',
    });
    const { app, stubs } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any,
      },
    });

    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBe('b3BhcXVlLWN1cnNvcg==');
    expect(res.body.invoices).toHaveLength(2);
    expect(res.body.invoices[0]).toEqual({
      id: '99999999-9999-4999-8999-999999999999', // OUR uuid, not in_...
      number: 'INV-0001',
      created: '2023-11-14T22:13:20.000Z',
      amountDue: 900,
      amountPaid: 900,
      currency: 'usd',
      status: 'paid',
      hostedInvoiceUrl: 'https://invoice.provider/i/in_1',
      invoicePdf: 'https://invoice.provider/i/in_1.pdf',
    });
    expect(res.body.invoices[1].number).toBeNull();

    expect(stubs.customerRepo.findByEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(listByCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'localcust_1', limit: 20 }),
    );
  });

  it('200 empty list when the entity has no billing customer (not an error)', async () => {
    const listByCustomer = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      // default customerRepo.findByEntity resolves null.
      stubs: { invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invoices: [], nextCursor: null });
    expect(listByCustomer).not.toHaveBeenCalled();
  });

  it('401 when the proxy actor-context headers are absent', async () => {
    const listByCustomer = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any,
      },
    });
    const res = await request(app)
      .get(URL)
      .set(...authHeader()); // valid token, NO actor headers
    expect(res.status).toBe(401);
    expect(listByCustomer).not.toHaveBeenCalled();
  });

  it('401 when the internal token is missing', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerRepoStub() },
    });
    const res = await request(app).get(URL).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(401);
  });

  it('clamps limit: over-max -> 100, under-min -> 1, non-numeric -> default 20', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({ rows: [rawRow()], nextCursor: null });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any,
      },
    });

    await request(app).get(`${URL}?limit=9999`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(listByCustomer.mock.calls[0][0].limit).toBe(100);

    await request(app).get(`${URL}?limit=0`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(listByCustomer.mock.calls[1][0].limit).toBe(1);

    await request(app).get(`${URL}?limit=abc`).set(...authHeader()).set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(listByCustomer.mock.calls[2][0].limit).toBe(20);
  });

  it('passes the opaque cursor through to the repository', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({ rows: [rawRow()], nextCursor: null });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any,
      },
    });
    await request(app)
      .get(`${URL}?cursor=b3BhcXVl`)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(listByCustomer.mock.calls[0][0]).toEqual(
      expect.objectContaining({ cursor: 'b3BhcXVl' }),
    );
  });

  it('lazily syncs once from the provider when a known customer has an empty store, then reads', async () => {
    const upsertFromProvider = jest.fn().mockResolvedValue(undefined);
    // First read empty (triggers sync), second read returns the synced row.
    const listByCustomer = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], nextCursor: null })
      .mockResolvedValueOnce({ rows: [rawRow()], nextCursor: null });
    const list = jest.fn().mockResolvedValue({ data: [rawStripeInvoice()], has_more: false });

    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        ...stripeStub(list),
        invoiceRepo: { upsertFromProvider, listByCustomer } as any,
      },
    });

    const res = await request(app)
      .get(URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    // provider.listInvoices -> stripe.invoices.list with the customer id.
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_org_1' }));
    expect(upsertFromProvider).toHaveBeenCalledTimes(1);
    expect(listByCustomer).toHaveBeenCalledTimes(2); // empty read, then post-sync read
    expect(res.body.invoices).toHaveLength(1);
  });

  it('maps a provider error thrown during the lazy sync to its status (502)', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({ rows: [], nextCursor: null });
    const list = jest.fn().mockRejectedValue(new Error('provider boom'));
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        ...stripeStub(list),
        invoiceRepo: { upsertFromProvider: jest.fn(), listByCustomer } as any,
      },
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
});

describe('POST /invoices/sync — force a provider→store resync', () => {
  it('200 {synced} counts the upserted invoices for the authorized entity', async () => {
    const upsertFromProvider = jest.fn().mockResolvedValue(undefined);
    const list = jest.fn().mockResolvedValue({
      data: [rawStripeInvoice({ id: 'in_1' }), rawStripeInvoice({ id: 'in_2' })],
      has_more: false,
    });
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: {
        ...orgCustomerRepoStub(),
        ...stripeStub(list),
        invoiceRepo: { upsertFromProvider, listByCustomer: jest.fn() } as any,
      },
    });

    const res = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synced: 2 });
    expect(upsertFromProvider).toHaveBeenCalledTimes(2);
  });

  it('200 {synced:0} when the entity has no billing customer', async () => {
    const upsertFromProvider = jest.fn();
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { invoiceRepo: { upsertFromProvider, listByCustomer: jest.fn() } as any },
    });
    const res = await request(app)
      .post(SYNC_URL)
      .set(...authHeader())
      .set(actorOrgHeaders(ORG_ID, USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synced: 0 });
    expect(upsertFromProvider).not.toHaveBeenCalled();
  });

  it('401 when the proxy actor-context headers are absent', async () => {
    const { app } = buildApp({
      internalToken: INTERNAL_TOKEN,
      stubs: { ...orgCustomerRepoStub() },
    });
    const res = await request(app).post(SYNC_URL).set(...authHeader());
    expect(res.status).toBe(401);
  });
});
