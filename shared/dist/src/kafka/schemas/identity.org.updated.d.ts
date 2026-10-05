import { z } from 'zod';
/**
 * Emitted when an organization's mutable fields (name, slug, settings,
 * metadata) change. Carries the full post-update snapshot so consumers can
 * re-seed idempotently — see `organizationSnapshotV1`.
 */
export declare const identityOrgUpdatedSchemaV1: any;
export type IdentityOrgUpdatedPayloadV1 = z.infer<typeof identityOrgUpdatedSchemaV1>;
