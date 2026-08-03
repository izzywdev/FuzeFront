export interface User {
  id: string
  email: string
  defaultAppId?: string
  roles: string[]
  firstName?: string
  lastName?: string
  // FF-EPIC-10-S3 — the portal this session/token is bound to (server-issued
  // `prt_...` id). Set by authenticateToken from the JWT `portal_id` claim
  // (falling back to the resolved req.portal when absent); undefined when the
  // multi-tenant-portals flag is OFF, preserving pre-epic behavior.
  portalId?: string
  // FF-EPIC-11-S1 — this user's permanent home portal (`users.home_portal_id`,
  // `prt_...` id or null for root/platform). Distinct from `portalId` above
  // (the CURRENT SESSION's bound portal): this is the caller's OWN row value,
  // surfaced here so downstream reads (e.g. the caller's own profile) never
  // re-derive it with an extra query. `scopeToPortal` (utils/scopeToPortal.ts)
  // scopes reads of OTHER users by `portalId` (the session context), not this
  // field. `null` (not `undefined`) once populated, so "not yet looked up"
  // (undefined — e.g. authenticateToken didn't run) is distinguishable from
  // "looked up, root/platform user" (null).
  homePortalId?: string | null
}

export interface Organization {
  id: string
  name: string
  slug: string
  parent_id?: string
  owner_id: string
  type: 'platform' | 'organization' | 'personal'
  settings: Record<string, any>
  metadata: Record<string, any>
  is_active: boolean
  provisioning_state?: 'pending' | 'active' | 'failed'
  created_at: string
  updated_at: string
}

export interface OrganizationMembership {
  id: string
  user_id: string
  organization_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'active' | 'pending' | 'suspended' | 'revoked'
  invited_by?: string
  invited_at?: string
  joined_at?: string
  permissions: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  userId: string
  tenantId?: string
  expiresAt: Date
  activeOrganizationId?: string
  organizationContext: Record<string, any>
}

export interface App {
  id: string
  name: string
  url: string
  iconUrl?: string
  isActive: boolean
  isHealthy?: boolean
  integrationType: 'module-federation' | 'iframe' | 'web-component' | 'spa'
  remoteUrl?: string
  scope?: string
  module?: string
  description?: string
  organizationId?: string
  visibility: 'private' | 'organization' | 'public' | 'marketplace'
  /**
   * Where the app may be INSTALLED — a user's personal space, an organization,
   * or either. Distinct from `visibility` (who may SEE it) and from
   * `organizationId` (who OWNS it), and distinct from `scope` above, which is
   * the Module-Federation remote container name.
   */
  scopeLevel?: 'personal' | 'organization' | 'both'
  marketplaceMetadata: Record<string, any>
  isMarketplaceApproved: boolean
  installCount: number
  rating?: number
}

export interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  action?: () => void
  children?: MenuItem[]
  category?: 'portal' | 'app'
  appId?: string
  order?: number
}

export interface SocketMessage {
  type: string
  payload: any
  targetAppId?: string
  sourceAppId?: string
  timestamp: number
}

export interface Permission {
  action: string
  resource: string
}

export interface CommandEvent {
  type: string
  payload: any
  appId?: string
}
