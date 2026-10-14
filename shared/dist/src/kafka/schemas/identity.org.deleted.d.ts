import { z } from 'zod';
/**
 * Emitted when an organization is deleted. Thin payload: consumers tear their
 * own per-org state down from the id. `cascade` distinguishes a soft delete
 * (deactivation — `organizations.is_active = false`, the current behaviour) from
 * a hard delete (row removed); consumers deactivate vs. purge accordingly.
 */
export declare const identityOrgDeletedSchemaV1: any;
export type IdentityOrgDeletedPayloadV1 = z.infer<typeof identityOrgDeletedSchemaV1>;
