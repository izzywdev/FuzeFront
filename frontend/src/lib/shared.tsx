import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react'

// Types
export interface User {
  id: string
  email: string
  defaultAppId?: string
  roles: string[]
  firstName?: string
  lastName?: string
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
