/**
 * @fuzefront/auth — public contract types (CONTRACT FREEZE).
 *
 * This module defines the STABLE, versioned interface every FuzeFront-family
 * product codes against for authentication + authorization identity. The
 * `Identity` shape is the single synchronization point: it does NOT change
 * when the underlying token format migrates from the current HS256 shared-secret
 * token to the target federated RS256/JWKS token. Consumers depend on
 * `Identity`, never on the raw JWT claims.
 *
 * PROVIDER-NEUTRAL: this contract names no identity vendor. The federated token
 * mode is `federated-jwks`; the concrete federation provider lives only behind
 * the server-side Security adapter. See `@fuzefront/security-client` for the
 * full provider-agnostic Security API surface (AuthN + AuthZ).
 *
 * Nothing in this package mints tokens. It only *verifies* and normalizes.
 */

/**
 * Semantic version of THIS contract. Bump on every interface change and record
 * the change in CHANGELOG.md. Consumers may assert on the major.
 */
export const AUTH_CONTRACT_VERSION = '0.2.0' as const;

/**
 * The stable, normalized identity every consumer receives regardless of which
 * verifier produced it. This is the contract's keystone.
 *
 * Field stability guarantees:
 * - `userId`   — ALWAYS present. Stable subject id for the principal.
 * - `tenantId` — the organization/tenant scope for authz. MAY be `null` in
 *                `legacy-hs256` mode when it cannot be resolved out-of-band
 *                (the current FuzeFront token carries no tenant claim). In
 *                `federated-jwks` target mode it is populated from the token claim.
 *                Consumers MUST handle `null` and fail-closed on tenant-scoped
 *                authorization when it is absent.
 * - `roles`    — ALWAYS an array (possibly empty). Never `undefined`. In
 *                `legacy-hs256` mode roles are resolved out-of-band (e.g. a DB
 *                lookup supplied by the host) since the current token carries
 *                no roles claim; an empty array means "no roles known", which
 *                a fail-closed consumer treats as unprivileged.
 */
export interface Identity {
  /** Stable subject identifier for the authenticated principal. Always present. */
  userId: string;
  /**
   * Tenant/organization scope for authorization. `null` when unknown
   * (legacy mode without out-of-band resolution). Consumers fail-closed on
   * tenant-scoped decisions when this is null.
   */
  tenantId: string | null;
  /** Role slugs. Always an array; empty means "no roles known". */
  roles: string[];
  /** Principal email, when available from the token/verifier. */
  email?: string;
  /** Which verifier produced this identity. Useful for logging/migration. */
  authMode: AuthMode;
  /** Token issued-at (epoch seconds), when present. */
  issuedAt?: number;
  /** Token expiry (epoch seconds), when present. */
  expiresAt?: number;
  /** Issuer (`iss`), when present. Provider-neutral value (server-side federation issuer). */
  issuer?: string;
  /**
   * Escape hatch for verifier-specific extras (raw claims a consumer may need
   * during migration). NOT part of the stable contract — do not rely on it for
   * cross-mode behavior; prefer promoting a field into `Identity` proper.
   */
  claims?: Record<string, unknown>;
}

/** The supported verification modes. */
export type AuthMode = 'legacy-hs256' | 'federated-jwks';

/**
 * Stable error codes for verification failures. The package is FAIL-CLOSED:
 * any verification problem yields a rejected result / thrown `AuthError`, never
 * a permissive fallback identity.
 */
export type AuthErrorCode =
  | 'NO_TOKEN' // no bearer token presented
  | 'MALFORMED' // not a parseable JWT
  | 'INVALID_SIGNATURE' // signature check failed
  | 'EXPIRED' // token past `exp`
  | 'NOT_ACTIVE' // token before `nbf`
  | 'INVALID_ISSUER' // `iss` not in the allowed set (federated-jwks)
  | 'INVALID_AUDIENCE' // `aud` mismatch (federated-jwks)
  | 'MISSING_CLAIM' // required claim (e.g. subject) absent
  | 'JWKS_UNAVAILABLE' // could not fetch/resolve signing keys (federated-jwks)
  | 'VERIFIER_UNAVAILABLE' // verifier misconfigured (e.g. no secret)
  | 'UNKNOWN';

/** Error thrown by `verifyToken`/middleware on any verification failure. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** HTTP status a middleware should surface (401 for authn, 403 for authz). */
  readonly status: number;
  constructor(code: AuthErrorCode, message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

/**
 * A pluggable token verifier. Implementations validate a raw bearer token and
 * return a normalized `Identity`, or throw `AuthError`. Two implementations are
 * part of this contract: `legacy-hs256` and `federated-jwks`.
 *
 * IMPLEMENTATION IS OUT OF SCOPE for this freeze — only the interface is frozen.
 */
export interface Verifier {
  readonly mode: AuthMode;
  /** Verify a raw token string (already stripped of the `Bearer ` prefix). */
  verify(token: string): Promise<Identity>;
}

/**
 * Optional out-of-band resolver used by `legacy-hs256` mode to hydrate the
 * fields the current FuzeFront token does NOT carry (`tenantId`, `roles`).
 * The host application supplies this (e.g. a Postgres lookup by userId).
 * Without it, legacy-mode identities have `tenantId: null` and `roles: []`.
 */
export interface OutOfBandResolver {
  resolve(userId: string): Promise<{ tenantId?: string | null; roles?: string[]; email?: string }>;
}

/** Config for the `legacy-hs256` verifier (interop with today's token). */
export interface LegacyHs256Config {
  mode: 'legacy-hs256';
  /** Shared secret used to sign today's token (FuzeFront `JWT_SECRET`). */
  secret: string;
  /** Identity claim holding the subject id. Default `'userId'` (current token). */
  subjectClaim?: string;
  /** Optional out-of-band hydration for tenantId/roles/email. */
  resolver?: OutOfBandResolver;
  /** Clock-skew tolerance in seconds. Default 0. */
  clockToleranceSec?: number;
}

/**
 * Config for the target `federated-jwks` verifier (federated RS256/JWKS).
 *
 * SERVER-INTERNAL: this config is consumed only by the host/server wiring that
 * constructs a verifier. It is provider-neutral — the concrete federation
 * provider and its issuer host are a server-side deployment detail, never named
 * in the consumer contract. Consumers depend on the normalized `Identity`.
 */
export interface FederatedJwksConfig {
  mode: 'federated-jwks';
  /**
   * Federation issuer URL. Used for discovery of the JWKS endpoint and for
   * `iss` validation. Provided by server-side deployment config; not a
   * consumer-facing value.
   */
  issuer: string;
  /** Expected audience (`aud`). Typically the registered client id. */
  audience?: string | string[];
  /**
   * Explicit JWKS URI. Optional — if omitted, resolved via OIDC discovery of
   * `${issuer}/.well-known/openid-configuration`.
   */
  jwksUri?: string;
  /** Claim holding the tenant/organization id. Default `'tenantId'`. */
  tenantClaim?: string;
  /** Claim holding the roles array. Default `'roles'`. */
  rolesClaim?: string;
  /** Claim holding the subject id. Default `'sub'`. */
  subjectClaim?: string;
  /** Clock-skew tolerance in seconds. Default 60. */
  clockToleranceSec?: number;
}

/**
 * @deprecated Renamed to {@link FederatedJwksConfig} (provider-neutral). This
 * alias is retained for one release to ease migration; the `mode` value is now
 * `'federated-jwks'`.
 */
export type OidcJwksConfig = FederatedJwksConfig;

/** Union config passed to `createVerifier`. */
export type VerifierConfig = LegacyHs256Config | FederatedJwksConfig;
