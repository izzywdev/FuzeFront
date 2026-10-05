import { z } from 'zod';

export const billingTrialEndingSchemaV1 = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['user', 'organization']),
  /** ISO-8601 datetime when the trial period ends. */
  trialEnd: z.string().datetime(),
  /** Stripe / catalogue tier name (e.g. 'professional'). */
  planTier: z.string(),
});

export type BillingTrialEndingPayloadV1 = z.infer<typeof billingTrialEndingSchemaV1>;
