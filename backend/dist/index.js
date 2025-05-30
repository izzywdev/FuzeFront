'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = __importDefault(require('express'))
const cors_1 = __importDefault(require('cors'))
const helmet_1 = __importDefault(require('helmet'))
const http_1 = require('http')
const dotenv_1 = __importDefault(require('dotenv'))
// Import routes
const auth_1 = __importDefault(require('./routes/auth'))
const apps_1 = __importDefault(require('./routes/apps'))
const socketHandler_1 = require('./sockets/socketHandler')
// Load environment variables
dotenv_1.default.config()
const app = (0, express_1.default)()
const httpServer = (0, http_1.createServer)(app)
const PORT = process.env.PORT || 3001
// Initialize Socket.IO
const io = (0, socketHandler_1.initializeSocketIO)(httpServer)
// Make io available to routes
app.set('io', io)
// Middleware
app.use(
  (0, helmet_1.default)({
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
  (0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
)
app.use(express_1.default.json())
app.use(express_1.default.urlencoded({ extended: true }))
// Routes
app.use('/auth', auth_1.default)
app.use('/api/apps', apps_1.default)
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
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})
httpServer.listen(PORT, () => {
  console.log(`🚀 FrontFuse backend server running on port ${PORT}`)
  console.log(
    `🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`
  )
  console.log(`📡 WebSocket server ready`)
})
exports.default = app
//# sourceMappingURL=index.js.map
