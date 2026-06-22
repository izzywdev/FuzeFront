import { type HttpClientOptions } from './http';
import type { ApiTokenSummary, CreatedApiToken, TokenOwnerType } from '../types';
export interface CreateTokenInput {
    name: string;
    owner_type: TokenOwnerType;
    owner_id: string;
    scopes: string[];
    expires_at: string | null;
    /** Optional org context for PAT scope validation (see backend api-tokens route). */
    org_id?: string;
}
export interface TokensClient {
    listTokens(): Promise<ApiTokenSummary[]>;
    listOrgTokens(orgId: string): Promise<ApiTokenSummary[]>;
    createToken(input: CreateTokenInput): Promise<CreatedApiToken>;
    revokeToken(tokenId: string): Promise<void>;
}
/**
 * Typed wrappers over the backend `/api/tokens` + `/api/organizations/:orgId/tokens`
 * endpoints. List endpoints return `{ tokens: [] }`; create returns the token object
 * directly (with the one-time raw `token`); revoke returns `{ message }`.
 */
export declare function createTokensClient(opts?: HttpClientOptions): TokensClient;
