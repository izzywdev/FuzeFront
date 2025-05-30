import React, { ReactNode } from 'react'
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
  | {
      type: 'SET_USER'
      payload: User | null
    }
  | {
      type: 'SET_SESSION'
      payload: Session | null
    }
  | {
      type: 'SET_APPS'
      payload: App[]
    }
  | {
      type: 'SET_ACTIVE_APP'
      payload: App | null
    }
  | {
      type: 'SET_MENU_ITEMS'
      payload: MenuItem[]
    }
  | {
      type: 'SET_LOADING'
      payload: boolean
    }
  | {
      type: 'UPDATE_APP_STATUS'
      payload: {
        appId: string
        isHealthy: boolean
      }
    }
export declare function AppProvider({
  children,
}: {
  children: ReactNode
}): import('react/jsx-runtime').JSX.Element
export declare function useAppContext(): {
  state: AppState
  dispatch: React.Dispatch<AppAction>
}
export {}
