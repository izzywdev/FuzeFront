import { z } from 'zod';

export const billingLlmUsageSchemaV1 = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  model: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  conversationId: z.string().uuid(),
  timestamp: z.string().datetime(),
});

export type BillingLlmUsagePayloadV1 = z.infer<typeof billingLlmUsageSchemaV1>;
