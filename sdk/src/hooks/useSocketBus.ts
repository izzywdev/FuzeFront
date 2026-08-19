import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { usePlatformContext } from '../context/PlatformProvider'
import type { UseSocketBusResult, CommandEvent } from '../types'

export function useSocketBus(appId?: string): UseSocketBusResult {
  const { state } = usePlatformContext()
  const socketRef = useRef<Socket | null>(null)
  const handlersRef = useRef<Map<string, (payload: any) => void>>(new Map())

  useEffect(() => {
    // Don't initialize socket in fallback mode unless explicitly configured
    if (!state.isPlatformMode && !state.config?.wsUrl) {
      return
    }

    const wsUrl = state.config?.wsUrl || 'ws://localhost:3001'
    const effectiveAppId = appId || state.config?.id || 'unknown'

    // Initialize socket connection
    const socket = io(wsUrl, {
      auth: {
        appId: effectiveAppId,
        token: localStorage.getItem('authToken'), // Get from storage
      },
    })

    socketRef.current = socket

    // Set up message routing
    socket.on('command-event', (event: CommandEvent) => {
      const handler = handlersRef.current.get(event.type)
      if (handler) {
        handler(event.payload)
      }
    })

    socket.on('connect', () => {
      console.log(`🔌 Socket connected for app: ${effectiveAppId}`)
    })

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected for app: ${effectiveAppId}`)
    })

    socket.on('connect_error', error => {
      console.error('🔌 Socket connection error:', error)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [state.isPlatformMode, state.config?.wsUrl, state.config?.id, appId])

  const on = useCallback(
    (eventType: string, handler: (payload: any) => void) => {
      handlersRef.current.set(eventType, handler)
    },
    []
  )

  const emit = useCallback(
    (eventType: string, payload: any, targetAppId?: string) => {
      if (socketRef.current && socketRef.current.connected) {
        const event: CommandEvent = {
          type: eventType,
          payload,
          appId: targetAppId,
        }
        socketRef.current.emit('command-event', event)
      } else if (!state.isPlatformMode) {
        // In fallback mode, just log the event
        console.log('📡 [Fallback Mode] Socket emit:', {
          eventType,
          payload,
          targetAppId,
        })
      }
    },
    [state.isPlatformMode]
  )

  return {
    on,
    emit,
    isConnected: socketRef.current?.connected || false,
  }
}
