import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { CommandEvent } from '../types'

interface SocketBusHook {
  on: (eventType: string, handler: (payload: any) => void) => void
  emit: (eventType: string, payload: any, targetAppId?: string) => void
  isConnected: boolean
}

export function useSocketBus(appId?: string): SocketBusHook {
  const socketRef = useRef<Socket | null>(null)
  const handlersRef = useRef<Map<string, (payload: any) => void>>(new Map())

  useEffect(() => {
    // Initialize socket connection
    const socket = io(process.env.REACT_APP_WS_URL || 'ws://localhost:3001', {
      auth: {
        appId: appId || 'container',
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

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [appId])

  const on = useCallback(
    (eventType: string, handler: (payload: any) => void) => {
      handlersRef.current.set(eventType, handler)
    },
    []
  )

  const emit = useCallback(
    (eventType: string, payload: any, targetAppId?: string) => {
      if (socketRef.current) {
        const event: CommandEvent = {
          type: eventType,
          payload,
          appId: targetAppId,
        }
        socketRef.current.emit('command-event', event)
      }
    },
    []
  )

  return {
    on,
    emit,
    isConnected: socketRef.current?.connected || false,
  }
}
