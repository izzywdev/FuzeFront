export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface Member {
    id: string;
    role: OrgRole;
    status: 'active' | 'pending' | 'suspended';
    user: {
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
    };
    invited_at?: string;
    joined_at?: string;
}
export interface Invitation {
    id: string;
    email: string;
    role: OrgRole;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    created_at?: string;
    expires_at?: string;
}
export type TokenOwnerType = 'user' | 'org';
export interface ApiTokenSummary {
    id: string;
    name: string;
    owner_type: TokenOwnerType;
    owner_id: string;
    token_prefix: string;
    scopes: string[];
    expires_at: string | null;
    last_used_at: string | null;
    created_at?: string;
    revoked_at?: string | null;
}
export interface CreatedApiToken extends ApiTokenSummary {
    token: string;
}
export interface IdentityApiClient {
    listMembers(orgId: string): Promise<Member[]>;
    updateMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<void>;
    removeMember(orgId: string, memberId: string): Promise<void>;
    listInvitations(orgId: string, status?: 'pending' | 'all'): Promise<Invitation[]>;
    invite(orgId: string, email: string, role: OrgRole): Promise<void>;
    bulkInvite(orgId: string, invitations: {
        email: string;
        role: OrgRole;
    }[]): Promise<{
        created: number;
        skipped: number;
        errors: string[];
    }>;
    resendInvitation(orgId: string, invitationId: string): Promise<void>;
    revokeInvitation(orgId: string, invitationId: string): Promise<void>;
    listTokens(): Promise<ApiTokenSummary[]>;
    listOrgTokens(orgId: string): Promise<ApiTokenSummary[]>;
    createToken(input: {
        name: string;
        owner_type: TokenOwnerType;
        owner_id: string;
        scopes: string[];
        expires_at: string | null;
    }): Promise<CreatedApiToken>;
    revokeToken(tokenId: string): Promise<void>;
}
