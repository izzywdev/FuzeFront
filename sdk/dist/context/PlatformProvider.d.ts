import React, { ReactNode } from 'react'
import type { User, Session, App, MenuItem, AppConfig } from '../types'
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
      type: 'SET_PLATFORM_MODE'
      payload: boolean
    }
  | {
      type: 'SET_CONFIG'
      payload: AppConfig
    }
interface PlatformProviderProps {
  children: ReactNode
  config: AppConfig
  fallbackMode?: boolean
}
export declare function PlatformProvider({
  children,
  config,
  fallbackMode,
}: PlatformProviderProps): import('react/jsx-runtime').JSX.Element
export declare function usePlatformContext(): {
  state: PlatformState
  dispatch: React.Dispatch<PlatformAction>
}
export {}
//# sourceMappingURL=PlatformProvider.d.ts.map
