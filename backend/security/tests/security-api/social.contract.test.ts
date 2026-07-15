/**
 * Contract tests: server-brokered social login 302 semantics + the BOUNDARY
 * guarantee (no internal identity host / vendor name ever visible to browser).
 */
import { agent, RUNNING_AGAINST } from './harness'
import {
  assertSchema,
  ALLOWED_SOCIAL_HOSTS,
  FORBIDDEN_INTERNAL_HOST,
  FORBIDDEN_VENDOR_TOKENS,
} from './spec'

function hostOf(location: string): string {
  // Location may be absolute or app-relative; only absolute has a host.
  try {
    return new URL(location).host
  } catch {
    return '' // relative → same-origin (app.fuzefront.com), inherently owned
  }
}

describe(`social login 302 + boundary (against ${RUNNING_AGAINST})`, () => {
  describe('GET /social/{provider}/start', () => {
    it('302-redirects to a FuzeFront-owned or Google host only', async () => {
      const res = await agent().get('/api/v1/security/social/google/start').redirects(0)
      expect(res.status).toBe(302)
      const loc = res.headers['location']
      expect(typeof loc).toBe('string')

      const host = hostOf(loc)
      if (host) {
        expect(ALLOWED_SOCIAL_HOSTS.has(host)).toBe(true)
      }
      // The internal identity host must NEVER appear.
      expect(loc.toLowerCase()).not.toContain(FORBIDDEN_INTERNAL_HOST)
      for (const vendor of FORBIDDEN_VENDOR_TOKENS) {
        expect(loc.toLowerCase()).not.toContain(vendor)
      }
    })

    it('rejects an absolute (cross-origin) redirectTo with 400', async () => {
      const res = await agent()
        .get('/api/v1/security/social/google/start')
        .query({ redirectTo: 'https://evil.example.com/phish' })
        .redirects(0)
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })

    it('400 → ErrorBody for an unsupported provider slug', async () => {
      const res = await agent().get('/api/v1/security/social/myspace/start').redirects(0)
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('GET /social/callback', () => {
    it('302s back to the app with an opaque ?code= (no token in URL)', async () => {
      const res = await agent()
        .get('/api/v1/security/social/callback')
        .query({ code: 'provider-auth-code', state: 'valid-state' })
        .redirects(0)
      expect(res.status).toBe(302)
      const loc = res.headers['location']
      expect(loc).toContain('code=')
      // No session token ever placed in the redirect URL.
      expect(loc.toLowerCase()).not.toMatch(/token=/)
      expect(loc.toLowerCase()).not.toContain(FORBIDDEN_INTERNAL_HOST)
    })

    it('401 → ErrorBody when required params are missing (fail-closed)', async () => {
      const res = await agent().get('/api/v1/security/social/callback').redirects(0)
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })
  })
})
