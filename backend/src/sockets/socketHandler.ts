import { Server as SocketIOServer, Socket } from 'socket.io'
import { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import { CommandEvent } from '../types/shared'

interface AuthenticatedSocket extends Socket {
  userId?: string
  appId?: string
}

export function initializeSocketIO(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
  })

  // Authentication middleware for socket connections
  io.use((socket: any, next) => {
    const token = socket.handshake.auth.token
    const appId = socket.handshake.auth.appId

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
          userId: string
        }
        socket.userId = decoded.userId
        socket.appId = appId || 'container'
        next()
      } catch (err) {
        next(new Error('Authentication error'))
      }
    } else {
      // Allow unauthenticated connections for demo purposes
      socket.appId = appId || 'anonymous'
      next()
    }
  })

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Socket connected: ${socket.id} (app: ${socket.appId})`)

    // Join app-specific room
    if (socket.appId) {
      socket.join(socket.appId)
    }

    // Handle command events
    socket.on('command-event', (event: CommandEvent) => {
      console.log('Command event received:', event)

      // Route message based on target
      if (event.appId) {
        // Send to specific app
        socket.to(event.appId).emit('command-event', {
          ...event,
          sourceAppId: socket.appId,
        })
      } else {
        // Broadcast to all connected clients
        socket.broadcast.emit('command-event', {
          ...event,
          sourceAppId: socket.appId,
        })
      }
    })

    // Handle app-to-app communication
    socket.on('app-message', (data: { targetAppId: string; payload: any }) => {
      socket.to(data.targetAppId).emit('app-message', {
        ...data,
        sourceAppId: socket.appId,
      })
    })

    // Handle platform events
    socket.on('platform-event', (data: { type: string; payload: any }) => {
      // Broadcast platform events to all clients
      io.emit('platform-event', {
        ...data,
        sourceAppId: socket.appId,
      })
    })

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`)
    })
  })

  return io
}
