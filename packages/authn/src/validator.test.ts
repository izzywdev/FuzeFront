import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import { createAuthnValidator, FamilyTokenError } from './validator'

const ISSUER = 'https://auth.fuzefront.dev/application/o/fuzekeys/'
const AUDIENCE = 'fuzekeys-client'

let privateKey: KeyLike
let publicKey: KeyLike

/** Mint an Authentik-shaped RS256 token for tests. */
async function mint(
  overrides: {
    aud?: string
    iss?: string
    sub?: string | null
    expiresIn?: string
    alg?: string
    omitIat?: boolean
  } = {}
) {
  const builder = new SignJWT({
    email: 'user@fuzefront.dev',
    email_verified: true,
    name: 'Test User',
    preferred_username: 'tuser',
    groups: ['family-users'],
  })
    .setProtectedHeader({ alg: overrides.alg ?? 'RS256', kid: 'test-key' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? '1h')
  if (!overrides.omitIat) builder.setIssuedAt()
  if (overrides.sub !== null) builder.setSubject(overrides.sub ?? 'authentik-uuid-123')
  return builder.sign(privateKey)
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  publicKey = pair.publicKey
})

function makeValidator(extra: Record<string, unknown> = {}) {
  return createAuthnValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keySet: async () => publicKey,
    ...extra,
  })
}

describe('createAuthnValidator', () => {
  it('validates a well-formed family token end-to-end', async () => {
    const token = await mint()
    const principal = await makeValidator().validate(token)
    expect(principal.sub).toBe('authentik-uuid-123')
    expect(principal.email).toBe('user@fuzefront.dev')
    expect(principal.emailVerified).toBe(true)
    expect(principal.preferredUsername).toBe('tuser')
    expect(principal.groups).toEqual(['family-users'])
    expect(principal.issuer).toBe(ISSUER)
  })

  it('rejects a token minted for another app audience', async () => {
    const token = await mint({ aud: 'fuzefront-client' })
    await expect(makeValidator().validate(token)).rejects.toBeInstanceOf(FamilyTokenError)
  })

  it('rejects a token from a different issuer', async () => {
    const token = await mint({ iss: 'https://evil.example/application/o/fuzekeys/' })
    await expect(makeValidator().validate(token)).rejects.toBeInstanceOf(FamilyTokenError)
  })

  it('rejects an expired token', async () => {
    const token = await mint({ expiresIn: '-1h' })
    await expect(makeValidator().validate(token)).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  it('rejects a token without a sub claim', async () => {
    const token = await mint({ sub: null })
    await expect(makeValidator().validate(token)).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  it('rejects a token without an iat claim', async () => {
    const token = await mint({ omitIat: true })
    await expect(makeValidator().validate(token)).rejects.toBeInstanceOf(FamilyTokenError)
  })

  it('refuses to construct with a symmetric algorithm (alg-confusion guard)', () => {
    expect(() => makeValidator({ algorithms: ['HS256'] })).toThrow(FamilyTokenError)
  })

  it('refuses to construct with `none`', () => {
    expect(() => makeValidator({ algorithms: ['none'] })).toThrow(FamilyTokenError)
  })

  it('rejects an empty token string', async () => {
    await expect(makeValidator().validate('')).rejects.toMatchObject({
      code: 'missing_bearer_token',
    })
  })
})
