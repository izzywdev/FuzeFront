import type { Knex } from 'knex';
/** Full DB row shape (internal use only — includes token_hash). */
interface ApiTokenDbRow {
    id: string;
    token_prefix: string;
    token_hash: string;
    owner_type: 'user' | 'org';
    owner_id: string;
    name: string;
    scopes: string[] | string;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_by: string | null;
    revoked_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
/** Public token row — token_hash is omitted; scopes is always string[]. */
export type ApiTokenRow = Omit<ApiTokenDbRow, 'token_hash' | 'scopes'> & {
    scopes: string[];
};
/**
 * Discriminated union returned by verifyToken.
 * - 'valid'   : token authenticated; row attached (token_hash excluded from row)
 * - 'revoked' : prefix found but token was revoked
 * - 'expired' : prefix found but token is past expires_at
 * - 'invalid' : token could not be parsed, prefix not found, or hash mismatch
 */
export type VerifyResult = {
    status: 'valid';
    token: ApiTokenRow;
} | {
    status: 'revoked';
} | {
    status: 'expired';
} | {
    status: 'invalid';
};
/**
 * Encode a Buffer as a base62 string.
 * Interprets the buffer bytes as a big-endian unsigned integer, then converts
 * to base62. Left-pads / right-truncates to exactly `targetLen` characters.
 */
export declare function encodeBase62(buf: Buffer, targetLen: number): string;
/**
 * Generate a new API token.
 * Returns the raw token (shown once), the token_prefix (safe to store/log),
 * and the token_hash (sha256 of prefix.body, stored in DB).
 */
export declare function generateToken(): {
    raw: string;
    prefix: string;
    hash: string;
};
/**
 * Compute SHA-256 hex hash of a "prefix.body" string (WITHOUT the ff_live_ header).
 */
export declare function hashToken(prefixDotBody: string): string;
/**
 * Parse a raw ff_live_ token into its prefix and body parts.
 * Returns null if the token does not match the expected shape.
 */
export declare function extractParts(rawToken: string): {
    prefix: string;
    body: string;
} | null;
/**
 * Create a new API token and persist it to the database.
 * The raw token is returned ONCE; only the prefix and hash are stored.
 */
export declare function createToken(params: {
    name: string;
    ownerType: 'user' | 'org';
    ownerId: string;
    scopes: string[];
    expiresAt: Date | null;
    createdBy: string;
}, dbInstance?: Knex): Promise<{
    id: string;
    token: string;
    token_prefix: string;
    name: string;
    scopes: string[];
    expires_at: Date | null;
    created_at: Date;
}>;
/**
 * Verify a raw API token.
 * Returns a VerifyResult discriminated union:
 *   - 'invalid'  : unparseable / unknown prefix / hash mismatch
 *   - 'revoked'  : token was revoked
 *   - 'expired'  : token is past expires_at
 *   - 'valid'    : token authenticated; attached row excludes token_hash
 */
export declare function verifyToken(rawToken: string, dbInstance?: Knex): Promise<VerifyResult>;
/**
 * Revoke a token by id.
 * Sets revoked_at on the row if it is not already revoked.
 * Returns true if a row was updated, false otherwise.
 */
export declare function revokeToken(tokenId: string, dbInstance?: Knex): Promise<boolean>;
/**
 * List all tokens for an owner (user or org).
 * Excludes token_hash. Returns all rows (active + revoked) ordered by created_at desc.
 */
export declare function listTokensForOwner(ownerType: 'user' | 'org', ownerId: string, dbInstance?: Knex): Promise<ApiTokenRow[]>;
/**
 * Fetch a single token row by id.
 * Excludes token_hash. Returns null if not found.
 */
export declare function getTokenById(tokenId: string, dbInstance?: Knex): Promise<ApiTokenRow | null>;
/**
 * Update the last_used_at timestamp for a token.
 * Fire-and-forget: callers may choose not to await this.
 */
export declare function updateLastUsed(tokenId: string, dbInstance?: Knex): Promise<void>;
/**
 * Map a set of scopes to the MINIMAL Permit role whose permission set is a
 * superset of all requested scopes.
 *
 * Algorithm:
 *   viewer  — if every scope is in viewer's permission set
 *   editor  — else if every scope is in editor's permission set
 *   admin   — otherwise
 *
 * Permission sets are imported from permit/schema.ts to stay in sync with
 * any future schema changes.
 */
export declare function mapScopesToPermitRole(scopes: string[]): 'viewer' | 'editor' | 'admin';
export {};
//# sourceMappingURL=api-token.d.ts.map