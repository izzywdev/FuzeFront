import request from 'supertest'
import express from 'express'

jest.mock('../src/utils/logger', () => {
  const fn = () => jest.fn()
  return { logger: { error: fn(), warn: fn(), info: fn(), debug: fn() } }
})

import { logger } from '../src/utils/logger'
import rumRoutes from '../src/routes/rum'

const log = logger as unknown as Record<'error' | 'warn' | 'info' | 'debug', jest.Mock>

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/rum', rumRoutes)
  return app
}

const SESSION = 'sess-12345678'
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

function payload(events: unknown[], over: Record<string, unknown> = {}) {
  return { v: 1, service: 'fuzefront-frontend', release: '1.0.0', session_id: SESSION, events, ...over }
}

beforeEach(() => {
  Object.values(log).forEach(m => m.mockClear())
})

describe('POST /api/v1/rum', () => {
  it('accepts a payload without auth and logs each event as structured JSON', async () => {
    const res = await request(makeApp())
      .post('/api/v1/rum')
      .send(
        payload([
          { type: 'web-vital', ts: 1, name: 'LCP', route: '/', value: 1200, attrs: { rating: 'good' } },
          { type: 'error', ts: 2, name: 'uncaught_error', route: '/apps', message: 'boom', trace_id: TRACE },
          { type: 'log', ts: 3, name: 'warn', route: '/', message: 'slow thing' },
        ])
      )
    expect(res.status).toBe(204)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledTimes(1)

    const [fields, msg] = log.error.mock.calls[0]
    expect(msg).toBe('boom')
    expect(fields).toMatchObject({
      source: 'rum',
      release: '1.0.0',
      session_id: SESSION,
      trace_id: TRACE,
      clientService: 'fuzefront-frontend',
      rum: { type: 'error', name: 'uncaught_error', route: '/apps' },
    })
  })

  it('accepts what sendBeacon actually sends (application/json body)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/rum')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload([{ type: 'log', ts: 1, name: 'info', message: 'hi' }])))
    expect(res.status).toBe(204)
    expect(log.info).toHaveBeenCalledTimes(1)
  })

  it('rejects a structurally invalid payload with 400 and logs nothing at info+', async () => {
    const app = makeApp()
    for (const bad of [{}, { v: 2 }, payload([], { session_id: 'x' }), { ...payload([]), events: 'nope' }]) {
      const res = await request(app).post('/api/v1/rum').send(bad)
      expect(res.status).toBe(400)
    }
    expect(log.info).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('drops individually invalid events but keeps the valid ones', async () => {
    const res = await request(makeApp())
      .post('/api/v1/rum')
      .send(
        payload([
          { type: 'bogus', ts: 1, name: 'x' },
          { type: 'log', ts: 1, name: 'info', message: 'ok' },
          { type: 'error', ts: 1, name: 'e', trace_id: 'not-hex' },
        ])
      )
    expect(res.status).toBe(204)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('caps events per payload', async () => {
    const events = Array.from({ length: 120 }, (_, i) => ({ type: 'log', ts: i, name: 'info', message: `m${i}` }))
    const res = await request(makeApp()).post('/api/v1/rum').send(payload(events))
    expect(res.status).toBe(204)
    expect(log.info).toHaveBeenCalledTimes(50)
  })

  it('re-redacts secrets/PII the client failed to strip', async () => {
    await request(makeApp())
      .post('/api/v1/rum')
      .send(
        payload([
          {
            type: 'log',
            ts: 1,
            name: 'error',
            message: 'failed for bob@example.com with Bearer abcdef123456',
            attrs: { password: 'hunter2', nested: { access_token: 'tok' }, note: 'x@y.com' },
          },
        ])
      )
    const [fields, msg] = log.error.mock.calls[0]
    const serialized = JSON.stringify([fields, msg])
    expect(serialized).not.toContain('bob@example.com')
    expect(serialized).not.toContain('abcdef123456')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('"tok"')
    expect(serialized).not.toContain('x@y.com')
  })

  it('maps a failed resource to warn', async () => {
    await request(makeApp())
      .post('/api/v1/rum')
      .send(payload([{ type: 'resource', ts: 1, name: 'script', value: 5, attrs: { failed: true } }]))
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('rate-limits a flood per IP with 429', async () => {
    const app = makeApp()
    const body = payload([{ type: 'log', ts: 1, name: 'info', message: 'x' }])
    let limited = 0
    for (let i = 0; i < 130; i++) {
      const res = await request(app).post('/api/v1/rum').send(body)
      if (res.status === 429) limited += 1
    }
    expect(limited).toBeGreaterThan(0)
  })
})
