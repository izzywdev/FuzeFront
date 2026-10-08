import request from 'supertest'

/**
 * Regression test for issue #1137's root cause: deploy/helm/fuzefront/
 * templates/applications.yaml's readinessProbe has pointed at `path: /ready`
 * since it was written, but this service never implemented the route --
 * every probe request 404'd via attachErrorHandlers' catch-all, so every pod
 * created after that template change was permanently NotReady, excluded from
 * the Service endpoints, regardless of whether its own boot (migrations
 * included) actually succeeded.
 *
 * This imports the REAL app exported by src/index.ts -- not a reimplemented
 * handler -- so it exercises the actual production wiring. `startServer()`
 * is guarded behind `require.main === module` in src/index.ts specifically
 * so this import is safe (no DB waits, no migrations, no process.exit).
 *
 * LOAD-BEARING PROOF (do not remove this comment without re-running the
 * check it describes): temporarily deleting the `app.get('/ready', ...)`
 * block from src/index.ts and re-running this file turns the first two
 * tests below red (`Cannot GET /ready` / 404, not 200/503) -- confirmed
 * locally while authoring this fix. Restoring the block turns them green
 * again. That is what makes this a real regression test rather than the
 * vacuous-gate pattern CLAUDE.md warns about: it can only pass if src/
 * index.ts actually mounts the route, not merely if some handler function
 * with the right shape exists somewhere in the codebase.
 */
describe('applications-service readiness (real app, real route)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const app = require('../src/index').default

  it('GET /ready exists and returns a readiness payload, not a 404', async () => {
    const res = await request(app).get('/ready')
    expect(res.status).not.toBe(404)
    expect([200, 503]).toContain(res.status)
    expect(res.body.service).toBe('applications-service')
    expect(res.body.database).toBeDefined()
  })

  it('GET /ready status code matches its own payload status (200<->ok, 503<->degraded)', async () => {
    const res = await request(app).get('/ready')
    if (res.body.status === 'ok') {
      expect(res.status).toBe(200)
    } else {
      expect(res.body.status).toBe('degraded')
      expect(res.status).toBe(503)
    }
  })
})
