import { z } from 'zod';

/**
 * A small, tenant-scoped authorization invalidation signal.
 *
 * It deliberately carries neither Permit/OPAL policy source nor a permission
 * set. Those are security-sensitive implementation details and consumers must
 * obtain an allowed subject's current grants through FuzeFront instead.  The
 * event's sole purpose is to let an authorized consumer invalidate materialized
 * access decisions after a membership/role change.
 */
export const identityAuthorizationChangedSchemaV1 = z.object({
  organizationId: z.string().uuid(),
  subjectId: z.string().uuid(),
  change: z.enum(['membership_added', 'membership_removed', 'membership_role_changed']),
  /** The post-change role when one exists; omitted after removal. */
  role: z.string().min(1).max(64).optional(),
});

export type IdentityAuthorizationChangedPayloadV1 = z.infer<typeof identityAuthorizationChangedSchemaV1>;
