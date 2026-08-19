/**
 * @fuzefront/auth — Express middleware tests (#117).
 *
 * The middleware is the thing consumers actually mount, so these assert the
 * gate's contract: it never calls next() on an unauthenticated request, it
 * distinguishes 401 (who are you?) from 403 (I know, and no), and an unresolved
 * tenant is a denial rather than a wildcard.
 */
import { SignJWT } from 'jose'
import { requireAuth, requireRoles, requireTenant } from '../src/middleware'
import { createVerifier } from '../src/verifyToken'
import type { Identity } from '../src/types'

const SECRET = 'test-secret-not-for-prod'
const verifier = createVerifier({ mode: 'legacy-hs256', secret: SECRET })

async function token(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

/** Minimal express-ish req/res doubles. */
function mkReq(headers: Record<string, string> = {}, identity?: Identity) {
  return { headers, identity } as any
}
function mkRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}
/** Run a middleware and resolve once next() or res.json() has fired. */
function run(mw: any, req: any, res: any): Promise<{ nexted: boolean }> {
  return new Promise(resolve => {
    let done = false
    const finish = (nexted: boolean) => {
      if (!done) { done = true; resolve({ nexted }) }
    }
    res.json = jest.fn(() => { finish(false); return res })
    mw(req, res, () => finish(true))
  })
}

describe('requireAuth', () => {
  it('rejects a request with NO token (401 NO_TOKEN) and does not call next()', async () => {
    const res = mkRes()
    const { nexted } = await run(requireAuth({ verifier }), mkReq(), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_TOKEN' }),
    )
  })

  it('attaches the Identity and calls next() on a valid token', async () => {
    const req = mkReq({ authorization: `Bearer ${await token({ userId: 'u-1' })}` })
    const res = mkRes()
    const { nexted } = await run(requireAuth({ verifier }), req, res)
    expect(nexted).toBe(true)
    expect(req.identity.userId).toBe('u-1')
    expect(res.status).not.toHaveBeenCalled()
  })

  it('accepts the Bearer scheme case-insensitively (RFC 6750)', async () => {
    const req = mkReq({ authorization: `bEaReR ${await token({ userId: 'u-1' })}` })
    const { nexted } = await run(requireAuth({ verifier }), req, mkRes())
    expect(nexted).toBe(true)
  })

  it('rejects a malformed Authorization header', async () => {
    const res = mkRes()
    const { nexted } = await run(requireAuth({ verifier }), mkReq({ authorization: 'Basic abc' }), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a forged token (401 INVALID_SIGNATURE) — never next()', async () => {
    const forged = await new SignJWT({ userId: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret'))
    const res = mkRes()
    const { nexted } = await run(requireAuth({ verifier }), mkReq({ authorization: `Bearer ${forged}` }), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_SIGNATURE' }))
  })

  it('optional:true continues WITHOUT an identity instead of half-authenticating', async () => {
    const req = mkReq()
    const { nexted } = await run(requireAuth({ verifier, optional: true }), req, mkRes())
    expect(nexted).toBe(true)
    expect(req.identity).toBeUndefined()
  })

  it('optional:true still refuses to attach an identity for a FORGED token', async () => {
    const forged = await new SignJWT({ userId: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret'))
    const req = mkReq({ authorization: `Bearer ${forged}` })
    const { nexted } = await run(requireAuth({ verifier, optional: true }), req, mkRes())
    expect(nexted).toBe(true)
    expect(req.identity).toBeUndefined()
  })

  it('throws at wiring time without a verifier (not on first request)', () => {
    expect(() => requireAuth({} as any)).toThrow()
  })
})

const ident = (over: Partial<Identity> = {}): Identity => ({
  userId: 'u-1',
  tenantId: 'org-1',
  roles: ['reader'],
  authMode: 'legacy-hs256',
  ...over,
})

describe('requireRoles', () => {
  it('allows when all required roles are held', async () => {
    const { nexted } = await run(requireRoles(['reader']), mkReq({}, ident()), mkRes())
    expect(nexted).toBe(true)
  })

  it('denies with 403 (not 401) when a role is missing', async () => {
    const res = mkRes()
    const { nexted } = await run(requireRoles(['admin']), mkReq({}, ident()), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it("mode:'any' allows when one of several roles is held", async () => {
    const { nexted } = await run(requireRoles(['admin', 'reader'], 'any'), mkReq({}, ident()), mkRes())
    expect(nexted).toBe(true)
  })

  it('denies when roles are empty — an unhydrated legacy identity gets no role-gated access', async () => {
    const res = mkRes()
    const { nexted } = await run(requireRoles(['reader']), mkReq({}, ident({ roles: [] })), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('denies (401) when mounted without requireAuth — a wiring bug must not open the route', async () => {
    const res = mkRes()
    const { nexted } = await run(requireRoles(['reader']), mkReq(), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

describe('requireTenant', () => {
  it('allows a matching tenant', async () => {
    const { nexted } = await run(requireTenant('org-1'), mkReq({}, ident()), mkRes())
    expect(nexted).toBe(true)
  })

  it('denies a different tenant', async () => {
    const res = mkRes()
    const { nexted } = await run(requireTenant('org-2'), mkReq({}, ident()), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('treats an UNRESOLVED tenant (null) as a denial, never a wildcard', async () => {
    // The dangerous reading: null == "no scope restriction" would hand every
    // tenant's data to any valid legacy token that lacks a resolver.
    const res = mkRes()
    const { nexted } = await run(requireTenant('org-1'), mkReq({}, ident({ tenantId: null })), res)
    expect(nexted).toBe(false)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
