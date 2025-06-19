export interface User {
  id: string
  email: string
  defaultAppId?: string
  roles: string[]
  firstName?: string
  lastName?: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  parent_id?: string
  owner_id: string
  type: 'platform' | 'organization'
  settings: Record<string, any>
  metadata: Record<string, any>
  is_active: boolean
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
  integrationType: 'module-federation' | 'iframe' | 'web-component'
  remoteUrl?: string
  scope?: string
  module?: string
  description?: string
  organizationId?: string
  visibility: 'private' | 'organization' | 'public' | 'marketplace'
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
