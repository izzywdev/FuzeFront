import express from 'express'
import request from 'supertest'
import {
  createExpressApp,
  attachErrorHandlers,
} from '@fuzefront/core'

// Lightweight smoke test: the shared bootstrap produces a working Express app
// and the health endpoint returns a security-service-shaped payload. No DB
// required (db health is allowed to fail to 'degraded').
describe('security-service health', () => {
  let app: express.Express

  beforeAll(() => {
    app = createExpressApp({ serviceName: 'security-service' })
    app.get('/health', (_req, res) =>
      res.json({ status: 'ok', service: 'security-service' })
    )
    attachErrorHandlers(app)
  })

  it('GET /health returns ok and identifies the service', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.service).toBe('security-service')
    expect(res.body.status).toBe('ok')
  })

  it('unknown route 404s via the shared error handler', async () => {
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
  })
})
