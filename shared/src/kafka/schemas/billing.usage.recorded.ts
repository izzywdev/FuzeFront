import { z } from 'zod';

export const billingUsageRecordedSchemaV1 = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['user', 'organization']),
  meterEventName: z.string(),
  quantity: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

export type BillingUsageRecordedPayloadV1 = z.infer<typeof billingUsageRecordedSchemaV1>;
