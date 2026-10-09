import { z } from 'zod';

/**
 * Snapshot of an organization carried by the created/updated lifecycle events
 * (event-carried state transfer): a consumer can seed its own per-org state
 * from the event alone, without calling back to the source service.
 *
 * `ownerId` / `parentId` are nullable because the seeded root/platform org has
 * no owner and no parent.  Arbitrary `settings` and `metadata` are deliberately
 * excluded: they are not an event contract, may contain tenant-private values,
 * and must be read through FuzeFront's authorized API when needed.
 */
export const organizationSnapshotV1 = z.object({
  organizationId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(['platform', 'organization', 'personal']),
  parentId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

export const identityOrgCreatedSchemaV1 = organizationSnapshotV1;

export type IdentityOrgCreatedPayloadV1 = z.infer<typeof identityOrgCreatedSchemaV1>;
