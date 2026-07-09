import { z } from 'zod';

/**
 * Emitted when an app is registered in the app registry.
 * Durable, cross-service successor to the legacy Socket.io `app-registered` emit.
 */
export const appRegisteredSchemaV1 = z.object({
  slug: z.string(),
  name: z.string(),
  mode: z.enum(['portal', 'standalone']),
  integrationType: z.enum(['module-federation', 'iframe', 'web-component', 'spa']),
  builtin: z.boolean(),
  organizationId: z.string().uuid().nullable().optional(),
  /** ISO-8601 registration timestamp */
  registeredAt: z.string().datetime(),
});

export type AppRegisteredPayloadV1 = z.infer<typeof appRegisteredSchemaV1>;
