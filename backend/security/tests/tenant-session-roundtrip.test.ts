/**
 * Cross-tenant session round-trip, THROUGH THE REAL MIDDLEWARE.
 *
 * The registry tests assert the pieces in isolation. This one wires them the
 * way production does — express -> tenantContext -> handler -> AsyncLocalStorage
 * -> sessionTenantId()/assertTenantMatches — and asserts the property that
 * actually matters:
 *
 *   A session minted while serving tenant A must NOT be accepted on a host
 *   serving tenant B.
 *
 * This is not belt-and-braces. Every tenant's sessions are signed with the SAME
 * JWT secret, so a token minted in one directory verifies perfectly against
 * another's — `jwt.verify` alone cannot tell them apart. The `tid` claim plus
 * the host-derived tenant is the ONLY thing separating the two account
 * directories. If this test fails, an account in one silo can act in another.
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import {
  assertTenantMatches,
  sessionTenantId,
  tenantContext,
} from '../src/middleware/tenant-context'
import { resetTenantRegistryForTests } from '../src/providers/authentik/tenants'

const JWT_SECRET = 'test-secret-shared-by-every-tenant'

const ENV_KEYS = ['SECURITY_TENANTS', 'FRONTEND_URL', 'JWT_SECRET']
let saved: Record<string, string | undefined>

const TENANTS = JSON.stringify([
  {
    id: 'fuzefront',
    hosts: ['app.fuzefront.com'],
    issuerUrl: 'https://app.fuzefront.com/application/o/fuzefront/',
    baseUrl: 'http://authentik-server:9000',
    clientId: 'fuzefront-oidc-client',
    redirectUri: 'https://app.fuzefront.com/api/auth/oidc/callback',
    enrollmentFlowSlug: 'fuzefront-enrollment',
    appBaseUrl: 'https://app.fuzefront.com',
  },
  {
    id: 'mendys',
    hosts: ['live.mendysrobotics.com', 'marketplace.mendysrobotics.com'],
    issuerUrl: 'https://live.mendysrobotics.com/application/o/mendys-platform/',
    baseUrl: 'http://authentik-mendys-server:9000',
    clientId: 'mendys-platform-oidc-client',
    redirectUri: 'https://live.mendysrobotics.com/api/auth/oidc/callback',
    enrollmentFlowSlug: 'mendys-enrollment',
    appBaseUrl: 'https://live.mendysrobotics.com',
  },
])

/**
 * A miniature stand-in for the real mint/verify pair. It deliberately uses the
 * SAME primitives production does — sessionTenantId() to stamp, jwt with one
 * shared secret, assertTenantMatches() to check — mounted behind the real
 * tenantContext, so the wiring under test is the wiring that ships.
 */
function buildApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use('/api/test', tenantContext)

  app.post('/api/test/mint', (_req, res) => {
    const token = jwt.sign(
      { userId: 'user-1', sessionId: 'session-1', tid: sessionTenantId() },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
    res.json({ token })
  })

  app.get('/api/test/verify', (req, res) => {
    const header = req.headers.authorization
    const token = header && header.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'missing token' })
    let decoded: { userId: string; tid?: string }
    try {
      decoded = jwt.verify(token, JWT_SECRET) as never
    } catch {
      return res.status(401).json({ error: 'invalid signature' })
    }
    const check = assertTenantMatches(req, decoded.tid)
    if (!check.ok) {
      const reason = 'reason' in check ? check.reason : 'unknown'
      return res.status(401).json({ error: 'wrong tenant', reason })
    }
    return res.json({ ok: true, userId: decoded.userId, tid: decoded.tid })
  })

  return app
}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.JWT_SECRET = JWT_SECRET
  process.env.SECURITY_TENANTS = TENANTS
  resetTenantRegistryForTests()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetTenantRegistryForTests()
})

const mintOn = async (host: string): Promise<string> => {
  const res = await request(buildApp()).post('/api/test/mint').set('Host', host).expect(200)
  return res.body.token
}

describe('tid round-trip through the real middleware', () => {
  it('stamps the tid of the tenant that served the mint', async () => {
    const ffToken = await mintOn('app.fuzefront.com')
    const meToken = await mintOn('live.mendysrobotics.com')

    expect((jwt.decode(ffToken) as { tid: string }).tid).toBe('fuzefront')
    expect((jwt.decode(meToken) as { tid: string }).tid).toBe('mendys')
  })

  it('accepts a session on the host that minted it', async () => {
    const token = await mintOn('live.mendysrobotics.com')
    const res = await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'live.mendysrobotics.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(res.body).toMatchObject({ ok: true, tid: 'mendys' })
  })

  it('accepts it on a SIBLING host of the same tenant', async () => {
    // Both Mendys hosts are one tenant and share a directory, so a session
    // minted on one must work on the other.
    const token = await mintOn('live.mendysrobotics.com')
    await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'marketplace.mendysrobotics.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  })

  // ── THE test ────────────────────────────────────────────────────────────────
  it('REJECTS a tenant-A session presented on a tenant-B host, in both directions', async () => {
    const ffToken = await mintOn('app.fuzefront.com')
    const meToken = await mintOn('live.mendysrobotics.com')

    const a = await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'live.mendysrobotics.com')
      .set('Authorization', `Bearer ${ffToken}`)
      .expect(401)
    expect(a.body.error).toBe('wrong tenant')

    const b = await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'app.fuzefront.com')
      .set('Authorization', `Bearer ${meToken}`)
      .expect(401)
    expect(b.body.error).toBe('wrong tenant')
  })

  it('rejects it even though the SIGNATURE is valid — proving tid is what stops it', async () => {
    const ffToken = await mintOn('app.fuzefront.com')
    // Same secret, so the signature verifies cleanly on the other tenant's
    // host. Without the tid check this would be a 200 and a cross-directory
    // session.
    expect(() => jwt.verify(ffToken, JWT_SECRET)).not.toThrow()

    const res = await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'live.mendysrobotics.com')
      .set('Authorization', `Bearer ${ffToken}`)
      .expect(401)
    expect(res.body.reason).toMatch(/tenant "fuzefront".*serves "mendys"/)
  })

  it('rejects a hand-forged token claiming another tenant', async () => {
    // A token holder cannot simply assert a different tid: the claim is checked
    // against the host, not taken at face value.
    const forged = jwt.sign({ userId: 'user-1', tid: 'mendys' }, JWT_SECRET, { expiresIn: '1h' })
    await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'app.fuzefront.com')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401)
  })

  it('rejects a claimless token while multi-tenant', async () => {
    const claimless = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'app.fuzefront.com')
      .set('Authorization', `Bearer ${claimless}`)
      .expect(401)
    expect(res.body.reason).toMatch(/no tenant claim/)
  })

  it('rejects the request outright on an unclaimed host, before any token check', async () => {
    const token = await mintOn('app.fuzefront.com')
    // 400 from the middleware, NOT 401 from the handler — the request never
    // reaches a tenant at all.
    await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'evil.example.com')
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
  })

  it('ignores X-Forwarded-Host, so a client cannot choose its own directory', async () => {
    const ffToken = await mintOn('app.fuzefront.com')
    // Behind the ingress this header is caller-supplied. If it selected the
    // tenant, presenting a fuzefront token with X-Forwarded-Host pointing at
    // fuzefront would let it through on a Mendys host.
    await request(buildApp())
      .get('/api/test/verify')
      .set('Host', 'live.mendysrobotics.com')
      .set('X-Forwarded-Host', 'app.fuzefront.com')
      .set('Authorization', `Bearer ${ffToken}`)
      .expect(401)
  })
})

describe('legacy single-tenant mode is unaffected', () => {
  beforeEach(() => {
    delete process.env.SECURITY_TENANTS
    process.env.FRONTEND_URL = 'https://app.fuzefront.com'
    resetTenantRegistryForTests()
  })

  it('serves any host and accepts pre-tenancy claimless tokens', async () => {
    const claimless = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' })
    for (const host of ['app.fuzefront.com', 'fuzefront.dev.local', 'localhost']) {
      await request(buildApp())
        .get('/api/test/verify')
        .set('Host', host)
        .set('Authorization', `Bearer ${claimless}`)
        .expect(200)
    }
  })

  it('still stamps a tid, so sessions minted now survive the switch to multi-tenant', async () => {
    const token = await mintOn('anything.example.com')
    expect((jwt.decode(token) as { tid: string }).tid).toBe('fuzefront')
  })
})
