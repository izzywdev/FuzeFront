import { z } from 'zod';

export const billingPaymentFailedSchemaV1 = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['user', 'organization']),
  /** Stripe invoice ID (e.g. 'in_1AbcDef...'). */
  invoiceId: z.string(),
  /** Amount due in the currency's minor unit (cents for USD). */
  amountDue: z.number().int().nonnegative(),
  /** ISO-4217 lowercase currency code (e.g. 'usd'). */
  currency: z.string().min(3).max(3),
});

export type BillingPaymentFailedPayloadV1 = z.infer<typeof billingPaymentFailedSchemaV1>;
