import { User } from '../../types/shared';
export interface PermitUser {
    key: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    attributes?: Record<string, any>;
}
export interface BackendUser extends User {
    username?: string;
    created_at?: string;
    updated_at?: string;
}
/**
 * Syncs a user to Permit.io
 */
export declare function syncUserToPermit(user: BackendUser): Promise<boolean>;
/**
 * Deletes a user from Permit.io
 */
export declare function deleteUserFromPermit(userId: string): Promise<boolean>;
/**
 * Gets user data from Permit.io
 */
export declare function getUserFromPermit(userId: string): Promise<any>;
/**
 * Syncs a service/API token as a Permit principal and assigns it a role.
 * The Permit principal key is "svc_token:<tokenId>".
 */
export declare function syncServiceTokenToPermit(tokenId: string, orgId: string, permitRole: 'viewer' | 'editor' | 'admin'): Promise<boolean>;
/**
 * Removes a service/API token role from Permit.
 * The Permit principal key is "svc_token:<tokenId>".
 */
export declare function removeServiceTokenFromPermit(tokenId: string, orgId: string, permitRole: 'viewer' | 'editor' | 'admin'): Promise<boolean>;
/**
 * Updates user attributes in Permit.io
 */
export declare function updateUserInPermit(userId: string, updates: Partial<PermitUser>): Promise<boolean>;
//# sourceMappingURL=user-sync.d.ts.map