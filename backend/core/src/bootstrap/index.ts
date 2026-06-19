import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { v4 as uuidv4 } from 'uuid'

export interface CreateExpressAppOptions {
  /** Extra CORS origins beyond FRONTEND_URL + localhost defaults. */
  corsOrigins?: string[]
  /** Service name used in request log lines. */
  serviceName?: string
}

/**
 * Boilerplate Express app used by every FuzeFront backend service: helmet (CSP
 * tuned for microfrontend iframes), CORS, JSON/urlencoded parsing, request-id
 * logging. Route mounting + error/404 handlers are left to the caller (mount
 * routes, THEN call attachErrorHandlers). Zero business logic.
 */
export function createExpressApp(options: CreateExpressAppOptions = {}): Express {
  const app = express()
  const serviceName = options.serviceName || 'backend'

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameSrc: ["'self'", '*'],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        },
      },
    })
  )

  app.use(
    cors({
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'http://localhost:8085',
        'http://localhost:3004',
        'http://fuzefront-frontend-prod:8080',
        ...(options.corsOrigins || []),
      ],
      credentials: true,
    })
  )

  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const requestId = uuidv4().substring(0, 8)
    req.requestId = requestId
    console.log(
      `📥 [${serviceName}:${requestId}] ${req.method} ${req.path}`
    )
    next()
  })

  return app
}

/**
 * Attach the standard 500 + 404 handlers. Call AFTER all routes are mounted.
 */
export function attachErrorHandlers(app: Express): void {
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Something went wrong!' })
  })

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })
}
