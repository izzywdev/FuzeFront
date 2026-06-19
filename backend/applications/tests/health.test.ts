import express from 'express'
import request from 'supertest'
import { createExpressApp, attachErrorHandlers } from '@fuzefront/core'

describe('applications-service health', () => {
  let app: express.Express

  beforeAll(() => {
    app = createExpressApp({ serviceName: 'applications-service' })
    app.get('/health', (_req, res) =>
      res.json({ status: 'ok', service: 'applications-service' })
    )
    attachErrorHandlers(app)
  })

  it('GET /health returns ok and identifies the service', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.service).toBe('applications-service')
  })

  it('unknown route 404s', async () => {
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
  })
})
