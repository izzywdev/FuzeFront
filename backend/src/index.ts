// FuzeFront Backend - Updated 2025-06-19 13:15 - Auth & Health Fix
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
import dotenv from 'dotenv'

// Import routes
import authRoutes from './routes/auth'
import appsRoutes from './routes/apps'
import organizationsRoutes from './routes/organizations'
import { initializeSocketIO } from './sockets/socketHandler'
import {
  initializeDatabase,
  closeDatabase,
  checkDatabaseHealth,
} from './config/database'
import { oidcService } from './services/oidc'

// Load environment variables
dotenv.config()

// Extend Express Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

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
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:8085', // Production frontend external URL
      'http://localhost:3004', // Allow calls from external backend port
      'http://fuzefront-frontend-prod:8080', // Internal container URL
    ],
    credentials: true,
  })
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Enhanced request logging middleware
app.use((req, res, next) => {
  const requestId = require('uuid').v4().substring(0, 8)
  const startTime = Date.now()

  // Add request ID to request object for tracking
  req.requestId = requestId

  console.log(`📥 [${requestId}] ${req.method} ${req.path}`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    authorization: req.get('Authorization') ? 'Bearer ***' : 'none',
    query: Object.keys(req.query).length > 0 ? req.query : 'none',
    bodySize: req.body ? JSON.stringify(req.body).length : 0,
  })

  // Log response when it finishes
  const originalSend = res.send
  res.send = function (data) {
    const responseTime = Date.now() - startTime
    console.log(
      `📤 [${requestId}] ${req.method} ${req.path} - ${res.statusCode}`,
      {
        responseTime: `${responseTime}ms`,
        statusCode: res.statusCode,
        contentType: res.get('Content-Type'),
        responseSize: data ? data.length : 0,
      }
    )
    return originalSend.call(this, data)
  }

  next()
})

// Setup Swagger documentation
try {
  // Only import and setup Swagger if packages are available
  const { specs, swaggerUi } = require('./config/swagger.js')

  /**
   * @swagger
   * tags:
   *   - name: Authentication
   *     description: User authentication and session management
   *   - name: Applications
   *     description: Microfrontend application management
   *   - name: Health
   *     description: System health and status endpoints
   */

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'FrontFuse API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
      },
    })
  )

  console.log(
    '📚 Swagger documentation available at http://localhost:' +
      PORT +
      '/api-docs'
  )
} catch (error) {
  console.warn(
    '⚠️  Swagger documentation not available (packages not installed)'
  )

  // Provide a simple fallback API documentation
  app.get('/api-docs', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>FrontFuse API Documentation</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem; }
          .endpoint { background: #f5f5f5; padding: 1rem; margin: 1rem 0; border-radius: 8px; }
          .method { font-weight: bold; color: #007bff; }
          .path { font-family: monospace; background: #e9ecef; padding: 0.2rem 0.5rem; border-radius: 4px; }
          pre { background: #f8f9fa; padding: 1rem; border-radius: 8px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>🚀 FrontFuse API Documentation</h1>
        <p>Welcome to the FrontFuse Platform API. This is a simplified documentation view.</p>
        
        <h2>🔐 Authentication Endpoints</h2>
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/auth/login</span></div>
          <p>Authenticate user with email and password</p>
          <pre>
{
  "email": "admin@frontfuse.dev",
  "password": "admin123"
}
          </pre>
        </div>
        
        <div class="endpoint">
          <div><span class="method">GET</span> <span class="path">/api/auth/user</span></div>
          <p>Get current authenticated user information</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
        </div>
        
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/auth/logout</span></div>
          <p>Logout current user and invalidate session</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
        </div>
        
        <h2>📱 Application Management</h2>
        <div class="endpoint">
          <div><span class="method">GET</span> <span class="path">/api/apps</span></div>
          <p>Get list of all registered applications</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
        </div>
        
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/apps</span></div>
          <p>Register a new microfrontend application (Admin only)</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
          <pre>
{
  "name": "My App",
  "url": "https://my-app.netlify.app",
  "integrationType": "module-federation",
  "remoteUrl": "https://my-app.netlify.app/assets/remoteEntry.js",
  "scope": "myApp",
  "module": "./App"
}
          </pre>
        </div>
        
        <h2>💓 Health & Monitoring</h2>
        <div class="endpoint">
          <div><span class="method">GET</span> <span class="path">/health</span></div>
          <p>Platform health check endpoint</p>
          <p><strong>No authentication required</strong></p>
        </div>
        
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/apps/:id/heartbeat</span></div>
          <p>Application heartbeat endpoint</p>
        </div>
        
        <h2>🔑 Authentication</h2>
        <p>Most endpoints require a JWT token in the Authorization header:</p>
        <pre>Authorization: Bearer &lt;your-jwt-token&gt;</pre>
        
        <h2>📞 Support</h2>
        <p>For full interactive documentation, install swagger packages:</p>
        <pre>npm install swagger-ui-express swagger-jsdoc</pre>
        
        <p>For support: <a href="mailto:support@frontfuse.dev">support@frontfuse.dev</a></p>
      </body>
      </html>
    `)
  })

  console.log(
    '📚 Basic API documentation available at http://localhost:' +
      PORT +
      '/api-docs'
  )
}

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/apps', appsRoutes)
app.use('/api/organizations', organizationsRoutes)

// Serve static documentation files
app.use('/docs', express.static('docs'))

// User info route
app.get('/api/user', (req, res) => {
  // This will be handled by the auth middleware in production
  res.json({ message: 'User endpoint - use /auth/user instead' })
})

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the FrontFuse platform is running and get system information
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Platform is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             example:
 *               status: "ok"
 *               timestamp: "2024-01-01T12:00:00.000Z"
 *               uptime: 3600
 *               version: "1.0.0"
 *               environment: "development"
 *               memory:
 *                 used: 45
 *                 total: 128
 */
// Health check
const startTime = Date.now()

// Main health check endpoint (without /api prefix)
app.get('/health', async (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const dbHealthy = await checkDatabaseHealth()

  res.json({
    status: dbHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbHealthy ? 'connected' : 'disconnected',
      type: 'PostgreSQL',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'fuzefront_platform',
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  })
})

// Add /api/health endpoint to match frontend expectations
app.get('/api/health', async (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const dbHealthy = await checkDatabaseHealth()

  res.json({
    status: dbHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbHealthy ? 'connected' : 'disconnected',
      type: 'PostgreSQL',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'fuzefront_platform',
    },
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

// Graceful shutdown function
function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`)

  httpServer.close(err => {
    if (err) {
      console.error('❌ Error during server shutdown:', err)
      process.exit(1)
    }

    console.log('✅ HTTP server closed')

    // Close Socket.IO connections
    io.close(async () => {
      console.log('✅ Socket.IO server closed')

      // Close database connections
      try {
        await closeDatabase()
        console.log('✅ Database connections closed')
      } catch (error) {
        console.error('❌ Error closing database:', error)
      }

      console.log('🎯 Graceful shutdown complete')
      process.exit(0)
    })
  })

  // Force exit after 30 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('⏰ Graceful shutdown timeout - forcing exit')
    process.exit(1)
  }, 30000)
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', err => {
  console.error('💥 Uncaught Exception:', err)
  gracefulShutdown('uncaughtException')
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown('unhandledRejection')
})

// Function to find available port
async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 10
): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentPort = startPort
    let attempts = 0

    function tryPort(port: number) {
      const testServer = require('net').createServer()

      testServer.listen(port, (err: any) => {
        if (err) {
          testServer.close()
          attempts++

          if (attempts >= maxAttempts) {
            reject(
              new Error(
                `No available port found after ${maxAttempts} attempts starting from ${startPort}`
              )
            )
            return
          }

          console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`)
          tryPort(port + 1)
        } else {
          testServer.close(() => {
            resolve(port)
          })
        }
      })

      testServer.on('error', (err: any) => {
        testServer.close()
        attempts++

        if (attempts >= maxAttempts) {
          reject(
            new Error(
              `No available port found after ${maxAttempts} attempts starting from ${startPort}`
            )
          )
          return
        }

        console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`)
        tryPort(port + 1)
      })
    }

    tryPort(currentPort)
  })
}

// Start server with port conflict handling
async function startServer() {
  try {
    // Initialize database first
    console.log('🔄 Starting FuzeFront Backend Server...')
    await initializeDatabase()

    // Initialize OIDC service
    try {
      console.log('🔧 Initializing OIDC service...')
      if (oidcService.isConfigured()) {
        await oidcService.initialize()
        console.log('✅ OIDC service initialized successfully')
      } else {
        console.log('⚠️  OIDC service not configured - local auth only')
        console.log('💡 Set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET to enable OIDC')
      }
    } catch (error) {
      console.error('❌ Failed to initialize OIDC service:', error)
      console.log('⚠️  Continuing with local authentication only')
    }

    const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT
    const availablePort = await findAvailablePort(portNumber)

    if (availablePort !== portNumber) {
      console.log(
        `🔄 Original port ${portNumber} was busy, using port ${availablePort} instead`
      )
    }

    httpServer.listen(availablePort, () => {
      console.log(
        `🚀 FuzeFront backend server running on port ${availablePort}`
      )
      console.log(
        `🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`
      )
      console.log(`📡 WebSocket server ready`)
      console.log(
        `📚 API Documentation: http://localhost:${availablePort}/api-docs`
      )
      console.log(`💓 Health Check: http://localhost:${availablePort}/health`)
      console.log(`🗄️  Database: PostgreSQL (shared-postgres)`)
      
      // Log authentication methods available
      const authMethods = ['Local Database']
      if (oidcService.isConfigured()) {
        authMethods.push('OIDC (Authentik)')
      }
      console.log(`🔐 Authentication: ${authMethods.join(', ')}`)

      // Update PORT variable for other parts of the app
      process.env.PORT = availablePort.toString()
    })

    httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${availablePort} is already in use`)
        console.log(
          '💡 This might happen if another instance is already running'
        )
        console.log('💡 Try stopping other instances or use a different port')
        gracefulShutdown('EADDRINUSE')
      } else {
        console.error('❌ Server error:', err)
        gracefulShutdown('ServerError')
      }
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    console.log('💡 Please check if ports 3001-3010 are available')
    process.exit(1)
  }
}

// Start the server
startServer()

export default app
