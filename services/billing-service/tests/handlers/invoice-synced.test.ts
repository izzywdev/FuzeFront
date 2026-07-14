/**
 * Unit tests for the invoice-synced webhook handler — persists invoice.* events
 * into billing.invoices via the neutral provider port + invoiceRepo.
 *
 * Also asserts the webhook-router wires the five invoice events to it, and that
 * the succeeded/failed events STILL run their existing entitlement/notify
 * handler alongside persistence.
 */
import { handleInvoiceSynced } from '../../src/handlers/invoice-synced';
import { HANDLERS, routeWebhookEvent } from '../../src/handlers/webhook-router';
import { ProviderInvoice } from '../../src/providers/payment-provider';

function providerInvoice(): ProviderInvoice {
  return {
    providerInvoiceId: 'in_1',
    number: 'INV-0001',
    status: 'paid',
    amountDueCents: 900,
    amountPaidCents: 900,
    currency: 'usd',
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    issuedAt: new Date('2023-11-14T22:13:20.000Z'),
  };
}

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: '33333333-3333-4333-8333-333333333333',
        stripeCustomerId: 'cus_1',
      }),
    },
    invoiceRepo: { upsertFromProvider: jest.fn().mockResolvedValue(undefined) },
    provider: {
      name: 'stripe',
      parseInvoiceEvent: jest.fn().mockReturnValue({ providerCustomerId: 'cus_1', invoice: providerInvoice() }),
      listInvoices: jest.fn(),
    },
    ...over,
  } as any;
}

const EVENT = { type: 'invoice.paid', data: { object: { object: 'invoice', id: 'in_1' } } } as any;

describe('handleInvoiceSynced', () => {
  it('resolves the customer by provider customer id and upserts the neutral invoice', async () => {
    const ctx = makeCtx();
    await handleInvoiceSynced(EVENT, ctx);
    expect(ctx.provider.parseInvoiceEvent).toHaveBeenCalledWith(EVENT);
    expect(ctx.customers.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(ctx.invoiceRepo.upsertFromProvider).toHaveBeenCalledWith('localcust_1', providerInvoice());
  });

  it('no-ops when the provider/invoiceRepo are not wired', async () => {
    const ctx = makeCtx({ provider: undefined, invoiceRepo: undefined });
    await expect(handleInvoiceSynced(EVENT, ctx)).resolves.toBeUndefined();
  });

  it('no-ops (does not upsert) when the event is not a parseable invoice', async () => {
    const ctx = makeCtx();
    ctx.provider.parseInvoiceEvent.mockReturnValue(null);
    await handleInvoiceSynced(EVENT, ctx);
    expect(ctx.invoiceRepo.upsertFromProvider).not.toHaveBeenCalled();
  });

  it('no-ops (does not upsert) when no local customer matches', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleInvoiceSynced(EVENT, ctx);
    expect(ctx.invoiceRepo.upsertFromProvider).not.toHaveBeenCalled();
  });
});

describe('webhook-router — invoice event wiring', () => {
  it('maps all five invoice events to a handler', () => {
    for (const t of [
      'invoice.paid',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'invoice.finalized',
      'invoice.updated',
    ]) {
      expect(HANDLERS[t]).toBeDefined();
    }
  });

  it('invoice.payment_succeeded persists AND runs the entitlement/notify path', async () => {
    const ctx = makeCtx({
      subscriptions: { findByCustomer: jest.fn().mockResolvedValue({ planTier: 'pro', subscriptionId: 'sub_1' }) },
      permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
      emitter: { subscriptionChanged: jest.fn().mockResolvedValue(undefined) },
      writePlanCache: jest.fn().mockResolvedValue(undefined),
    });
    await routeWebhookEvent(
      { type: 'invoice.payment_succeeded', data: { object: { object: 'invoice', id: 'in_1', customer: 'cus_1' } } } as any,
      ctx,
    );
    expect(ctx.invoiceRepo.upsertFromProvider).toHaveBeenCalledTimes(1); // persisted
    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalled(); // notify/entitlement still fires
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalled();
  });

  it('invoice.payment_failed persists AND runs the dunning path', async () => {
    const ctx = makeCtx({
      subscriptions: { findByCustomer: jest.fn().mockResolvedValue({ planTier: 'pro' }) },
      permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
      emitter: { paymentFailed: jest.fn().mockResolvedValue(undefined) },
      writePlanCache: jest.fn().mockResolvedValue(undefined),
    });
    await routeWebhookEvent(
      {
        type: 'invoice.payment_failed',
        data: { object: { object: 'invoice', id: 'in_1', customer: 'cus_1', amount_due: 900, currency: 'usd' } },
      } as any,
      ctx,
    );
    expect(ctx.invoiceRepo.upsertFromProvider).toHaveBeenCalledTimes(1);
    expect(ctx.emitter.paymentFailed).toHaveBeenCalled();
  });
});
