export interface User {
  id: string
  email: string
  defaultAppId?: string
  roles: string[]
  firstName?: string
  lastName?: string
}

export interface Session {
  id: string
  userId: string
  tenantId?: string
  expiresAt: Date
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
}

export interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  action?: () => void
  children?: MenuItem[]
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
