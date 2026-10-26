import { z } from 'zod';
/**
 * Emitted when a user is deleted. Thin payload: consumers delete their own
 * per-user state (Permit user, sessions, user-scoped billing) from the id.
 * `cascade` distinguishes deactivation from hard removal.
 */
export declare const identityUserDeletedSchemaV1: any;
export type IdentityUserDeletedPayloadV1 = z.infer<typeof identityUserDeletedSchemaV1>;
