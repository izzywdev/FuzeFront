export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

// ---------------------------------------------------------------------------
// Identity context switcher (FF-EPIC-17-S4) — Personal identity + org/portal
// context switcher, reconciling OrganizationPage.tsx's local <select> with
// the canonical persisted setActiveOrganization switcher.
// design/frames/identity-context-switcher/**
// ---------------------------------------------------------------------------

/** The active context: the non-org Personal identity, or a specific org. */
export type ContextTarget = 'personal' | string

/**
 * One org/sub-org the current user directly belongs to, as rendered by the
 * ContextSwitcher menu and the "My orgs & sub-orgs" list. `role` is the
 * caller's real `user_role` for that org — `null` means visible-but-not-a-
 * member (a platform org you can see but haven't joined); never fabricated.
 */
export interface OrgContextItem {
  id: string
  name: string
  role: OrgRole | null
  /** True for the pinned platform root org — always a top-level row, never nested. */
  isRoot?: boolean
  /** True for a portal-root org (direct child of the platform root). */
  isPortal?: boolean
  /** Direct parent org id, when the caller also belongs to the parent. */
  parentId?: string | null
}

export interface Member {
  id: string
  role: OrgRole
  status: 'active' | 'pending' | 'suspended'
  user: { id: string; email: string; firstName?: string; lastName?: string }
  invited_at?: string
  joined_at?: string
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at?: string
  expires_at?: string
}

export type TokenOwnerType = 'user' | 'org'

export interface ApiTokenSummary {
  id: string
  name: string
  owner_type: TokenOwnerType
  owner_id: string
  token_prefix: string
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  created_at?: string
  revoked_at?: string | null
}

export interface CreatedApiToken extends ApiTokenSummary {
  token: string
} // one-time raw token

/** A single resource action, e.g. `{ key: 'manage', name: 'Manage' }`. */
export interface ResourceActionDef {
  key: string
  name: string
}

/** A permission resource and its available actions (from the Permit schema). */
export interface ResourceDef {
  key: string
  name: string
  actions: ResourceActionDef[]
}

/** An organization role and the permissions it grants. */
export interface OrgRoleDefinition {
  key: string
  name: string
  /** Whether this role can be assigned to a member (owner is never assignable). */
  assignable: boolean
  /** Effective permission strings, each `"<ResourceKey>:<action>"`. */
  permissions: string[]
}

/** Read-only role + resource catalog for an organization. */
export interface RolesCatalog {
  roles: OrgRoleDefinition[]
  resources: ResourceDef[]
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
}

/** Paginated members envelope returned by the members list endpoint. */
export interface MembersPage {
  members: Member[]
  pagination: PaginationMeta
}

export interface ListMembersOptions {
  page?: number
  pageSize?: number
  search?: string
}

export interface IdentityApiClient {
  listMembers(orgId: string, opts?: ListMembersOptions): Promise<MembersPage>
  listRoles(orgId: string): Promise<RolesCatalog>
  updateMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<void>
  removeMember(orgId: string, memberId: string): Promise<void>
  listInvitations(orgId: string, status?: 'pending' | 'all'): Promise<Invitation[]>
  invite(orgId: string, email: string, role: OrgRole): Promise<void>
  bulkInvite(orgId: string, invitations: { email: string; role: OrgRole }[]): Promise<{ created: number; skipped: number; errors: string[] }>
  resendInvitation(orgId: string, invitationId: string): Promise<void>
  revokeInvitation(orgId: string, invitationId: string): Promise<void>
  listTokens(): Promise<ApiTokenSummary[]>
  listOrgTokens(orgId: string): Promise<ApiTokenSummary[]>
  createToken(input: { name: string; owner_type: TokenOwnerType; owner_id: string; scopes: string[]; expires_at: string | null }): Promise<CreatedApiToken>
  revokeToken(tokenId: string): Promise<void>
}
