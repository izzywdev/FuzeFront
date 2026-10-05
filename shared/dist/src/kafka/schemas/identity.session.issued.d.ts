import { z } from 'zod';
/**
 * Topic: `identity.session.issued`
 * Emitted when the identity service issues an auth session token for a
 * principal (local login or OIDC callback). Part of the @fuzefront/auth
 * contract (#117): consumers can react to sessions without parsing tokens.
 *
 * NOTE: never carries the token itself — only non-secret session metadata.
 */
export declare const identitySessionIssuedSchemaV1: any;
export type IdentitySessionIssuedPayloadV1 = z.infer<typeof identitySessionIssuedSchemaV1>;
