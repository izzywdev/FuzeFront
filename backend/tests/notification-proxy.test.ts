// Unit tests for the host-backend notification proxy
// (backend/src/routes/notifications.ts).
//
// Pure unit tests: the upstream HTTP client is mocked, so this runs without a
// database or a live notification-service. What matters here is the wiring and
// the one security-relevant decision the proxy makes on its own — that the
// service's `/internal/*` publish surface is NOT reachable from the browser.

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

import request from 'supertest'
import express from 'express'

process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test:3008'

import notificationRoutes, {
  __notificationProxyConfig,
} from '../src/routes/notifications'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/notifications', notificationRoutes)
  return app
}

function okUpstream(body: unknown, status = 200) {
  mockedAxios.request.mockResolvedValueOnce({
    status,
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify(body)),
  } as any)
}

describe('notification proxy', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('forwards a list request to the service contract path', async () => {
    okUpstream({ notifications: [], nextCursor: null })

    const res = await request(app)
      .get('/api/v1/notifications?limit=5')
      .set('Authorization', 'Bearer user-token')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ notifications: [], nextCursor: null })

    const call = mockedAxios.request.mock.calls[0][0] as any
    expect(call.method).toBe('GET')
    expect(call.url).toBe('http://notifications.test:3008/notifications/?limit=5')
  })

  it("forwards the caller's bearer token verbatim and injects no internal token", async () => {
    okUpstream({ unread: 2 })

    await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', 'Bearer user-token')

    const call = mockedAxios.request.mock.calls[0][0] as any
    expect(call.headers.Authorization).toBe('Bearer user-token')
    // The service derives the recipient from this very token, so there is
    // nothing for the proxy to elevate — and nothing it should.
    expect(call.headers['X-Internal-Token']).toBeUndefined()
  })

  it('re-serializes a JSON body for write methods', async () => {
    okUpstream({ updated: 3 })

    await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', 'Bearer user-token')
      .send({ organizationId: 'org-1' })

    const call = mockedAxios.request.mock.calls[0][0] as any
    expect(call.method).toBe('POST')
    expect(call.data).toEqual({ organizationId: 'org-1' })
    expect(call.headers['Content-Type']).toBe('application/json')
  })

  it('relays a non-2xx status and body unchanged', async () => {
    okUpstream({ error: 'Notification not found' }, 404)

    const res = await request(app)
      .post('/api/v1/notifications/abc/read')
      .set('Authorization', 'Bearer user-token')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Notification not found' })
  })

  it('answers 502 when the service is unreachable', async () => {
    mockedAxios.request.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer user-token')

    // A clean error, not a hang: the shell degrades to an empty bell on any
    // failure, but only if the request actually terminates.
    expect(res.status).toBe(502)
    expect(res.body.error).toBe('notification_service_unavailable')
  })

  describe('the internal publish surface is not reachable from the browser', () => {
    it('404s /internal/publish without forwarding it', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/internal/publish')
        .set('Authorization', 'Bearer user-token')
        .send({ recipients: ['x'], type: 't', title: 'T' })

      expect(res.status).toBe(404)
      // Never forwarded — the request dies here, at the edge.
      expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('404s /internal with a query string appended', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/internal/publish?bypass=1')
        .set('Authorization', 'Bearer user-token')
        .send({})

      expect(res.status).toBe(404)
      expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('classifies internal paths correctly', () => {
      const { isForbiddenPath } = __notificationProxyConfig
      expect(isForbiddenPath('/internal')).toBe(true)
      expect(isForbiddenPath('/internal/publish')).toBe(true)
      expect(isForbiddenPath('/internal/publish?x=1')).toBe(true)
      // Not a false positive: a notification id is not the internal surface.
      expect(isForbiddenPath('/internal-looking-id/read')).toBe(false)
      expect(isForbiddenPath('/unread-count')).toBe(false)
    })
  })

  describe('SSE', () => {
    it('classifies the stream path', () => {
      const { isStreamPath } = __notificationProxyConfig
      expect(isStreamPath('/stream')).toBe(true)
      expect(isStreamPath('/stream?token=abc')).toBe(true)
      expect(isStreamPath('/streaming')).toBe(false)
    })

    it('forwards the stream with responseType:stream and no timeout', async () => {
      const { Readable } = require('stream')
      const upstreamBody = new Readable({ read() { this.push(null) } })
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        data: upstreamBody,
      } as any)

      await request(app)
        .get('/api/v1/notifications/stream?token=abc')
        .set('Authorization', 'Bearer user-token')

      const call = mockedAxios.request.mock.calls[0][0] as any
      expect(call.responseType).toBe('stream')
      // A buffered forward would hold every event until the response ended —
      // which, for a stream, is never.
      expect(call.timeout).toBe(0)
    })
  })
})
