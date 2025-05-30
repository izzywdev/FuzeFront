import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
import dotenv from 'dotenv'

// Import routes
import authRoutes from './routes/auth'
import appsRoutes from './routes/apps'
import { initializeSocketIO } from './sockets/socketHandler'

// Load environment variables
dotenv.config()

const app = express()
const httpServer = createServer(app)
const PORT = process.env.PORT || 3001

// Initialize Socket.IO
const io = initializeSocketIO(httpServer)

// Make io available to routes
app.set('io', io)

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameSrc: ["'self'", '*'], // Allow iframes for microfrontends
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Allow scripts for dynamic loading
      },
    },
  })
)

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.use('/auth', authRoutes)
app.use('/api/apps', appsRoutes)

// User info route
app.get('/api/user', (req, res) => {
  // This will be handled by the auth middleware in production
  res.json({ message: 'User endpoint - use /auth/user instead' })
})

// Health check
const startTime = Date.now()
app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  })
})

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

httpServer.listen(PORT, () => {
  console.log(`🚀 AppHub backend server running on port ${PORT}`)
  console.log(
    `🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`
  )
  console.log(`📡 WebSocket server ready`)
})

export default app
