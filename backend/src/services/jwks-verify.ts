/**
 * jwks-verify.ts
 *
 * Local, signature-based verification of an Authentik-issued client_credentials
 * JWT via the provider's published JWKS — no per-request round-trip to Authentik
 * (unlike `machine-identity.ts`'s `introspectMachineToken`, which calls
 * Authentik's `/introspect/` endpoint on every check).
 *
 * Part of izzywdev/FuzeFront#648 (platform S2S identity foundation), which asks
 * for "the JWT issued by Authentik can be validated in a consuming service using
 * the published JWKS". Gated OFF by default behind
 * `fuzefront.platform.s2s-jwks-auth` (src/utils/s2sJwksFlag.ts) — see that file's
 * header comment for why JWKS verification is opt-in rather than a drop-in
 * replacement for introspection: it trades a network round-trip for a real
 * revocation gap (a revoked token still verifies until it expires).
 *
 * Dependency-minimal by design (disk-constrained CI): no `jwks-rsa` package.
 * Node has shipped native JWK import since 15.12 (`crypto.createPublicKey({key,
 * format:'jwk'})`), so the only new work is fetching + caching the JWKS document
 * (via axios, already a dependency) and picking the key matching the token's
 * `kid` header. Signature + claims verification is `jsonwebtoken.verify` (already
 * a dependency), same as every other JWT touchpoint in this codebase.
 */

import axios from 'axios'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { isS2SJwksAuthEnabled, S2SJwksFlagContext } from '../utils/s2sJwksFlag'

const JWKS_FETCH_TIMEOUT_MS = 5_000
/** How long a fetched JWKS document is trusted before being re-fetched. Short
 * enough that a key rotation propagates quickly; long enough that a burst of
 * verifications doesn't hammer the IdP. */
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000

export interface JwksVerifyOptions {
  /** Expected `iss` claim — the Authentik application's OIDC issuer URL. */
  issuer: string
  /** Expected `aud` claim. Omit to skip audience verification. */
  audience?: string
  /** Flag-evaluation context; forwarded to isS2SJwksAuthEnabled. */
  flagContext?: S2SJwksFlagContext
}

export type JwksVerifyResult =
  | { verified: true; payload: jwt.JwtPayload }
  | { verified: false; reason: JwksVerifyFailureReason }

export type JwksVerifyFailureReason =
  | 'flag_disabled'
  | 'malformed_token'
  | 'jwks_unreachable'
  | 'key_not_found'
  | 'signature_invalid'
  | 'claims_invalid'

interface CachedJwks {
  keys: Array<{ kid?: string; kty: string; [k: string]: unknown }>
  fetchedAt: number
}

const jwksCache = new Map<string, CachedJwks>()

/** Derives the standard Authentik JWKS document URL from an issuer URL. */
function jwksUrlFor(issuer: string): string {
  return issuer.replace(/\/$/, '') + '/jwks/'
}

async function getJwks(issuer: string): Promise<CachedJwks['keys'] | null> {
  const cached = jwksCache.get(issuer)
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys
  }

  try {
    const res = await axios.get(jwksUrlFor(issuer), { timeout: JWKS_FETCH_TIMEOUT_MS })
    const keys = Array.isArray(res.data?.keys) ? res.data.keys : []
    jwksCache.set(issuer, { keys, fetchedAt: Date.now() })
    return keys
  } catch (error) {
    console.error(`[jwks-verify] Failed to fetch JWKS from ${jwksUrlFor(issuer)}:`, error)
    // Serve a stale cache entry rather than fail outright, if one exists — a
    // transient IdP blip should not invalidate every in-flight verification.
    return cached?.keys ?? null
  }
}

/** Test-only: clears the in-memory JWKS cache between cases. */
export function _clearJwksCacheForTests(): void {
  jwksCache.clear()
}

/**
 * Verifies a client_credentials access token's signature and standard claims
 * (`exp`, `iss`, `aud`) against the issuer's published JWKS.
 *
 * NEVER throws — every failure mode (flag off, malformed token, unreachable
 * JWKS, no matching key, bad signature, expired/wrong claims) resolves to
 * `{ verified: false, reason }`. Fails closed: any ambiguity is "not verified".
 */
export async function verifyMachineTokenViaJwks(
  token: string,
  opts: JwksVerifyOptions
): Promise<JwksVerifyResult> {
  const enabled = await isS2SJwksAuthEnabled(opts.flagContext)
  if (!enabled) {
    return { verified: false, reason: 'flag_disabled' }
  }

  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
    return { verified: false, reason: 'malformed_token' }
  }

  const keys = await getJwks(opts.issuer)
  if (!keys) {
    return { verified: false, reason: 'jwks_unreachable' }
  }

  const jwk = keys.find(k => k.kid === decoded.header.kid && k.kty === 'RSA')
  if (!jwk) {
    return { verified: false, reason: 'key_not_found' }
  }

  let publicKey: crypto.KeyObject
  try {
    publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' })
  } catch (error) {
    console.error('[jwks-verify] Failed to import JWK as a public key:', error)
    return { verified: false, reason: 'key_not_found' }
  }

  try {
    const payload = jwt.verify(token, publicKey.export({ type: 'spki', format: 'pem' }), {
      algorithms: ['RS256'],
      issuer: opts.issuer,
      audience: opts.audience,
    })
    if (typeof payload === 'string') {
      return { verified: false, reason: 'claims_invalid' }
    }
    return { verified: true, payload }
  } catch (error) {
    console.log('[jwks-verify] Token failed signature/claims verification:', (error as Error).message)
    const reason: JwksVerifyFailureReason =
      (error as Error).name === 'JsonWebTokenError' &&
      /invalid signature/i.test((error as Error).message)
        ? 'signature_invalid'
        : 'claims_invalid'
    return { verified: false, reason }
  }
}
