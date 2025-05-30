import React, { createContext, useContext, useReducer, ReactNode } from 'react'
import { User, Session, App, MenuItem } from '../types'

interface AppState {
  user: User | null
  session: Session | null
  apps: App[]
  activeApp: App | null
  menuItems: MenuItem[]
  isLoading: boolean
}

type AppAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_SESSION'; payload: Session | null }
  | { type: 'SET_APPS'; payload: App[] }
  | { type: 'SET_ACTIVE_APP'; payload: App | null }
  | { type: 'SET_MENU_ITEMS'; payload: MenuItem[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | {
      type: 'UPDATE_APP_STATUS'
      payload: { appId: string; isHealthy: boolean }
    }

const initialState: AppState = {
  user: null,
  session: null,
  apps: [],
  activeApp: null,
  menuItems: [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠', route: '/dashboard' },
    { id: 'help', label: 'Help', icon: '❓', route: '/help' },
  ],
  isLoading: false,
}

function appReducer(state: AppState, action: AppAction): AppState {
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
    case 'UPDATE_APP_STATUS':
      return {
        ...state,
        apps: state.apps.map(app =>
          app.id === action.payload.appId
            ? { ...app, isHealthy: action.payload.isHealthy }
            : app
        ),
      }
    default:
      return state
  }
}

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<AppAction>
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}
