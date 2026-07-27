// Simple SDK implementation for task-manager-app
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react'

export interface HeartbeatConfig {
  appId: string
  backendUrl: string
  interval?: number
  metadata?: any
}

export interface HeartbeatInstance {
  start: () => void
  stop: () => void
  isRunning: boolean
}

export function createHeartbeat(config: HeartbeatConfig): HeartbeatInstance {
  let intervalId: NodeJS.Timeout | null = null
  let isRunning = false

  const sendHeartbeat = async () => {
    try {
      await fetch(`${config.backendUrl}/api/apps/${config.appId}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'online',
          timestamp: new Date().toISOString(),
          metadata: config.metadata || {},
        }),
      })
    } catch (error) {
      console.error('Failed to send heartbeat:', error)
    }
  }

  return {
    start() {
      if (!isRunning) {
        isRunning = true
        // Send initial heartbeat
        sendHeartbeat()
        // Set up interval
        intervalId = setInterval(sendHeartbeat, config.interval || 30000)
      }
    },
    stop() {
      if (isRunning && intervalId) {
        isRunning = false
        clearInterval(intervalId)
        intervalId = null
      }
    },
    get isRunning() {
      return isRunning
    },
  }
}

// Types
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: string[]
}

interface MenuItem {
  id: string
  label: string
  icon: string
  action: () => void
  order: number
}

interface PlatformContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  addAppMenuItems: (appId: string, items: MenuItem[]) => void
  removeAppMenuItems: (appId: string) => void
}

// Context
const PlatformContext = createContext<PlatformContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  addAppMenuItems: () => {},
  removeAppMenuItems: () => {},
})

// Provider component
interface PlatformProviderProps {
  children: ReactNode
}

export function PlatformProvider({ children }: PlatformProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate checking authentication
    const checkAuth = async () => {
      try {
        // Try to get user from API
        const response = await fetch('http://localhost:3001/api/auth/user', {
          credentials: 'include',
        })

        if (response.ok) {
          const userData = await response.json()
          setUser(userData.user)
        }
      } catch (error) {
        console.warn('Auth check failed:', error)
        // Set a default user for development
        setUser({
          id: '1',
          email: 'admin@fuzefront.dev',
          firstName: 'Admin',
          lastName: 'User',
          roles: ['admin'],
        })
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [])

  const addAppMenuItems = (appId: string, items: MenuItem[]) => {
    console.log(`Adding menu items for app ${appId}:`, items)
  }

  const removeAppMenuItems = (appId: string) => {
    console.log(`Removing menu items for app ${appId}`)
  }

  return (
    <PlatformContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        addAppMenuItems,
        removeAppMenuItems,
      }}
    >
      {children}
    </PlatformContext.Provider>
  )
}

// Hooks
export function useCurrentUser() {
  const context = useContext(PlatformContext)
  return {
    user: context.user,
    isAuthenticated: context.isAuthenticated,
    isLoading: context.isLoading,
  }
}

export function useGlobalMenu() {
  const context = useContext(PlatformContext)
  return {
    addAppMenuItems: context.addAppMenuItems,
    removeAppMenuItems: context.removeAppMenuItems,
  }
}
