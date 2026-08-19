import { z } from 'zod';

export const billingSubscriptionChangedSchemaV1 = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['user', 'organization']),
  planTier: z.string(),
  /** Mirrors Stripe subscription status values (active, trialing, past_due, canceled, etc.) */
  status: z.string(),
  seatQuantity: z.number().int().optional(),
  stripeSubscriptionId: z.string(),
});

export type BillingSubscriptionChangedPayloadV1 = z.infer<
  typeof billingSubscriptionChangedSchemaV1
>;
