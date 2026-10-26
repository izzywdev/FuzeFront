import { z } from 'zod';
/**
 * Topic: `identity.session.revoked`
 * Emitted when a session is invalidated (logout, admin revoke, rotation).
 * Consumers of @fuzefront/auth (#117) can drop cached identities on revoke.
 */
export declare const identitySessionRevokedSchemaV1: any;
export type IdentitySessionRevokedPayloadV1 = z.infer<typeof identitySessionRevokedSchemaV1>;
