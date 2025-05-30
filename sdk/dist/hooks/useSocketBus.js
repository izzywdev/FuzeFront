import { useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import { usePlatformContext } from '../context/PlatformProvider'
export function useSocketBus(appId) {
  var _a, _b, _c
  const { state } = usePlatformContext()
  const socketRef = useRef(null)
  const handlersRef = useRef(new Map())
  useEffect(() => {
    var _a, _b, _c
    // Don't initialize socket in fallback mode unless explicitly configured
    if (
      !state.isPlatformMode &&
      !((_a = state.config) === null || _a === void 0 ? void 0 : _a.wsUrl)
    ) {
      return
    }
    const wsUrl =
      ((_b = state.config) === null || _b === void 0 ? void 0 : _b.wsUrl) ||
      'ws://localhost:3001'
    const effectiveAppId =
      appId ||
      ((_c = state.config) === null || _c === void 0 ? void 0 : _c.id) ||
      'unknown'
    // Initialize socket connection
    const socket = io(wsUrl, {
      auth: {
        appId: effectiveAppId,
        token: localStorage.getItem('authToken'), // Get from storage
      },
    })
    socketRef.current = socket
    // Set up message routing
    socket.on('command-event', event => {
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
  }, [
    state.isPlatformMode,
    (_a = state.config) === null || _a === void 0 ? void 0 : _a.wsUrl,
    (_b = state.config) === null || _b === void 0 ? void 0 : _b.id,
    appId,
  ])
  const on = useCallback((eventType, handler) => {
    handlersRef.current.set(eventType, handler)
  }, [])
  const emit = useCallback(
    (eventType, payload, targetAppId) => {
      if (socketRef.current && socketRef.current.connected) {
        const event = {
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
    isConnected:
      ((_c = socketRef.current) === null || _c === void 0
        ? void 0
        : _c.connected) || false,
  }
}
