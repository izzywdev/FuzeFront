import { handlePaymentMethodUpdated } from '../../src/handlers/payment-method-updated';

function makeCtx(overrides: any = {}) {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: 'org-1',
        stripeCustomerId: 'cus_1',
      }),
    },
    emitter: { paymentMethodUpdated: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as any;
}

function paymentMethodEvent(overrides: any = {}) {
  return {
    type: 'payment_method.attached',
    data: {
      object: {
        id: 'pm_1ABC',
        customer: 'cus_1',
        card: { brand: 'visa', last4: '4242' },
        ...overrides,
      },
    },
  } as any;
}

describe('handlePaymentMethodUpdated', () => {
  it('emits paymentMethodUpdated with the resolved entity + card details', async () => {
    const ctx = makeCtx();
    await handlePaymentMethodUpdated(paymentMethodEvent(), ctx);

    expect(ctx.customers.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(ctx.emitter.paymentMethodUpdated).toHaveBeenCalledWith({
      entityId: 'org-1',
      entityType: 'organization',
      stripeCustomerId: 'cus_1',
      paymentMethodId: 'pm_1ABC',
      brand: 'visa',
      last4: '4242',
    });
  });

  it('handles a payment method whose customer is an expanded object', async () => {
    const ctx = makeCtx();
    await handlePaymentMethodUpdated(
      paymentMethodEvent({ customer: { id: 'cus_1' } }),
      ctx,
    );
    expect(ctx.customers.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(ctx.emitter.paymentMethodUpdated).toHaveBeenCalledTimes(1);
  });

  it('omits brand/last4 for a non-card payment method', async () => {
    const ctx = makeCtx();
    await handlePaymentMethodUpdated(paymentMethodEvent({ card: undefined }), ctx);
    expect(ctx.emitter.paymentMethodUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ brand: undefined, last4: undefined }),
    );
  });

  it('no-ops when the payment method has no customer', async () => {
    const ctx = makeCtx();
    await handlePaymentMethodUpdated(paymentMethodEvent({ customer: null }), ctx);
    expect(ctx.emitter.paymentMethodUpdated).not.toHaveBeenCalled();
  });

  it('no-ops when no local customer maps to the Stripe customer', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handlePaymentMethodUpdated(paymentMethodEvent(), ctx);
    expect(ctx.emitter.paymentMethodUpdated).not.toHaveBeenCalled();
  });
});
