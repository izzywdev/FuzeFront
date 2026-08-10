import { z } from 'zod';
import { organizationSnapshotV1 } from './identity.org.created';

/**
 * Emitted when an organization's mutable fields (name, slug, settings,
 * metadata) change. Carries the full post-update snapshot so consumers can
 * re-seed idempotently — see `organizationSnapshotV1`.
 */
export const identityOrgUpdatedSchemaV1 = organizationSnapshotV1;

export type IdentityOrgUpdatedPayloadV1 = z.infer<typeof identityOrgUpdatedSchemaV1>;
