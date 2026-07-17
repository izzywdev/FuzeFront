/**
 * @fuzefront/auth — verifier runtime tests (#117).
 *
 * Bias: these test the DENIAL paths hardest. This package is the gate consuming
 * services mount, so a false "allow" is a family-wide breach, while a false
 * "deny" is merely an outage. The happy path gets one test; the ways it must
 * refuse get the rest.
 */
import { SignJWT, generateKeyPair, exportJWK, type KeyLike } from 'jose'
import { createVerifier, verifyToken } from '../src/verifyToken'
import { AuthError } from '../src/types'

const SECRET = 'test-secret-not-for-prod'
const key = () => new TextEncoder().encode(SECRET)

async function hs256(claims: Record<string, unknown>, exp = '1h'): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key())
}

/** Assert the promise rejects with AuthError carrying `code`. */
async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AuthError)
  await p.catch((e: AuthError) => expect(e.code).toBe(code))
}

describe('legacy-hs256', () => {
  const verifier = createVerifier({ mode: 'legacy-hs256', secret: SECRET })

  it('verifies a valid token and normalizes the Identity', async () => {
    const token = await hs256({ userId: 'u-1', email: 'a@b.dev' })
    const id = await verifier.verify(token)
    expect(id.userId).toBe('u-1')
    expect(id.email).toBe('a@b.dev')
    expect(id.authMode).toBe('legacy-hs256')
    // No resolver => deliberately unprivileged, NOT a guess.
    expect(id.tenantId).toBeNull()
    expect(id.roles).toEqual([])
  })

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await new SignJWT({ userId: 'u-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret'))
    await expectCode(verifier.verify(forged), 'INVALID_SIGNATURE')
  })

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ userId: 'u-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key())
    await expectCode(verifier.verify(token), 'EXPIRED')
  })

  it('rejects ALGORITHM CONFUSION — an RS256-signed token must not pass an HS256 verifier', async () => {
    // The attack this guards: if `algorithms` were unpinned, a token could name
    // an algorithm the verifier did not intend and bypass the shared secret.
    const { privateKey } = await generateKeyPair('RS256')
    const token = await new SignJWT({ userId: 'attacker' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthError)
  })

  it('rejects a token with no subject claim', async () => {
    const token = await hs256({ notASubject: 'x' })
    await expectCode(verifier.verify(token), 'MISSING_CLAIM')
  })

  it('rejects garbage', async () => {
    await expectCode(verifier.verify('not-a-jwt'), 'MALFORMED')
  })

  it('rejects an empty token', async () => {
    await expectCode(verifier.verify(''), 'NO_TOKEN')
  })

  it('hydrates tenantId/roles via the out-of-band resolver', async () => {
    const v = createVerifier({
      mode: 'legacy-hs256',
      secret: SECRET,
      resolver: {
        resolve: async (userId: string) => {
          expect(userId).toBe('u-1')
          return { tenantId: 'org-9', roles: ['admin'], email: 'r@b.dev' }
        },
      },
    })
    const id = await v.verify(await hs256({ userId: 'u-1' }))
    expect(id.tenantId).toBe('org-9')
    expect(id.roles).toEqual(['admin'])
    expect(id.email).toBe('r@b.dev')
  })

  it('DENIES when the resolver fails rather than returning an unprivileged identity', async () => {
    // A resolver outage returning roles:[] would be indistinguishable from a real
    // permission denial — masking an outage as an authz decision. It must throw.
    const v = createVerifier({
      mode: 'legacy-hs256',
      secret: SECRET,
      resolver: { resolve: async () => { throw new Error('db down') } },
    })
    await expectCode(v.verify(await hs256({ userId: 'u-1' })), 'VERIFIER_UNAVAILABLE')
  })

  it('refuses to construct without a secret', () => {
    expect(() => createVerifier({ mode: 'legacy-hs256', secret: '' })).toThrow(AuthError)
  })

  it('verifyToken() delegates to the verifier', async () => {
    const id = await verifyToken(await hs256({ userId: 'u-2' }), verifier)
    expect(id.userId).toBe('u-2')
  })
})

describe('federated-jwks', () => {
  // jose's createRemoteJWKSet does its own fetching, so stubbing global.fetch
  // does not intercept it. Serve a real JWKS over loopback instead — it also
  // exercises the discovery path for real rather than around it.
  let server: import('http').Server
  let base: string
  let privateKey: KeyLike

  beforeAll(async () => {
    const { createServer } = await import('http')
    const kp = await generateKeyPair('RS256')
    privateKey = kp.privateKey as KeyLike
    const jwk = await exportJWK(kp.publicKey)
    jwk.kid = 'test-key'
    jwk.alg = 'RS256'
    jwk.use = 'sig'

    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.includes('.well-known/openid-configuration')) {
        res.end(JSON.stringify({ jwks_uri: `${base}/jwks` }))
        return
      }
      if (req.url?.includes('/jwks')) {
        res.end(JSON.stringify({ keys: [jwk] }))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address() as import('net').AddressInfo
    base = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()))
  })

  it('refuses to construct without an issuer', () => {
    expect(() => createVerifier({ mode: 'federated-jwks', issuer: '' })).toThrow(AuthError)
  })

  it('verifies an RS256 token via OIDC discovery and maps tenant/roles claims', async () => {
    const v = createVerifier({
      mode: 'federated-jwks',
      // jwksUri omitted on purpose: this proves discovery resolves it.
      issuer: base,
      audience: 'fuzefront',
      tenantClaim: 'org',
      rolesClaim: 'perms',
    })

    const token = await new SignJWT({ org: 'org-1', perms: ['reader'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('u-fed')
      .setIssuer(base)
      .setAudience('fuzefront')
      .setExpirationTime('1h')
      .sign(privateKey)

    const id = await v.verify(token)
    expect(id.userId).toBe('u-fed')
    expect(id.tenantId).toBe('org-1')
    expect(id.roles).toEqual(['reader'])
    expect(id.authMode).toBe('federated-jwks')
  })

  it('rejects a token from the WRONG issuer', async () => {
    const v = createVerifier({
      mode: 'federated-jwks',
      issuer: `${base}/expected`,
      jwksUri: `${base}/jwks`,
    })
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('u')
      .setIssuer('https://evil.test/other')
      .setExpirationTime('1h')
      .sign(privateKey)

    await expectCode(v.verify(token), 'INVALID_ISSUER')
  })

  it('rejects a token whose audience does not match', async () => {
    const v = createVerifier({
      mode: 'federated-jwks',
      issuer: `${base}/aud-test`,
      jwksUri: `${base}/jwks`,
      audience: 'fuzefront',
    })
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('u')
      .setIssuer(`${base}/aud-test`)
      .setAudience('some-other-app')
      .setExpirationTime('1h')
      .sign(privateKey)

    await expectCode(v.verify(token), 'INVALID_AUDIENCE')
  })
})
