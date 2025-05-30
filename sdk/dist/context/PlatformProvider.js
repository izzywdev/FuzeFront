import { jsx as _jsx } from 'react/jsx-runtime'
import { createContext, useContext, useReducer, useEffect } from 'react'
const initialState = {
  user: null,
  session: null,
  apps: [],
  activeApp: null,
  menuItems: [],
  isLoading: false,
  isPlatformMode: false,
  config: null,
}
function platformReducer(state, action) {
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
const PlatformContext = createContext(null)
export function PlatformProvider({ children, config, fallbackMode = false }) {
  const [state, dispatch] = useReducer(platformReducer, {
    ...initialState,
    config,
    isPlatformMode: !fallbackMode,
  })
  useEffect(() => {
    // Try to detect if we're running inside the FrontFuse platform
    const isPlatform =
      !fallbackMode &&
      // Check for platform-specific global variables
      typeof window !== 'undefined' &&
      window.__FRONTFUSE_PLATFORM__ === true
    dispatch({ type: 'SET_PLATFORM_MODE', payload: isPlatform })
    if (!isPlatform && fallbackMode) {
      // Set up fallback data for standalone development
      const mockUser = {
        id: 'dev-user',
        email: 'developer@example.com',
        firstName: 'Dev',
        lastName: 'User',
        roles: ['user', 'developer'],
      }
      const mockSession = {
        id: 'dev-session',
        userId: 'dev-user',
        tenantId: 'dev-tenant',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }
      dispatch({ type: 'SET_USER', payload: mockUser })
      dispatch({ type: 'SET_SESSION', payload: mockSession })
      console.log(
        '🔧 FrontFuse SDK running in fallback mode (standalone development)'
      )
    } else if (isPlatform) {
      // Try to get data from the platform context
      try {
        const platformData = window.__FRONTFUSE_CONTEXT__
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
      window.__FRONTFUSE_CONTEXT__ = {
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
  return _jsx(PlatformContext.Provider, {
    value: { state, dispatch },
    children: children,
  })
}
export function usePlatformContext() {
  const context = useContext(PlatformContext)
  if (!context) {
    throw new Error('usePlatformContext must be used within a PlatformProvider')
  }
  return context
}
