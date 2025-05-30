import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useEffect,
} from 'react'
import type {
  PlatformContext as IPlatformContext,
  User,
  Session,
  App,
  MenuItem,
  AppConfig,
} from '../types'

interface PlatformState {
  user: User | null
  session: Session | null
  apps: App[]
  activeApp: App | null
  menuItems: MenuItem[]
  isLoading: boolean
  isPlatformMode: boolean
  config: AppConfig | null
}

type PlatformAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_SESSION'; payload: Session | null }
  | { type: 'SET_APPS'; payload: App[] }
  | { type: 'SET_ACTIVE_APP'; payload: App | null }
  | { type: 'SET_MENU_ITEMS'; payload: MenuItem[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_PLATFORM_MODE'; payload: boolean }
  | { type: 'SET_CONFIG'; payload: AppConfig }

const initialState: PlatformState = {
  user: null,
  session: null,
  apps: [],
  activeApp: null,
  menuItems: [],
  isLoading: false,
  isPlatformMode: false,
  config: null,
}

function platformReducer(
  state: PlatformState,
  action: PlatformAction
): PlatformState {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.payload }
    case 'SET_SESSION':
      return { ...state, session: action.payload }
    case 'SET_APPS':
      return { ...state, apps: action.payload }
    case 'SET_ACTIVE_APP':
      return { ...state, activeApp: action.payload }
    case 'SET_MENU_ITEMS':
      return { ...state, menuItems: action.payload }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_PLATFORM_MODE':
      return { ...state, isPlatformMode: action.payload }
    case 'SET_CONFIG':
      return { ...state, config: action.payload }
    default:
      return state
  }
}

const PlatformContext = createContext<{
  state: PlatformState
  dispatch: React.Dispatch<PlatformAction>
} | null>(null)

interface PlatformProviderProps {
  children: ReactNode
  config: AppConfig
  fallbackMode?: boolean
}

export function PlatformProvider({
  children,
  config,
  fallbackMode = false,
}: PlatformProviderProps) {
  const [state, dispatch] = useReducer(platformReducer, {
    ...initialState,
    config,
    isPlatformMode: !fallbackMode,
  })

  useEffect(() => {
    // Try to detect if we're running inside the AppHub platform
    const isPlatform =
      !fallbackMode &&
      // Check for platform-specific global variables
      typeof window !== 'undefined' &&
      (window as any).__APPHUB_PLATFORM__ === true

    dispatch({ type: 'SET_PLATFORM_MODE', payload: isPlatform })

    if (!isPlatform && fallbackMode) {
      // Set up fallback data for standalone development
      const mockUser: User = {
        id: 'dev-user',
        email: 'developer@example.com',
        firstName: 'Dev',
        lastName: 'User',
        roles: ['user', 'developer'],
      }

      const mockSession: Session = {
        id: 'dev-session',
        userId: 'dev-user',
        tenantId: 'dev-tenant',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }

      dispatch({ type: 'SET_USER', payload: mockUser })
      dispatch({ type: 'SET_SESSION', payload: mockSession })

      console.log(
        '🔧 AppHub SDK running in fallback mode (standalone development)'
      )
    } else if (isPlatform) {
      // Try to get data from the platform context
      try {
        const platformData = (window as any).__APPHUB_CONTEXT__
        if (platformData) {
          if (platformData.user)
            dispatch({ type: 'SET_USER', payload: platformData.user })
          if (platformData.session)
            dispatch({ type: 'SET_SESSION', payload: platformData.session })
          if (platformData.apps)
            dispatch({ type: 'SET_APPS', payload: platformData.apps })
          if (platformData.activeApp)
            dispatch({
              type: 'SET_ACTIVE_APP',
              payload: platformData.activeApp,
            })
          if (platformData.menuItems)
            dispatch({
              type: 'SET_MENU_ITEMS',
              payload: platformData.menuItems,
            })
        }
      } catch (error) {
        console.warn('Failed to load platform context:', error)
      }
    }
  }, [fallbackMode])

  // Expose context to child microfrontends when in platform mode
  useEffect(() => {
    if (state.isPlatformMode && typeof window !== 'undefined') {
      ;(window as any).__APPHUB_CONTEXT__ = {
        user: state.user,
        session: state.session,
        apps: state.apps,
        activeApp: state.activeApp,
        menuItems: state.menuItems,
        isLoading: state.isLoading,
        isPlatformMode: state.isPlatformMode,
      }
    }
  }, [state])

  return (
    <PlatformContext.Provider value={{ state, dispatch }}>
      {children}
    </PlatformContext.Provider>
  )
}

export function usePlatformContext() {
  const context = useContext(PlatformContext)
  if (!context) {
    throw new Error('usePlatformContext must be used within a PlatformProvider')
  }
  return context
}
