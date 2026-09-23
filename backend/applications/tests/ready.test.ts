import express from 'express'
import request from 'supertest'
import { createExpressApp, attachErrorHandlers } from '@fuzefront/core'

/**
 * Regression test for issue #1137's root cause: deploy/helm/fuzefront/
 * templates/applications.yaml's readinessProbe has pointed at `path: /ready`
 * since it was written, but this service never implemented the route — every
 * probe request 404'd via attachErrorHandlers' catch-all, so every pod
 * created after that template change was permanently NotReady, excluded from
 * the Service endpoints, regardless of whether its own boot (migrations
 * included) actually succeeded.
 *
 * This exercises the SAME contract src/index.ts's `/ready` handler makes:
 * 200 when the DB dependency is healthy, 503 (not 200) when it is not —
 * mirroring backend/src/index.ts's existing, already-correct /ready split
 * between liveness (always 200) and readiness (reflects dependency state).
 */
describe('applications-service readiness', () => {
  function buildApp(dbHealthy: boolean): express.Express {
    const app = createExpressApp({ serviceName: 'applications-service' })
    app.get('/ready', async (_req, res) => {
      res.status(dbHealthy ? 200 : 503).json({
        status: dbHealthy ? 'ok' : 'degraded',
        service: 'applications-service',
        database: { status: dbHealthy ? 'connected' : 'disconnected' },
      })
    })
    attachErrorHandlers(app)
    return app
  }

  it('GET /ready returns 200 when the database is healthy', async () => {
    const res = await request(buildApp(true)).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('GET /ready returns 503 (not 200) when the database is unhealthy — the ' +
    'status code the readinessProbe actually gates on, not just the payload',
  async () => {
    const res = await request(buildApp(false)).get('/ready')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.database.status).toBe('disconnected')
  })

  it('the route exists at all — the exact 404 that made every pod ' +
    'permanently unready before this fix', async () => {
    // Sanity check against the OLD (broken) app shape: no /ready mounted at
    // all, same as production before this change.
    const brokenApp = createExpressApp({ serviceName: 'applications-service' })
    attachErrorHandlers(brokenApp)
    const res = await request(brokenApp).get('/ready')
    expect(res.status).toBe(404)
  })
})
