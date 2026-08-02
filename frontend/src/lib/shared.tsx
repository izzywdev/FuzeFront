import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react'
import type { Organization } from '../services/api'
import { getActiveValue, setActiveValue } from './accounts'

// Re-export so consumers can import Organization from shared
export type { Organization }

// --- Active-organization persistence -----------------------------------------
// The active org MUST survive full-page reloads: the SidePanel nav links
// navigate via the browser (full reload), and BillingPage/checkout bill
// `activeOrganizationId`. Without persistence every reload reset it (the gate
// forced the personal org), so a user who selected/created an org and then
// clicked a menu item silently billed their personal org. Persist it here.
//
// PER ACCOUNT, not per browser. This used to be the bare
// `ff.activeOrganizationId` key, which two signed-in accounts would share — so
// switching account would carry the previous account's org selection over, and
// (since it names an org the new account may not belong to) render the org
// switcher blank. It now lives in the active account's vault namespace.

export function getPersistedActiveOrganizationId(): string | null {
  return getActiveValue('activeOrganizationId')
}

function persistActiveOrganizationId(id: string | null): void {
  setActiveValue('activeOrganizationId', id)
}

// The session-scoped "workspace provisioned" flag WorkspaceProvisioningGate
// uses to skip its loading flash on subsequent navigations within a session.
const WORKSPACE_READY_SESSION_KEY = 'ff.workspaceReady'
const LAST_AUTHENTICATED_USER_ID_KEY = 'ff.lastAuthenticatedUserId'

/**
 * BUG 2 fix (org switcher rendering blank for a social/Google login):
 *
 * `ff.workspaceReady` (sessionStorage) is keyed per TAB, not per account, so a
 * user who signs out and a *different* user signs back in on the same tab
 * inherits it: the flag short-circuits WorkspaceProvisioningGate straight to
 * "ready" without confirming org membership for the NEW session.
 *
 * Call this once the authenticated user is known (after login/session restore).
 * If the user id differs from the last-seen one in this tab, clear the flag so
 * WorkspaceProvisioningGate performs a full, un-shortcut org fetch + hydration
 * for the new account — the same path a fresh native-login session takes.
 *
 * The companion half of the original bug — a stale active-org id pointing at an
 * org the new account does not belong to — is now structurally impossible:
 * the active org lives in the account's own vault namespace, so accounts cannot
 * see each other's selection at all.
 */
export function resetWorkspaceSessionIfUserChanged(userId: string): void {
  try {
    const lastUserId = sessionStorage.getItem(LAST_AUTHENTICATED_USER_ID_KEY)
    if (lastUserId && lastUserId !== userId) {
      sessionStorage.removeItem(WORKSPACE_READY_SESSION_KEY)
    }
    sessionStorage.setItem(LAST_AUTHENTICATED_USER_ID_KEY, userId)
  } catch {
    // sessionStorage unavailable (privacy mode) — degrade gracefully.
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
  /** Module-Federation remote container name. NOT the install scope. */
  scope?: string
  module?: string
  description?: string
  /** Where this app MAY be installed. Defaults to 'both' server-side. */
  scopeLevel?: 'personal' | 'organization' | 'both'
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
  // Stable callback + memoized return: without this, every render produced a
  // NEW setUser function, so any consumer with `useEffect(..., [setUser])`
  // (e.g. LoginPage's page-load handler) re-fired on every render — an infinite
  // loop that flooded /api/auth/method at ~2-3 req/s and made the page
  // unresponsive. dispatch is stable, so these references are now stable too.
  const setUser = useCallback(
    (user: User | null) => dispatch({ type: 'SET_USER', payload: user }),
    [dispatch]
  )
  return useMemo(
    () => ({
      currentUser: state.user,
      user: state.user,
      isAuthenticated: !!state.user,
      setCurrentUser: setUser,
      setUser,
    }),
    [state.user, setUser]
  )
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
