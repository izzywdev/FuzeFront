/**
 * jwks-verify.test.ts
 *
 * Unit tests for JWKS-based verification of S2S client_credentials tokens
 * (izzywdev/FuzeFront#648). Exercises BOTH states of the
 * `fuzefront.platform.s2s-jwks-auth` release flag (feature-flags skill
 * requirement) via `jest.spyOn` on the flag module — the same substitution
 * pattern `tests/portal-routes.test.ts` uses, since no
 * `@fuzefront/feature-flags` package is resolvable in this sandbox.
 *
 * Signs real RS256 JWTs with an in-test-generated keypair and serves the
 * corresponding public JWK from a mocked HTTP JWKS endpoint — no live Authentik
 * dependency.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return { ...actual, get: jest.fn() }
})

import axios from 'axios'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import * as s2sJwksFlagModule from '../src/utils/s2sJwksFlag'
import {
  verifyMachineTokenViaJwks,
  _clearJwksCacheForTests,
} from '../src/services/jwks-verify'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>

const ISSUER = 'http://authentik.test/application/o/s2s-fuzecall-backend/'
const AUDIENCE = 's2s'
const KID = 'test-key-1'

let privateKeyPem: string
let publicJwk: Record<string, unknown>

beforeAll(() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  publicJwk = { ...jwk, kid: KID, use: 'sig', alg: 'RS256' }
})

function signToken(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      aud: AUDIENCE,
      service: 'fuzecall-backend',
      scopes: ['fuzecall:control-plane:auth'],
      ...overrides,
    },
    privateKeyPem,
    {
      algorithm: 'RS256',
      issuer: ISSUER,
      expiresIn: '5m',
      keyid: KID,
      ...header,
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  _clearJwksCacheForTests()
  mockedGet.mockResolvedValue({ data: { keys: [publicJwk] } } as any)
})

describe('verifyMachineTokenViaJwks() — flag OFF (default)', () => {
  beforeEach(() => {
    jest.spyOn(s2sJwksFlagModule, 'isS2SJwksAuthEnabled').mockResolvedValue(false)
  })

  it('refuses to verify — even a perfectly valid token — and never fetches the JWKS', async () => {
    const token = signToken()

    const result = await verifyMachineTokenViaJwks(token, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'flag_disabled' })
    expect(mockedGet).not.toHaveBeenCalled()
  })
})

describe('verifyMachineTokenViaJwks() — flag ON', () => {
  beforeEach(() => {
    jest.spyOn(s2sJwksFlagModule, 'isS2SJwksAuthEnabled').mockResolvedValue(true)
  })

  it('verifies a validly signed, unexpired token and returns its payload', async () => {
    const token = signToken()

    const result = await verifyMachineTokenViaJwks(token, { issuer: ISSUER, audience: AUDIENCE })

    expect(result.verified).toBe(true)
    if (result.verified) {
      expect(result.payload.service).toBe('fuzecall-backend')
      expect(result.payload.scopes).toEqual(['fuzecall:control-plane:auth'])
      expect(result.payload.aud).toBe(AUDIENCE)
    }
  })

  it('fetches the JWKS at <issuer>/jwks/', async () => {
    await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })

    expect(mockedGet).toHaveBeenCalledWith(
      'http://authentik.test/application/o/s2s-fuzecall-backend/jwks/',
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('caches the JWKS document — a second verification within the TTL makes no second fetch', async () => {
    await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })
    await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })

    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('rejects a token signed with a different key (signature mismatch)', async () => {
    const { privateKey: otherPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rogueToken = jwt.sign(
      { aud: AUDIENCE, service: 'fuzecall-backend' },
      otherPrivateKey.export({ type: 'pkcs1', format: 'pem' }) as string,
      { algorithm: 'RS256', issuer: ISSUER, expiresIn: '5m', keyid: KID }
    )

    const result = await verifyMachineTokenViaJwks(rogueToken, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'signature_invalid' })
  })

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { aud: AUDIENCE, service: 'fuzecall-backend' },
      privateKeyPem,
      { algorithm: 'RS256', issuer: ISSUER, expiresIn: '-1s', keyid: KID }
    )

    const result = await verifyMachineTokenViaJwks(expired, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'claims_invalid' })
  })

  it('rejects a token with the wrong audience', async () => {
    const wrongAud = signToken({ aud: 'a2a' })

    const result = await verifyMachineTokenViaJwks(wrongAud, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'claims_invalid' })
  })

  it('rejects a token with the wrong issuer', async () => {
    const wrongIssuer = jwt.sign(
      { aud: AUDIENCE, service: 'fuzecall-backend' },
      privateKeyPem,
      { algorithm: 'RS256', issuer: 'http://not-authentik.test/', expiresIn: '5m', keyid: KID }
    )

    const result = await verifyMachineTokenViaJwks(wrongIssuer, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'claims_invalid' })
  })

  it('returns key_not_found when no JWKS key matches the token kid', async () => {
    const token = jwt.sign(
      { aud: AUDIENCE, service: 'fuzecall-backend' },
      privateKeyPem,
      { algorithm: 'RS256', issuer: ISSUER, expiresIn: '5m', keyid: 'unknown-kid' }
    )

    const result = await verifyMachineTokenViaJwks(token, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'key_not_found' })
  })

  it('returns malformed_token for a non-JWT string', async () => {
    const result = await verifyMachineTokenViaJwks('not-a-jwt', { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'malformed_token' })
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('serves a stale cached JWKS rather than failing outright on a transient fetch error', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      // Prime the cache with a successful fetch.
      const primed = await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })
      expect(primed.verified).toBe(true)
      expect(mockedGet).toHaveBeenCalledTimes(1)

      // Advance past the cache TTL (10 min) so the next call attempts a re-fetch.
      jest.advanceTimersByTime(11 * 60 * 1000)
      mockedGet.mockRejectedValueOnce(new Error('ECONNRESET'))

      // The re-fetch fails, but the (now-stale) cached keys still verify the token —
      // a transient IdP blip must not invalidate every in-flight verification.
      const result = await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })
      expect(result.verified).toBe(true)
      expect(mockedGet).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('fails closed (jwks_unreachable) when the IdP cannot be reached and no cache exists at all', async () => {
    mockedGet.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await verifyMachineTokenViaJwks(signToken(), { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ verified: false, reason: 'jwks_unreachable' })
  })
})
