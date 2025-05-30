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
  visible?: boolean
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
export interface AppConfig {
  id: string
  name: string
  version?: string
  apiUrl?: string
  wsUrl?: string
}
export interface PlatformContext {
  user: User | null
  session: Session | null
  apps: App[]
  activeApp: App | null
  menuItems: MenuItem[]
  isLoading: boolean
  isPlatformMode: boolean
}
export interface SocketBus {
  on: (eventType: string, handler: (payload: any) => void) => void
  emit: (eventType: string, payload: any, targetAppId?: string) => void
  isConnected: boolean
}
export interface LoadedModule {
  default: React.ComponentType<any>
}
export interface ModuleFederationConfig {
  remoteUrl: string
  scope: string
  module: string
}
export interface UseCurrentUserResult {
  user: User | null
  setUser: (user: User | null) => void
  isAuthenticated: boolean
  hasRole: (role: string) => boolean
}
export interface UseSessionResult {
  session: Session | null
  setSession: (session: Session | null) => void
  tenantId: string | null
  isExpired: boolean
}
export interface UseGlobalMenuResult {
  menuItems: MenuItem[]
  setMenuItems: (items: MenuItem[]) => void
  addMenuItem: (item: MenuItem) => void
  removeMenuItem: (id: string) => void
  updateMenuItem: (id: string, updates: Partial<MenuItem>) => void
}
export interface UseSocketBusResult extends SocketBus {}
//# sourceMappingURL=types.d.ts.map
