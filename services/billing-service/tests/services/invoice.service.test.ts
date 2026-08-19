/**
 * Unit tests for InvoiceService (vendor-neutral, DB-backed invoice read/sync).
 *
 * Fakes the customerRepo, invoiceRepo, and PaymentProvider port so no DB/Stripe
 * is touched. Covers: no-customer empty result; store-hit read (no sync); the
 * lazy sync-once-then-read path on an empty store; page-2 (cursor) never syncs;
 * multi-page syncCustomer counting + startingAfter threading; syncEntity.
 */
import { InvoiceService } from '../../src/services/invoice.service';
import { ProviderInvoice } from '../../src/providers/payment-provider';
import { InvoiceRow } from '../../src/repositories/invoice.repository';

const CUSTOMER = {
  id: 'cust_1',
  entityType: 'organization' as const,
  entityId: '33333333-3333-4333-8333-333333333333',
  stripeCustomerId: 'cus_org_1',
};

const ENTITY = { entityType: 'organization' as const, entityId: CUSTOMER.entityId };

function providerInvoice(id: string): ProviderInvoice {
  return {
    providerInvoiceId: id,
    number: `NUM-${id}`,
    status: 'paid',
    amountDueCents: 100,
    amountPaidCents: 100,
    currency: 'usd',
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    issuedAt: new Date('2023-11-14T22:13:20.000Z'),
  };
}

function row(id: string): InvoiceRow {
  return {
    id,
    customer_id: 'cust_1',
    provider: 'stripe',
    provider_invoice_id: `in_${id}`,
    number: `NUM-${id}`,
    status: 'paid',
    amount_due_cents: 100,
    amount_paid_cents: 100,
    currency: 'usd',
    hosted_invoice_url: null,
    invoice_pdf_url: null,
    issued_at: new Date('2023-11-14T22:13:20.000Z'),
    created_at: new Date('2023-11-14T22:13:20.000Z'),
    updated_at: new Date('2023-11-14T22:13:20.000Z'),
  };
}

function makeDeps(over: {
  findByEntity?: jest.Mock;
  listByCustomer?: jest.Mock;
  upsertFromProvider?: jest.Mock;
  listInvoices?: jest.Mock;
} = {}) {
  const customerRepo = {
    findByEntity: over.findByEntity ?? jest.fn().mockResolvedValue(CUSTOMER),
    findByStripeCustomerId: jest.fn(),
    insert: jest.fn(),
  };
  const invoiceRepo = {
    upsertFromProvider: over.upsertFromProvider ?? jest.fn().mockResolvedValue(undefined),
    listByCustomer: over.listByCustomer ?? jest.fn().mockResolvedValue({ rows: [], nextCursor: null }),
  };
  const provider = {
    name: 'stripe',
    listInvoices: over.listInvoices ?? jest.fn().mockResolvedValue({ invoices: [], hasMore: false }),
    parseInvoiceEvent: jest.fn(),
  };
  const service = new InvoiceService({
    customerRepo: customerRepo as any,
    invoiceRepo: invoiceRepo as any,
    provider: provider as any,
  });
  return { service, customerRepo, invoiceRepo, provider };
}

describe('InvoiceService.list', () => {
  it('returns an empty list without touching the store/provider when there is no customer', async () => {
    const { service, invoiceRepo, provider } = makeDeps({
      findByEntity: jest.fn().mockResolvedValue(null),
    });
    const res = await service.list(ENTITY, { limit: 20 });
    expect(res).toEqual({ invoices: [], nextCursor: null });
    expect(invoiceRepo.listByCustomer).not.toHaveBeenCalled();
    expect(provider.listInvoices).not.toHaveBeenCalled();
  });

  it('reads the store and does NOT sync when rows already exist', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({ rows: [row('a')], nextCursor: 'cur' });
    const { service, provider } = makeDeps({ listByCustomer });
    const res = await service.list(ENTITY, { limit: 20 });
    expect(res.invoices).toHaveLength(1);
    expect(res.invoices[0].id).toBe('a');
    expect(res.nextCursor).toBe('cur');
    expect(listByCustomer).toHaveBeenCalledTimes(1);
    expect(provider.listInvoices).not.toHaveBeenCalled();
  });

  it('lazily syncs once then re-reads when a known customer has an empty store (page 1)', async () => {
    const listByCustomer = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], nextCursor: null })
      .mockResolvedValueOnce({ rows: [row('a')], nextCursor: null });
    const listInvoices = jest.fn().mockResolvedValue({ invoices: [providerInvoice('a')], hasMore: false });
    const upsertFromProvider = jest.fn().mockResolvedValue(undefined);
    const { service } = makeDeps({ listByCustomer, listInvoices, upsertFromProvider });

    const res = await service.list(ENTITY, { limit: 20 });

    expect(listInvoices).toHaveBeenCalledWith('cus_org_1', expect.objectContaining({ limit: 100 }));
    expect(upsertFromProvider).toHaveBeenCalledTimes(1);
    expect(listByCustomer).toHaveBeenCalledTimes(2);
    expect(res.invoices).toHaveLength(1);
  });

  it('does NOT sync on a later page (cursor present) even if the read is empty', async () => {
    const listByCustomer = jest.fn().mockResolvedValue({ rows: [], nextCursor: null });
    const { service, provider } = makeDeps({ listByCustomer });
    const res = await service.list(ENTITY, { limit: 20, cursor: 'some-cursor' });
    expect(res).toEqual({ invoices: [], nextCursor: null });
    expect(provider.listInvoices).not.toHaveBeenCalled();
    expect(listByCustomer).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceService.syncCustomer', () => {
  it('pages the provider, upserts each invoice, threads startingAfter, and returns the count', async () => {
    const listInvoices = jest
      .fn()
      .mockResolvedValueOnce({ invoices: [providerInvoice('a'), providerInvoice('b')], hasMore: true })
      .mockResolvedValueOnce({ invoices: [providerInvoice('c')], hasMore: false });
    const upsertFromProvider = jest.fn().mockResolvedValue(undefined);
    const { service } = makeDeps({ listInvoices, upsertFromProvider });

    const count = await service.syncCustomer(CUSTOMER as any);

    expect(count).toBe(3);
    expect(upsertFromProvider).toHaveBeenCalledTimes(3);
    // Second page requests startingAfter = last id of the first page ('b').
    expect(listInvoices.mock.calls[1][1]).toEqual(
      expect.objectContaining({ startingAfter: 'b' }),
    );
  });
});

describe('InvoiceService.syncEntity', () => {
  it('returns 0 when the entity has no customer', async () => {
    const { service, provider } = makeDeps({ findByEntity: jest.fn().mockResolvedValue(null) });
    await expect(service.syncEntity(ENTITY)).resolves.toBe(0);
    expect(provider.listInvoices).not.toHaveBeenCalled();
  });

  it('resolves the customer and syncs', async () => {
    const listInvoices = jest.fn().mockResolvedValue({ invoices: [providerInvoice('a')], hasMore: false });
    const { service } = makeDeps({ listInvoices });
    await expect(service.syncEntity(ENTITY)).resolves.toBe(1);
  });
});
