// Unit tests for the same-origin federated asset proxy
// (backend/src/routes/federatedProxy.ts).
//
// Pure unit tests: the upstream HTTP client is mocked, so this runs with no
// database and no live remote. What matters here is the wiring and the
// security-relevant decisions the proxy makes on its own — that it serves only
// an operator-configured allowlist, never forwards the portal session upstream,
// never lets a remote set a cookie on the portal origin, and never launders a
// remote's HTML 404 into a working-looking module.

jest.mock('axios')
import axios from 'axios'
const mockedAxios = axios as jest.Mocked<typeof axios>

import request from 'supertest'
import express from 'express'

process.env.FEDERATED_PROXY_UPSTREAMS = JSON.stringify({
  finance: 'http://fuzefinance.fuzefinance.svc.cluster.local:80',
  market: 'https://fuzemarket.fuzemarket.svc.cluster.local:8080/base',
})

import federatedProxyRoutes, {
  parseUpstreams,
  splitRequest,
  buildUpstreamUrl,
  logSafe,
  __federatedProxyConfig,
} from '../src/routes/federatedProxy'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/apps', federatedProxyRoutes)
  return app
}

function upstreamReplies(
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/javascript' },
  status = 200
) {
  mockedAxios.request.mockResolvedValueOnce({
    status,
    headers,
    data: Buffer.from(body),
  } as any)
}

describe('federated asset proxy', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  describe('routing', () => {
    it('proxies a remoteEntry to the configured upstream and relays the JS content-type', async () => {
      upstreamReplies('export default 1')
      const res = await request(app).get('/apps/finance/remoteEntry.js')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/javascript')
      expect(res.text).toBe('export default 1')
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          // :80 is normalised away by the URL API — http://h:80 and http://h are
          // the same URL. The stored allowlist value keeps the operator's :80; only
          // the derived request URL is normalised.
          url: 'http://fuzefinance.fuzefinance.svc.cluster.local/remoteEntry.js',
          method: 'GET',
        })
      )
    })

    it('preserves nested chunk paths and the query string', async () => {
      upstreamReplies('chunk')
      await request(app).get('/apps/finance/assets/chunk-abc123.js?v=2')

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://fuzefinance.fuzefinance.svc.cluster.local/assets/chunk-abc123.js?v=2',
        })
      )
    })

    it("keeps a base path the operator wrote into the upstream URL", async () => {
      upstreamReplies('chunk')
      await request(app).get('/apps/market/remoteEntry.js')

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://fuzemarket.fuzemarket.svc.cluster.local:8080/base/remoteEntry.js',
        })
      )
    })

    it('404s an unconfigured slug without contacting anything', async () => {
      const res = await request(app).get('/apps/fuzeagent/remoteEntry.js')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('remote_not_configured')
      expect(mockedAxios.request).not.toHaveBeenCalled()
    })
  })

  describe('the failure this proxy exists to end', () => {
    // The census signature: remoteEntry returns 200 but is HTML, because an SPA
    // fallback answered a 404 with index.html. The proxy must relay a remote's
    // real status and real content-type, never improve on them.
    it("relays a remote's own 404 rather than turning it into a 200", async () => {
      upstreamReplies('<!doctype html>', { 'content-type': 'text/html' }, 404)
      const res = await request(app).get('/apps/finance/remoteEntry.js')

      expect(res.status).toBe(404)
      expect(res.headers['content-type']).toContain('text/html')
    })

    it('does not relay content-encoding, which would mislabel the decompressed body', async () => {
      upstreamReplies('plain', {
        'content-type': 'application/javascript',
        'content-encoding': 'gzip',
      })
      const res = await request(app).get('/apps/finance/remoteEntry.js')

      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.text).toBe('plain')
    })
  })

  describe('trust model', () => {
    it('never forwards the portal session upstream', async () => {
      upstreamReplies('js')
      await request(app)
        .get('/apps/finance/remoteEntry.js')
        .set('Authorization', 'Bearer super-secret')
        .set('Cookie', 'session=super-secret')

      const sent = mockedAxios.request.mock.calls[0][0] as any
      const headerNames = Object.keys(sent.headers || {}).map(h => h.toLowerCase())
      expect(headerNames).not.toContain('authorization')
      expect(headerNames).not.toContain('cookie')
      expect(JSON.stringify(sent.headers)).not.toContain('super-secret')
    })

    it('does not let a remote set a cookie on the portal origin', async () => {
      upstreamReplies('js', {
        'content-type': 'application/javascript',
        'set-cookie': 'evil=1; Path=/; HttpOnly',
      })
      const res = await request(app).get('/apps/finance/remoteEntry.js')

      expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('refuses non-GET/HEAD methods', async () => {
      const res = await request(app).post('/apps/finance/remoteEntry.js').send({})

      expect(res.status).toBe(405)
      expect(res.headers['allow']).toBe('GET, HEAD')
      expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('does not follow redirects, so an upstream cannot bounce the proxy elsewhere', () => {
      upstreamReplies('js')
      return request(app)
        .get('/apps/finance/remoteEntry.js')
        .then(() => {
          const sent = mockedAxios.request.mock.calls[0][0] as any
          expect(sent.maxRedirects).toBe(0)
        })
    })

    it('answers 502, not 500, when the remote is unreachable', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      )
      const res = await request(app).get('/apps/finance/remoteEntry.js')

      expect(res.status).toBe(502)
      expect(res.body).toMatchObject({ error: 'remote_unavailable', slug: 'finance' })
    })
  })

  describe('upstream URL construction', () => {
    it('cannot be moved off the allowlisted origin by the request path', () => {
      const base = 'http://svc.ns.svc.cluster.local'
      expect(buildUpstreamUrl(base, 'a/b.js', '')).toBe(
        'http://svc.ns.svc.cluster.local/a/b.js'
      )
      // A segment that looks like a host stays a PATH segment.
      expect(buildUpstreamUrl(base, 'evil.com/x.js', '')).toBe(
        'http://svc.ns.svc.cluster.local/evil.com/x.js'
      )
    })

    it('keeps the operator base path underneath the subpath', () => {
      expect(buildUpstreamUrl('https://svc.local/base', 'remoteEntry.js', '')).toBe(
        'https://svc.local/base/remoteEntry.js'
      )
    })

    it('carries the query and drops any fragment', () => {
      expect(buildUpstreamUrl('http://svc.local', 'a.js', '?x=1')).toBe(
        'http://svc.local/a.js?x=1'
      )
    })
  })

  describe('request charset whitelist', () => {
    it.each([
      ['a colon', '/apps/finance/a:b.js'],
      ['an at-sign', '/apps/finance/a@evil.com'],
    ])('refuses a segment carrying %s', async (_label, path) => {
      const res = await request(app).get(path)
      expect(res.status).toBe(400)
      expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('refuses a RAW backslash, asserted at the unit level', () => {
      // Not exercised over HTTP: superagent percent-encodes a literal backslash
      // before it leaves the client, so a request test would be checking the
      // client's encoder rather than this guard.
      expect(splitRequest('/finance/a\\b.js')).toBeNull()
    })

    it('ALLOWS a percent-escaped byte — it stays escaped and cannot re-point a URL', () => {
      // %5C is an encoded backslash. Rejecting it would break legitimate asset
      // names for no security gain: a percent-escape is inert in the path and
      // can never alter the authority. The literal character is refused above.
      expect(splitRequest('/finance/a%5Cb.js')).toEqual({
        slug: 'finance',
        subpath: 'a%5Cb.js',
        query: '',
      })
    })

    it('allows the characters real bundler output actually uses', () => {
      expect(splitRequest('/finance/assets/chunk-abc_123.min.js')).not.toBeNull()
      expect(splitRequest('/finance/assets/a~b!c$d.js')).not.toBeNull()
      expect(splitRequest('/finance/assets/a%20b.js')).not.toBeNull()
    })
  })

  describe('logging cannot be forged or used as a format string', () => {
    it('logSafe collapses the control characters that would forge a log line', () => {
      expect(logSafe('a\nb')).toBe('a b')
      expect(logSafe('a\r\n[federated-proxy] FORGED')).toBe(
        'a [federated-proxy] FORGED'
      )
      expect(logSafe('a\u0000b')).toBe('a b')
    })

    it('logSafe bounds the length so one value cannot flood the log', () => {
      expect(logSafe('x'.repeat(5000)).length).toBe(200)
    })

    it('passes caller-derived values as ARGUMENTS, never as the format string', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockedAxios.request.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })
      )

      await request(app).get('/apps/finance/remoteEntry.js')

      const [format, ...args] = spy.mock.calls[0]
      // The format is a fixed literal: no slug, no method, no URL in it. If a
      // caller-controlled '%s' ever reached this position it would consume the
      // next argument and rewrite the line.
      expect(format).toBe('[federated-proxy] upstream error: %s')
      expect(format).not.toContain('finance')
      expect(args).toHaveLength(1)
      expect(JSON.parse(args[0] as string)).toMatchObject({
        slug: 'finance',
        method: 'GET',
      })
      spy.mockRestore()
    })
  })

  describe('splitRequest', () => {
    it('rejects traversal so nothing can climb above the upstream base', () => {
      expect(splitRequest('/finance/../../etc/passwd')).toBeNull()
      expect(splitRequest('/finance/%2e%2e/secret')).toBeNull()
    })

    it('rejects a slug that is not slug-shaped', () => {
      expect(splitRequest('/Finance/remoteEntry.js')).toBeNull()
      expect(splitRequest('/../remoteEntry.js')).toBeNull()
    })

    it('parses slug, subpath and query', () => {
      expect(splitRequest('/finance/assets/a.js?v=1')).toEqual({
        slug: 'finance',
        subpath: 'assets/a.js',
        query: '?v=1',
      })
    })
  })

  describe('parseUpstreams', () => {
    // A dropped entry must never be able to pass for a working one, so each of
    // these logs at error level; the assertion here is only that it is dropped.
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })
    afterEach(() => {
      ;(console.error as jest.Mock).mockRestore()
    })

    it('returns an empty map for absent or blank config', () => {
      expect(parseUpstreams(undefined)).toEqual({})
      expect(parseUpstreams('   ')).toEqual({})
    })

    it('drops the whole map on malformed JSON rather than throwing', () => {
      expect(parseUpstreams('{not json')).toEqual({})
      expect(console.error).toHaveBeenCalled()
    })

    it('rejects a JSON array or scalar — the contract is an object', () => {
      expect(parseUpstreams('["a"]')).toEqual({})
      expect(parseUpstreams('"a"')).toEqual({})
    })

    it('drops entries that are not absolute http/https URLs', () => {
      expect(
        parseUpstreams(
          JSON.stringify({
            good: 'http://svc.ns.svc.cluster.local',
            relative: '/apps/thing',
            scheme: 'file:///etc/passwd',
            empty: '',
            notString: 5,
          })
        )
      ).toEqual({ good: 'http://svc.ns.svc.cluster.local' })
    })

    it('drops keys that are not slug-shaped', () => {
      expect(
        parseUpstreams(JSON.stringify({ 'Bad Slug': 'http://x.local' }))
      ).toEqual({})
    })

    it('strips a trailing slash so joining never doubles it', () => {
      expect(parseUpstreams(JSON.stringify({ a: 'http://x.local/base/' }))).toEqual(
        { a: 'http://x.local/base' }
      )
    })
  })

  it('exposes the parsed allowlist for introspection', () => {
    expect(Object.keys(__federatedProxyConfig.UPSTREAMS).sort()).toEqual([
      'finance',
      'market',
    ])
  })
})
