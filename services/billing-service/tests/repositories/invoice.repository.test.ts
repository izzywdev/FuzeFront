/**
 * Unit tests for PgInvoiceRepository against a fake pg.Pool (no live Postgres).
 *
 * Covers the two behaviours the invoice slice depends on:
 *   - upsertFromProvider issues an INSERT ... ON CONFLICT (provider,
 *     provider_invoice_id) DO UPDATE with the mapped column values.
 *   - listByCustomer does keyset pagination on (issued_at DESC, id DESC),
 *     fetching limit+1 to derive an OPAQUE base64 `${issued_at_iso}|${id}`
 *     nextCursor, and threads a decoded cursor into the row-value predicate.
 */
import {
  PgInvoiceRepository,
  encodeInvoiceCursor,
  decodeInvoiceCursor,
  mapInvoiceRow,
  InvoiceRow,
} from '../../src/repositories/invoice.repository';
import { ProviderInvoice } from '../../src/providers/payment-provider';

function fakePool(queryImpl: jest.Mock) {
  return { query: queryImpl } as any;
}

function providerInvoice(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
  return {
    providerInvoiceId: 'in_1',
    number: 'INV-0001',
    status: 'paid',
    amountDueCents: 900,
    amountPaidCents: 900,
    currency: 'usd',
    hostedInvoiceUrl: 'https://p/i/in_1',
    invoicePdfUrl: 'https://p/i/in_1.pdf',
    issuedAt: new Date('2023-11-14T22:13:20.000Z'),
    ...overrides,
  };
}

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    customer_id: 'cust_1',
    provider: 'stripe',
    provider_invoice_id: 'in_1',
    number: 'INV-0001',
    status: 'paid',
    amount_due_cents: 900,
    amount_paid_cents: 900,
    currency: 'usd',
    hosted_invoice_url: 'https://p/i/in_1',
    invoice_pdf_url: 'https://p/i/in_1.pdf',
    issued_at: new Date('2023-11-14T22:13:20.000Z'),
    created_at: new Date('2023-11-14T22:13:20.000Z'),
    updated_at: new Date('2023-11-14T22:13:20.000Z'),
    ...overrides,
  };
}

describe('encode/decodeInvoiceCursor', () => {
  it('round-trips issued_at + id through opaque base64', () => {
    const iso = '2023-11-14T22:13:20.000Z';
    const id = 'aaaa1111-1111-4111-8111-111111111111';
    const cursor = encodeInvoiceCursor(iso, id);
    // Opaque: not the raw id.
    expect(cursor).not.toContain(id);
    expect(decodeInvoiceCursor(cursor)).toEqual({ issuedAt: iso, id });
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeInvoiceCursor('not-base64-!!')).toBeNull();
    expect(decodeInvoiceCursor(Buffer.from('nopipe').toString('base64'))).toBeNull();
  });
});

describe('mapInvoiceRow', () => {
  it('maps a row to the neutral view (id=our uuid, created=issued_at ISO)', () => {
    expect(mapInvoiceRow(row())).toEqual({
      id: '99999999-9999-4999-8999-999999999999',
      number: 'INV-0001',
      created: '2023-11-14T22:13:20.000Z',
      amountDue: 900,
      amountPaid: 900,
      currency: 'usd',
      status: 'paid',
      hostedInvoiceUrl: 'https://p/i/in_1',
      invoicePdf: 'https://p/i/in_1.pdf',
    });
  });
});

describe('PgInvoiceRepository.upsertFromProvider', () => {
  it('INSERTs with ON CONFLICT (provider, provider_invoice_id) DO UPDATE and the mapped values', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PgInvoiceRepository(fakePool(query));

    await repo.upsertFromProvider('cust_1', providerInvoice());

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO billing\.invoices/);
    expect(sql).toMatch(/ON CONFLICT \(provider, provider_invoice_id\) DO UPDATE/);
    expect(sql).toMatch(/updated_at\s*=\s*now\(\)/);
    // customer_id, provider, provider_invoice_id, number, status, due, paid, ccy, hosted, pdf, issued_at
    expect(params).toEqual([
      'cust_1',
      'stripe',
      'in_1',
      'INV-0001',
      'paid',
      900,
      900,
      'usd',
      'https://p/i/in_1',
      'https://p/i/in_1.pdf',
      new Date('2023-11-14T22:13:20.000Z'),
    ]);
  });

  it('honours a non-default provider name', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PgInvoiceRepository(fakePool(query), 'paddle');
    await repo.upsertFromProvider('cust_1', providerInvoice());
    expect(query.mock.calls[0][1][1]).toBe('paddle');
  });
});

describe('PgInvoiceRepository.listByCustomer — keyset pagination', () => {
  it('orders by (issued_at DESC, id DESC), fetches limit+1, and emits an opaque nextCursor when there is more', async () => {
    const older = row({ id: 'bbbb2222-2222-4222-8222-222222222222', issued_at: new Date('2023-10-01T00:00:00.000Z') });
    // limit=2 -> repo asks for 3; a 3rd row present signals hasMore.
    const query = jest.fn().mockResolvedValue({ rows: [row(), older, row({ id: 'ccc' })] });
    const repo = new PgInvoiceRepository(fakePool(query));

    const res = await repo.listByCustomer({ customerId: 'cust_1', limit: 2 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY issued_at DESC, id DESC/);
    expect(params).toEqual(['cust_1', 3]); // customerId + (limit+1)
    // Only `limit` rows returned; the extra row is dropped.
    expect(res.rows).toHaveLength(2);
    // nextCursor encodes the LAST returned row's (issued_at, id).
    expect(res.nextCursor).toBe(
      encodeInvoiceCursor('2023-10-01T00:00:00.000Z', 'bbbb2222-2222-4222-8222-222222222222'),
    );
  });

  it('returns nextCursor=null on the last page (fewer than limit+1 rows)', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [row()] });
    const repo = new PgInvoiceRepository(fakePool(query));
    const res = await repo.listByCustomer({ customerId: 'cust_1', limit: 20 });
    expect(res.rows).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it('threads a decoded cursor into the (issued_at, id) < (...) predicate', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PgInvoiceRepository(fakePool(query));
    const cursor = encodeInvoiceCursor('2023-10-01T00:00:00.000Z', 'bbbb2222-2222-4222-8222-222222222222');

    await repo.listByCustomer({ customerId: 'cust_1', limit: 20, cursor });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/\(issued_at, id\) < \(\$2::timestamptz, \$3::uuid\)/);
    expect(params).toEqual([
      'cust_1',
      '2023-10-01T00:00:00.000Z',
      'bbbb2222-2222-4222-8222-222222222222',
      21,
    ]);
  });

  it('ignores a malformed cursor (treated as page 1, no keyset predicate)', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PgInvoiceRepository(fakePool(query));
    await repo.listByCustomer({ customerId: 'cust_1', limit: 20, cursor: 'garbage-!!' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/issued_at, id\) </);
    expect(params).toEqual(['cust_1', 21]);
  });
});
