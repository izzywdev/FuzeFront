import { z } from 'zod';

/**
 * Emitted when an app transitions to `activated` (becomes visible in the menu).
 */
export const appActivatedSchemaV1 = z.object({
  slug: z.string(),
  organizationId: z.string().uuid().nullable().optional(),
  /** Platform user id that performed the activation */
  actorUserId: z.string().uuid().optional(),
  activatedAt: z.string().datetime(),
});

export type AppActivatedPayloadV1 = z.infer<typeof appActivatedSchemaV1>;
