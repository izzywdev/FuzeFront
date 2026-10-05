import { z } from 'zod';
/**
 * Snapshot of an organization carried by the created/updated lifecycle events
 * (event-carried state transfer): a consumer can seed its own per-org state
 * from the event alone, without calling back to the source service.
 *
 * `ownerId` / `parentId` are nullable because the seeded root/platform org has
 * no owner and no parent.
 */
export declare const organizationSnapshotV1: any;
export declare const identityOrgCreatedSchemaV1: any;
export type IdentityOrgCreatedPayloadV1 = z.infer<typeof identityOrgCreatedSchemaV1>;
