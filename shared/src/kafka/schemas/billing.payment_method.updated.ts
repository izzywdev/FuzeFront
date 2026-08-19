import { z } from 'zod';

export const billingPaymentMethodUpdatedSchemaV1 = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['user', 'organization']),
  stripeCustomerId: z.string(),
  paymentMethodId: z.string(),
  /** e.g. 'visa', 'mastercard' — omitted for non-card payment methods. */
  brand: z.string().optional(),
  last4: z.string().optional(),
});

export type BillingPaymentMethodUpdatedPayloadV1 = z.infer<
  typeof billingPaymentMethodUpdatedSchemaV1
>;
