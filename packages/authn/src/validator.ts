import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthnConfig, FamilyPrincipal, FamilyValidator } from './types'

/** Stable, machine-readable error codes surfaced to callers / HTTP layers. */
export type FamilyTokenErrorCode =
  | 'config_invalid'
  | 'missing_bearer_token'
  | 'invalid_token'

export class FamilyTokenError extends Error {
  readonly code: FamilyTokenErrorCode
  constructor(message: string, code: FamilyTokenErrorCode) {
    super(message)
    this.name = 'FamilyTokenError'
    this.code = code
  }
}

const DEFAULT_ALGORITHMS = ['RS256']
const DEFAULT_CLOCK_TOLERANCE_SEC = 60

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === 'string')
  return strings.length ? strings : undefined
}

/**
 * Create a validator for the Fuze family AuthN federation contract (v1.0.0).
 *
 * Enforces, per `docs/auth/federation-authn-contract.md` §2: RS256-only
 * signature against the issuer's JWKS, exact `iss`, this app's `aud`, required
 * `exp`/`iat`/`sub`, and ±clock-skew leeway. Symmetric algorithms are rejected.
 */
export function createAuthnValidator(config: AuthnConfig): FamilyValidator {
  const algorithms = config.algorithms ?? DEFAULT_ALGORITHMS
  if (algorithms.some(alg => /^HS/i.test(alg) || alg.toLowerCase() === 'none')) {
    throw new FamilyTokenError(
      'Symmetric (HS*) and `none` algorithms are forbidden for family tokens',
      'config_invalid'
    )
  }

  const keySet =
    config.keySet ??
    (config.jwksUri
      ? createRemoteJWKSet(new URL(config.jwksUri))
      : (() => {
          throw new FamilyTokenError(
            'AuthnConfig requires either `jwksUri` or `keySet`',
            'config_invalid'
          )
        })())

  const clockTolerance = config.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC

  return {
    async validate(token: string): Promise<FamilyPrincipal> {
      if (!token || typeof token !== 'string') {
        throw new FamilyTokenError('No token provided', 'missing_bearer_token')
      }

      let payload: JWTPayload
      try {
        const result = await jwtVerify(token, keySet, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms,
          clockTolerance,
          // jose enforces exp/nbf if present; require iat + sub explicitly below.
        })
        payload = result.payload
      } catch (err) {
        throw new FamilyTokenError(
          `Token validation failed: ${(err as Error).message}`,
          'invalid_token'
        )
      }

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new FamilyTokenError('Token missing required `sub` claim', 'invalid_token')
      }
      if (typeof payload.iat !== 'number') {
        throw new FamilyTokenError('Token missing required `iat` claim', 'invalid_token')
      }
      if (typeof payload.exp !== 'number') {
        throw new FamilyTokenError('Token missing required `exp` claim', 'invalid_token')
      }

      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified:
          typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        preferredUsername:
          typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : undefined,
        groups: asStringArray(payload.groups),
        audience: payload.aud,
        issuer: payload.iss as string,
        expiresAt: payload.exp,
        raw: payload,
      }
    },
  }
}
