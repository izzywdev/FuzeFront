import { z } from 'zod';

/**
 * Emitted when an app transitions to `suspended` (hidden from the menu, retained).
 */
export const appSuspendedSchemaV1 = z.object({
  slug: z.string(),
  organizationId: z.string().uuid().nullable().optional(),
  actorUserId: z.string().uuid().optional(),
  suspendedAt: z.string().datetime(),
});

export type AppSuspendedPayloadV1 = z.infer<typeof appSuspendedSchemaV1>;
