import { io, Socket } from 'socket.io-client'

class WebSocketService {
  private socket: Socket | null = null
  private listeners: Map<string, Function[]> = new Map()

  connect() {
    if (this.socket?.connected) {
      return this.socket
    }

    const backendUrl =
      import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

    this.socket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
    })

    this.socket.on('connect', () => {
      console.log('🔌 Connected to WebSocket server')
    })

    this.socket.on('disconnect', () => {
      console.log('🔌 Disconnected from WebSocket server')
    })

    this.socket.on('app-status-changed', data => {
      console.log('📡 App status changed:', data)
      this.emit('app-status-changed', data)
    })

    this.socket.on('connect_error', error => {
      console.error('WebSocket connection error:', error)
    })

    return this.socket
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }

  off(event: string, callback: Function) {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      const index = eventListeners.indexOf(callback)
      if (index > -1) {
        eventListeners.splice(index, 1)
      }
    }
  }

  private emit(event: string, data: any) {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(callback => callback(data))
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false
  }
}

export const websocketService = new WebSocketService()
export default websocketService
