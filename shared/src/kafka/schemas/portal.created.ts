import { z } from 'zod';

/**
 * FF-EPIC-09-S2 — emitted once the resumable portal provisioning pipeline has
 * finished every infrastructure step (org, Permit tenant, portal row, default
 * subdomain) and attempted the owner invite — REGARDLESS of whether the
 * invite dispatch itself succeeded (AC4: a failed invite still leaves the
 * portal `provisioned-pending-invite` and still emits this event, so a
 * downstream consumer can retry the notification independently of the
 * synchronous create-portal HTTP response).
 */
export const portalCreatedSchemaV1 = z.object({
  portalId: z.string(),
  slug: z.string(),
  organizationId: z.string().uuid(),
  ownerEmail: z.string().email(),
  status: z.enum(['provisioning', 'provisioned-pending-invite', 'active', 'suspended']),
});

export type PortalCreatedPayloadV1 = z.infer<typeof portalCreatedSchemaV1>;
