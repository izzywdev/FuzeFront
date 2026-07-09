import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
} from 'react'
import type { Organization } from '../services/api'

// Re-export so consumers can import Organization from shared
export type { Organization }

// --- Active-organization persistence -----------------------------------------
// The active org MUST survive full-page reloads: the SidePanel nav links
// navigate via the browser (full reload), and BillingPage/checkout bill
// `activeOrganizationId`. Without persistence every reload reset it (the gate
// forced the personal org), so a user who selected/created an org and then
// clicked a menu item silently billed their personal org. Persist it here.
const ACTIVE_ORG_STORAGE_KEY = 'ff.activeOrganizationId'

export function getPersistedActiveOrganizationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistActiveOrganizationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, id)
    else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY)
  } catch {
    // localStorage unavailable (privacy mode) — degrade gracefully.
  }
}

// Types
export interface User {
  id: string
  email: string
  defaultAppId?: string
  roles: string[]
  firstName?: string
  lastName?: string
  // Optional extended profile fields (populated by the profile/auth payloads).
  avatar?: string
  bio?: string
  timezone?: string
  language?: string
  created_at?: string
  updated_at?: string
}

/**
 * @deprecated Legacy frontend-local App shape. The federated-app platform now
 * uses the FROZEN generated type from `@fuzefront/app-registry-client` (`App`
 * with a `manifest`) as the single source of truth across UI/backend/tests.
 * Read apps via `useAppRegistry()` / `useRegisteredApps()` instead of this type.
 * Retained only for the not-yet-migrated legacy websocket/AppContext reducer
 * paths; do not use for new code.
 */
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
  category?: 'portal' | 'app'
  appId?: string
  order?: number
}

// Context with reducer pattern
interface AppState {
  apps: App[]
  user: User | null
  activeApp: App | null
  selectedAppId: string | null
  menuItems: MenuItem[]
  isLoading: boolean
  /** All organizations the current user belongs to (populated by WorkspaceProvisioningGate). */
  organizations: Organization[]
  /** The currently active organization id (Plan G will use this for workspace switching). */
  activeOrganizationId: string | null
}

interface AppAction {
  type:
    | 'SET_APPS'
    | 'SET_USER'
    | 'SET_ACTIVE_APP'
    | 'SET_SELECTED_APP'
    | 'UPDATE_APP_STATUS'
    | 'ADD_APP'
    | 'SET_MENU_ITEMS'
    | 'SET_ORGANIZATIONS'
    | 'SET_ACTIVE_ORGANIZATION'
  payload: any
}

interface AppContextType {
  state: AppState
  dispatch: (action: AppAction) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_APPS':
      return { ...state, apps: action.payload }
    case 'SET_USER':
      return { ...state, user: action.payload }
    case 'SET_ACTIVE_APP':
      return { ...state, activeApp: action.payload }
    case 'SET_SELECTED_APP':
      return { ...state, selectedAppId: action.payload }
    case 'UPDATE_APP_STATUS':
      return {
        ...state,
        apps: state.apps.map(app =>
          app.id === action.payload.appId
            ? { ...app, isHealthy: action.payload.isHealthy }
            : app
        ),
      }
    case 'ADD_APP':
      return { ...state, apps: [...state.apps, action.payload] }
    case 'SET_MENU_ITEMS':
      return { ...state, menuItems: action.payload }
    case 'SET_ORGANIZATIONS':
      return { ...state, organizations: action.payload }
    case 'SET_ACTIVE_ORGANIZATION':
      persistActiveOrganizationId(action.payload)
      return { ...state, activeOrganizationId: action.payload }
    default:
      return state
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = React.useReducer(appReducer, {
    apps: [],
    user: null,
    activeApp: null,
    selectedAppId: null,
    menuItems: [],
    isLoading: false,
    organizations: [],
    // Hydrate the previously-selected org so a full-page reload keeps billing
    // pointed at the org the user is actually viewing.
    activeOrganizationId: getPersistedActiveOrganizationId(),
  })

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

// Hooks
export function useAppContext() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}

export function useCurrentUser() {
  const { state, dispatch } = useAppContext()
  return {
    currentUser: state.user,
    user: state.user,
    isAuthenticated: !!state.user,
    setCurrentUser: (user: User | null) =>
      dispatch({ type: 'SET_USER', payload: user }),
    setUser: (user: User | null) =>
      dispatch({ type: 'SET_USER', payload: user }),
  }
}

/**
 * useOrganizations — org context for the authenticated shell.
 *
 * Plan G builds on top of this: call setActiveOrganization(id) to switch
 * the active workspace; read activeOrganization for the current org object.
 */
export function useOrganizations() {
  const { state, dispatch } = useAppContext()
  const activeOrganization =
    state.organizations.find(o => o.id === state.activeOrganizationId) ?? null
  return {
    organizations: state.organizations,
    activeOrganizationId: state.activeOrganizationId,
    activeOrganization,
    setActiveOrganization: (id: string) =>
      dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: id }),
  }
}

export function useGlobalMenu() {
  // Simple implementation - in a real app this would come from API
  const [menuItems, setMenuItems] = useState<MenuItem[]>([
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: '🏠',
      route: '/',
      category: 'portal',
      order: 1,
    },
    {
      id: 'apps',
      label: 'Apps',
      icon: '📱',
      route: '/apps',
      category: 'portal',
      order: 2,
    },
  ])

  return { menuItems, setMenuItems }
}
