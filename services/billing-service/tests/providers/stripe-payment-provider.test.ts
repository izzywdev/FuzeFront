/**
 * Unit tests for StripePaymentProvider (the vendor adapter for the neutral port).
 *
 * Verifies the exact Stripe.Invoice -> ProviderInvoice field mapping, the
 * listInvoices paging call (customer/limit/starting_after) with hooks firing
 * around it, parseInvoiceEvent extraction, and that onError fires + rethrows.
 */
import {
  StripePaymentProvider,
  mapStripeInvoice,
} from '../../src/providers/stripe/stripe-payment-provider';

function stripeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    object: 'invoice',
    number: 'INV-0001',
    created: 1_700_000_000, // 2023-11-14T22:13:20.000Z
    amount_due: 900,
    amount_paid: 900,
    currency: 'USD',
    status: 'paid',
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
    invoice_pdf: 'https://invoice.stripe.com/i/in_1.pdf',
    customer: 'cus_1',
    ...overrides,
  } as any;
}

describe('mapStripeInvoice', () => {
  it('maps every field to the neutral ProviderInvoice (cents, lowercased ccy, Date)', () => {
    expect(mapStripeInvoice(stripeInvoice())).toEqual({
      providerInvoiceId: 'in_1',
      number: 'INV-0001',
      status: 'paid',
      amountDueCents: 900,
      amountPaidCents: 900,
      currency: 'usd',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      invoicePdfUrl: 'https://invoice.stripe.com/i/in_1.pdf',
      issuedAt: new Date('2023-11-14T22:13:20.000Z'),
    });
  });

  it('defaults null number/urls and status=draft', () => {
    const mapped = mapStripeInvoice(
      stripeInvoice({ number: null, hosted_invoice_url: null, invoice_pdf: null, status: null }),
    );
    expect(mapped.number).toBeNull();
    expect(mapped.hostedInvoiceUrl).toBeNull();
    expect(mapped.invoicePdfUrl).toBeNull();
    expect(mapped.status).toBe('draft');
  });
});

describe('StripePaymentProvider.listInvoices', () => {
  it('calls stripe.invoices.list with customer/limit and maps the page + hasMore', async () => {
    const list = jest
      .fn()
      .mockResolvedValue({ data: [stripeInvoice(), stripeInvoice({ id: 'in_2' })], has_more: true });
    const provider = new StripePaymentProvider({ invoices: { list } } as any);

    const page = await provider.listInvoices('cus_1', { limit: 20 });

    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 20 });
    expect(page.hasMore).toBe(true);
    expect(page.invoices.map((i) => i.providerInvoiceId)).toEqual(['in_1', 'in_2']);
  });

  it('threads startingAfter -> starting_after', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], has_more: false });
    const provider = new StripePaymentProvider({ invoices: { list } } as any);
    await provider.listInvoices('cus_1', { limit: 5, startingAfter: 'in_prev' });
    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 5, starting_after: 'in_prev' });
  });

  it('fires onBeforeCall/onAfterCall around a successful call', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], has_more: false });
    const onBeforeCall = jest.fn();
    const onAfterCall = jest.fn();
    const onError = jest.fn();
    const provider = new StripePaymentProvider({ invoices: { list } } as any, {
      onBeforeCall,
      onAfterCall,
      onError,
    });
    await provider.listInvoices('cus_1', { limit: 20 });
    expect(onBeforeCall).toHaveBeenCalledWith('listInvoices', expect.objectContaining({ providerCustomerId: 'cus_1' }));
    expect(onAfterCall).toHaveBeenCalledWith('listInvoices', expect.any(Object));
    expect(onError).not.toHaveBeenCalled();
  });

  it('fires onError and rethrows when the vendor call fails', async () => {
    const boom = new Error('stripe down');
    const list = jest.fn().mockRejectedValue(boom);
    const onError = jest.fn();
    const provider = new StripePaymentProvider({ invoices: { list } } as any, { onError });
    await expect(provider.listInvoices('cus_1', { limit: 20 })).rejects.toThrow('stripe down');
    expect(onError).toHaveBeenCalledWith('listInvoices', boom, expect.any(Object));
  });
});

describe('StripePaymentProvider.parseInvoiceEvent', () => {
  it('extracts {providerCustomerId, invoice} from an invoice event', () => {
    const provider = new StripePaymentProvider({ invoices: { list: jest.fn() } } as any);
    const parsed = provider.parseInvoiceEvent({
      type: 'invoice.paid',
      data: { object: stripeInvoice({ customer: 'cus_9' }) },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.providerCustomerId).toBe('cus_9');
    expect(parsed!.invoice.providerInvoiceId).toBe('in_1');
  });

  it('resolves an expanded customer object to its id', () => {
    const provider = new StripePaymentProvider({ invoices: { list: jest.fn() } } as any);
    const parsed = provider.parseInvoiceEvent({
      type: 'invoice.updated',
      data: { object: stripeInvoice({ customer: { id: 'cus_expanded' } }) },
    });
    expect(parsed!.providerCustomerId).toBe('cus_expanded');
  });

  it('returns null for a non-invoice event or a customer-less invoice', () => {
    const provider = new StripePaymentProvider({ invoices: { list: jest.fn() } } as any);
    expect(
      provider.parseInvoiceEvent({ type: 'charge.refunded', data: { object: { object: 'charge' } } }),
    ).toBeNull();
    expect(
      provider.parseInvoiceEvent({ type: 'invoice.paid', data: { object: stripeInvoice({ customer: null }) } }),
    ).toBeNull();
  });
});
