import { z } from 'zod';

export const SUPPORTED_TEMPLATES = ['welcome', 'org-invite', 'membership-change'] as const;

export const notifyEmailRequestedSchemaV1 = z.object({
  to: z.string().email(),
  template: z.enum(SUPPORTED_TEMPLATES),
  vars: z.record(z.string(), z.unknown()),
  orgId: z.string().optional(),
  correlationId: z.string(),
});

export type NotifyEmailRequestedPayloadV1 = z.infer<typeof notifyEmailRequestedSchemaV1>;
