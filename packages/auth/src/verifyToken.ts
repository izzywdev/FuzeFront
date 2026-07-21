/**
 * @fuzefront/auth — token verification runtime.
 *
 * Implements the contract frozen in `types.ts` (#117). The public signatures did
 * not change; only the bodies became real.
 *
 * Two modes, one dependency — `jose` covers HS256 and RS256/JWKS, so consumers
 * do not pull two crypto libraries:
 *
 *   legacy-hs256   — today's FuzeFront session token: HS256 over the shared
 *                    JWT_SECRET, subject in `userId`. Carries no tenant/roles, so
 *                    an optional out-of-band `resolver` hydrates them.
 *   federated-jwks — the target: RS256/ES256 verified against the issuer's public
 *                    JWKS with `iss`/`aud` validation. No shared secret, so a
 *                    consumer can VERIFY without gaining the power to MINT.
 *
 * FAIL-CLOSED, always: every failure path throws `AuthError`; no branch returns a
 * permissive identity. That matters more than usual here — this runs inside
 * consuming services, so a "soft" failure would silently grant access family-wide.
 *
 * This package NEVER mints tokens. Verification only.
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import {
  AuthError,
  type FederatedJwksConfig,
  type Identity,
  type LegacyHs256Config,
  type Verifier,
  type VerifierConfig,
} from './types';

/**
 * Translate a `jose` failure into the contract's error taxonomy.
 *
 * jose reports failures via stable `err.code` strings. Mapping them explicitly
 * keeps the codes operationally meaningful — an expired token and a forged
 * signature are very different events — instead of collapsing both to UNKNOWN.
 * Anything unrecognised stays UNKNOWN and still denies.
 */
function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const code = (err as { code?: string })?.code;
  const msg = (err as Error)?.message ?? 'verification failed';

  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return new AuthError('EXPIRED', 'token has expired');
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return new AuthError('INVALID_SIGNATURE', 'signature verification failed');
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      // jose names the offending claim — that is what separates a wrong audience
      // from a not-yet-valid token.
      const claim = (err as { claim?: string }).claim;
      if (claim === 'iss') return new AuthError('INVALID_ISSUER', 'unexpected token issuer');
      if (claim === 'aud') return new AuthError('INVALID_AUDIENCE', 'unexpected token audience');
      if (claim === 'nbf') return new AuthError('NOT_ACTIVE', 'token is not yet valid');
      return new AuthError('MISSING_CLAIM', `claim validation failed: ${claim ?? 'unknown'}`);
    }
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
    case 'ERR_JOSE_NOT_SUPPORTED':
      return new AuthError('MALFORMED', 'token is not a parseable JWT');
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JWKS_INVALID':
      return new AuthError('JWKS_UNAVAILABLE', `could not resolve signing key: ${msg}`);
    default:
      return new AuthError('UNKNOWN', msg);
  }
}

/** Read a claim as a non-empty string, else undefined. */
function claimString(payload: JWTPayload, name: string): string | undefined {
  const v = payload[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Read a claim as string[]; tolerate a single string. Never undefined. */
function claimRoles(payload: JWTPayload, name: string): string[] {
  const v = payload[name];
  if (Array.isArray(v)) return v.filter((r): r is string => typeof r === 'string');
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

// ── legacy-hs256 ────────────────────────────────────────────────────────────

function createLegacyVerifier(config: LegacyHs256Config): Verifier {
  if (!config.secret) {
    // Misconfiguration fails at construction, not silently at verify-time.
    throw new AuthError('VERIFIER_UNAVAILABLE', 'legacy-hs256 requires `secret`', 500);
  }
  const key = new TextEncoder().encode(config.secret);
  const subjectClaim = config.subjectClaim ?? 'userId';
  const clockTolerance = config.clockToleranceSec ?? 0;

  return {
    get mode() {
      return 'legacy-hs256' as const;
    },
    async verify(token: string): Promise<Identity> {
      if (!token) throw new AuthError('NO_TOKEN', 'no bearer token presented');

      let payload: JWTPayload;
      try {
        // Algorithm is PINNED. Without this, a token claiming `alg: none` — or an
        // asymmetric alg — could sidestep the shared secret entirely (the classic
        // JWT algorithm-confusion attack).
        ({ payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          clockTolerance,
        }));
      } catch (err) {
        throw toAuthError(err);
      }

      const userId = claimString(payload, subjectClaim) ?? claimString(payload, 'sub');
      if (!userId) {
        throw new AuthError('MISSING_CLAIM', `token has no \`${subjectClaim}\` (or \`sub\`) claim`);
      }

      // Today's token carries neither tenant nor roles. Without a resolver the
      // identity is deliberately UNPRIVILEGED (tenantId null, roles []) rather
      // than guessed — an authz decision must never rest on an assumption.
      let tenantId: string | null = null;
      let roles: string[] = [];
      let email = claimString(payload, 'email');

      if (config.resolver) {
        try {
          const extra = await config.resolver.resolve(userId);
          tenantId = extra.tenantId ?? null;
          roles = extra.roles ?? [];
          email = extra.email ?? email;
        } catch (err) {
          // The token is valid but hydration failed. Returning it with empty
          // roles would read as "authenticated but authorized for nothing" —
          // indistinguishable from a genuine permission denial, which would mask
          // an outage as an authz decision. Deny loudly instead.
          throw new AuthError(
            'VERIFIER_UNAVAILABLE',
            `identity resolver failed: ${(err as Error).message}`,
            500,
          );
        }
      }

      return {
        userId,
        tenantId,
        roles,
        email,
        authMode: 'legacy-hs256',
        issuedAt: payload.iat,
        expiresAt: payload.exp,
        issuer: payload.iss,
        claims: payload as Record<string, unknown>,
      };
    },
  };
}

// ── federated-jwks ──────────────────────────────────────────────────────────

/**
 * One JWKS per issuer. `createRemoteJWKSet` owns the fetch + rotation cache, so
 * re-creating it per request would hammer the issuer and defeat key rotation
 * caching.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

async function resolveJwksUri(config: FederatedJwksConfig): Promise<string> {
  if (config.jwksUri) return config.jwksUri;
  const discovery = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(discovery);
  } catch (err) {
    throw new AuthError('JWKS_UNAVAILABLE', `discovery fetch failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new AuthError('JWKS_UNAVAILABLE', `discovery returned ${res.status}`);
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) throw new AuthError('JWKS_UNAVAILABLE', 'discovery document has no `jwks_uri`');
  return doc.jwks_uri;
}

function createFederatedVerifier(config: FederatedJwksConfig): Verifier {
  if (!config.issuer) {
    throw new AuthError('VERIFIER_UNAVAILABLE', 'federated-jwks requires `issuer`', 500);
  }
  const tenantClaim = config.tenantClaim ?? 'tenantId';
  const rolesClaim = config.rolesClaim ?? 'roles';
  const subjectClaim = config.subjectClaim ?? 'sub';
  const clockTolerance = config.clockToleranceSec ?? 60;

  async function getKeySet(): Promise<JWTVerifyGetKey> {
    const cached = jwksCache.get(config.issuer);
    if (cached) return cached;
    const set = createRemoteJWKSet(new URL(await resolveJwksUri(config)));
    jwksCache.set(config.issuer, set);
    return set;
  }

  return {
    get mode() {
      return 'federated-jwks' as const;
    },
    async verify(token: string): Promise<Identity> {
      if (!token) throw new AuthError('NO_TOKEN', 'no bearer token presented');

      let payload: JWTPayload;
      try {
        const keySet = await getKeySet();
        // Asymmetric algorithms ONLY. Permitting HS* here would let anyone who
        // knows the (public) key use it as an HMAC secret and forge tokens.
        ({ payload } = await jwtVerify(token, keySet, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'],
          clockTolerance,
        }));
      } catch (err) {
        throw toAuthError(err);
      }

      const userId = claimString(payload, subjectClaim);
      if (!userId) throw new AuthError('MISSING_CLAIM', `token has no \`${subjectClaim}\` claim`);

      return {
        userId,
        tenantId: claimString(payload, tenantClaim) ?? null,
        roles: claimRoles(payload, rolesClaim),
        email: claimString(payload, 'email'),
        authMode: 'federated-jwks',
        issuedAt: payload.iat,
        expiresAt: payload.exp,
        issuer: payload.iss,
        claims: payload as Record<string, unknown>,
      };
    },
  };
}

// ── public API (frozen signatures) ──────────────────────────────────────────

/**
 * Build a `Verifier` for the given mode. The returned verifier is FAIL-CLOSED.
 *
 * @example
 *   const v = createVerifier({ mode: 'legacy-hs256', secret: process.env.JWT_SECRET!, resolver });
 *   const identity = await v.verify(rawToken);
 */
export function createVerifier(config: VerifierConfig): Verifier {
  switch (config.mode) {
    case 'legacy-hs256':
      return createLegacyVerifier(config);
    case 'federated-jwks':
      return createFederatedVerifier(config);
    default: {
      // Exhaustiveness guard: a future mode must be handled explicitly, never
      // defaulted into something permissive.
      const bad = config as { mode?: string };
      throw new AuthError('VERIFIER_UNAVAILABLE', `unknown verifier mode: ${bad.mode}`, 500);
    }
  }
}

/**
 * Verify a raw bearer token (already stripped of the `Bearer ` prefix) and
 * return the normalized `Identity`. Throws `AuthError` on any failure
 * (fail-closed). Convenience over `createVerifier().verify()` when a single
 * verifier is used process-wide.
 */
export function verifyToken(token: string, verifier: Verifier): Promise<Identity> {
  return verifier.verify(token);
}
