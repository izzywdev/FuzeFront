import { describe, expect, it } from 'vitest'
import express from 'express'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenApiSurface, loadSpec, CONTRACT_VERSION, SERVICE_NAME } from './openapi'
import { isPublicRequest } from './authentication'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_SPEC = resolve(HERE, '../../../contracts/openapi.yaml')
const MISSING_SPEC = '/nonexistent/openapi.yaml'

/**
 * Mount the surface on a bare Express app and drive it over a real socket.
 *
 * Deliberately NOT importing apps/api/src/index.ts: that module calls
 * app.listen() at import time and constructs a Kafka bus and a catalog store,
 * so importing it in a unit test would bind a port and open connections. The
 * surface under test is a router, and a router is testable on its own.
 */
async function withSurface(
  env: NodeJS.ProcessEnv,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = express()
  app.use(createOpenApiSurface(env).router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', () => resolve()))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  try {
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('GET /health', () => {
  it('reports ok, the service, the contract version and spec availability', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'ok',
        service: SERVICE_NAME,
        version: CONTRACT_VERSION,
        openapi: 'available',
      })
    })
  })

  it('stays 200 with openapi:"unavailable" when the spec is missing', async () => {
    // The distinction that matters: a build shipped without its contract must be
    // VISIBLE, not fatal. A non-200 here would CrashLoopBackOff the pod over a
    // problem that restarting it cannot fix.
    await withSurface({ OPENAPI_SPEC_PATH: MISSING_SPEC }, async base => {
      const response = await fetch(`${base}/health`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.openapi).toBe('unavailable')
    })
  })
})

describe('contract discovery', () => {
  it('serves the committed bytes at /openapi.yaml', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/openapi.yaml`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('yaml')
      expect(await response.text()).toContain('openapi: 3.0.3')
    })
  })

  it('serves the same document as JSON at /openapi.json', async () => {
    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      const response = await fetch(`${base}/openapi.json`)
      expect(response.status).toBe(200)
      const document = await response.json()
      expect(document.info.title).toBe('FuzeQuality')
      expect(document.info.version).toBe(CONTRACT_VERSION)
    })
  })

  it('answers 503 — not 404 — when the document is missing', async () => {
    // 404 would read as "this service publishes no spec". It does; the document
    // is what is missing, and the two need different fixes.
    await withSurface({ OPENAPI_SPEC_PATH: MISSING_SPEC }, async base => {
      for (const path of ['/openapi.yaml', '/openapi.json']) {
        const response = await fetch(`${base}${path}`)
        expect(response.status, `${path} should be 503`).toBe(503)
        expect((await response.json()).code).toBe('openapi_unavailable')
      }
    })
  })
})

describe('the contract and the implementation agree', () => {
  it('every path the contract declares is served by this process', async () => {
    // The guard against a contract describing endpoints nobody implemented —
    // which is precisely the failure FuzeQuality exists to detect in OTHER
    // repositories. /health/live, /health/ready and /metrics live in index.ts
    // rather than this router, so they are asserted separately below.
    const loaded = loadSpec({ OPENAPI_SPEC_PATH: REPO_SPEC })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const document = JSON.parse(loaded.spec.json) as { paths: Record<string, unknown> }
    const routed = Object.keys(document.paths).filter(path => !path.startsWith('/health/'))

    await withSurface({ OPENAPI_SPEC_PATH: REPO_SPEC }, async base => {
      for (const path of routed) {
        const response = await fetch(`${base}${path}`)
        expect(response.status, `${path} is in the contract but not served`).not.toBe(404)
      }
    })
  })

  it('every operational path in the contract is reachable without a token', async () => {
    // A probe endpoint the API-token guard rejects is a probe endpoint that
    // fails for the kubelet, the nginx proxy and the portal alike — none of
    // which send one. `/health` in particular is NOT matched by the
    // `/health/` prefix rule, which is exactly how it would have been missed.
    const loaded = loadSpec({ OPENAPI_SPEC_PATH: REPO_SPEC })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const document = JSON.parse(loaded.spec.json) as { paths: Record<string, unknown> }

    for (const path of Object.keys(document.paths)) {
      expect(isPublicRequest('GET', path), `${path} must be public`).toBe(true)
    }
  })
})
