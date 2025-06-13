// Simple SDK implementation for task-manager-app
import React from 'react'

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

// Simple hooks for consistency
export function useCurrentUser() {
  return {
    user: null,
    isAuthenticated: false,
    currentUser: null,
    setCurrentUser: () => {},
  }
}

export function useGlobalMenu() {
  return {
    menuItems: [],
    setMenuItems: () => {},
    addAppMenuItems: () => {},
    removeAppMenuItems: () => {},
  }
}

// Simple provider component
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
