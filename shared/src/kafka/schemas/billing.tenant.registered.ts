import { z } from 'zod';

export const billingTenantRegisteredSchemaV1 = z.object({
  entityId: z.string().uuid(),
  /** Always 'organization' — a new corporate tenant, not a personal account. */
  entityType: z.literal('organization'),
  stripeCustomerId: z.string(),
});

export type BillingTenantRegisteredPayloadV1 = z.infer<
  typeof billingTenantRegisteredSchemaV1
>;
