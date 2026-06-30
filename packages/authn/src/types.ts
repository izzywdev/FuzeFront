import type { JWTPayload, JWTVerifyGetKey } from 'jose'

/**
 * Configuration for a Fuze family AuthN validator. See
 * `docs/auth/federation-authn-contract.md` (v1.0.0) for the normative spec.
 */
export interface AuthnConfig {
  /**
   * The exact `iss` claim value, e.g.
   * `https://auth.fuzefront.dev/application/o/fuzekeys/`. The trailing slash is
   * significant — comparison against the token's `iss` is exact.
   */
  issuer: string

  /**
   * This app's own expected audience(s) — its Authentik client id. A token whose
   * `aud` does not contain one of these is rejected. Never set this to another
   * app's audience.
   */
  audience: string | string[]

  /**
   * The JWKS endpoint. SHOULD be the `jwks_uri` resolved from the issuer's
   * `.well-known/openid-configuration` rather than a hardcoded path. Required
   * unless a custom {@link AuthnConfig.keySet} is supplied (e.g. in tests).
   */
  jwksUri?: string

  /**
   * Allowed signing algorithms. Defaults to `["RS256"]`. Symmetric (`HS*`)
   * algorithms are rejected at construction time — family tokens are never
   * symmetric.
   */
  algorithms?: string[]

  /** Clock-skew tolerance in seconds applied to `exp`/`iat`/`nbf`. Default 60. */
  clockToleranceSec?: number

  /**
   * Test/advanced seam: provide a key resolver directly instead of fetching a
   * remote JWKS. When omitted, a remote JWKS set is created from
   * {@link AuthnConfig.jwksUri}.
   */
  keySet?: JWTVerifyGetKey
}

/**
 * The validated, normalized identity extracted from a family token. `sub` is the
 * stable cross-family user key (the Authentik user id).
 */
export interface FamilyPrincipal {
  /** Stable Authentik subject id — the primary key for federated identity. */
  sub: string
  email?: string
  emailVerified?: boolean
  name?: string
  preferredUsername?: string
  groups?: string[]
  /** The token's audience(s). */
  audience?: string | string[]
  /** The verified issuer. */
  issuer: string
  /** Expiry (epoch seconds). */
  expiresAt?: number
  /** The full verified JWT payload, for app-specific claims. */
  raw: JWTPayload
}

export interface FamilyValidator {
  /** Verify a bearer token string and return the normalized principal. */
  validate(token: string): Promise<FamilyPrincipal>
}
