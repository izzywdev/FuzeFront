/**
 * @fuzefront/security-client — provider-neutral Security contract types.
 *
 * The FuzeFront-owned Security API is provider-agnostic: the identity provider
 * (federation/MFA/enrollment) and authorization engine (policy/ReBAC) are
 * swappable implementations hidden behind internal server-side adapters.
 * Consumers depend ONLY on the stable shapes here + the generated HTTP client
 * (`./generated`), never on any vendor.
 *
 * Naming rule: no vendor/product names in this consumer surface. Open-standard
 * protocol terms (OIDC/JWKS) appear only where they name a real wire protocol.
 *
 * The `Identity` keystone is invariant across token-format migrations.
 */

/**
 * Semantic version of THIS contract. Bump on every interface change; record it
 * in CHANGELOG.md. Consumers may assert on the major.
 */
export const SECURITY_CONTRACT_VERSION = '0.2.0' as const;

/**
 * The stable, normalized identity every consumer receives regardless of which
 * verifier produced it. The contract's keystone.
 */
export interface Identity {
  /** Stable subject identifier for the authenticated principal. Always present. */
  userId: string;
  /**
   * Tenant/organization scope for authorization. `null` when unknown
   * (legacy token mode without out-of-band resolution). Consumers fail-closed
   * on tenant-scoped decisions when this is null.
   */
  tenantId: string | null;
  /** Role slugs. Always an array; empty means "no roles known". */
  roles: string[];
  /** Principal email, when available. */
  email?: string;
  /** Which verifier produced this identity (for logging/migration). */
  authMode: AuthMode;
  /** Token issued-at (epoch seconds), when present. */
  issuedAt?: number;
  /** Token expiry (epoch seconds), when present. */
  expiresAt?: number;
  /** Issuer (`iss`), when present. Provider-neutral value. */
  issuer?: string;
}

/**
 * Supported verification modes — provider-neutral tokens.
 * - `legacy-hs256`   — today's HS256 shared-secret session token.
 * - `federated-jwks` — the target federated RS256/JWKS token (the neutral
 *   replacement for the former vendor-named `oidc-jwks` mode).
 */
export type AuthMode = 'legacy-hs256' | 'federated-jwks';

/** Stable, provider-neutral error codes. Fail-closed. */
export type SecurityErrorCode =
  | 'NO_TOKEN'
  | 'MALFORMED'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED'
  | 'NOT_ACTIVE'
  | 'INVALID_ISSUER'
  | 'INVALID_AUDIENCE'
  | 'MISSING_CLAIM'
  | 'JWKS_UNAVAILABLE'
  | 'VERIFIER_UNAVAILABLE'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_CODE'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN';

/** Supported social provider slugs. Extensible; `google` is first. */
export type SocialProvider = 'google';

/** Neutral MFA factor type. `webauthn` reserved for later. */
export type MfaFactorType = 'totp' | 'sms' | 'email' | 'webauthn';

/** Neutral auth capability descriptor (replaces `oidcConfigured`). */
export interface AuthMethods {
  password: boolean;
  social: SocialProvider[];
  mfa: {
    enabled: boolean;
    types: MfaFactorType[];
  };
  verification: {
    email: boolean;
    sms: boolean;
  };
}

/**
 * Discriminated login/exchange outcome: either an authenticated session or an
 * MFA-required challenge. Mirrors the API `SessionResult` oneOf (discriminator
 * `status`). Narrow on `status` before reading the variant fields.
 */
export type SessionResult =
  | {
      status: 'authenticated';
      token: string;
      sessionId?: string;
      user: unknown;
    }
  | {
      status: 'mfa_required';
      challengeId: string;
      factors: { factorId: string; type: MfaFactorType }[];
    };

/** Contact-ownership verification status for the current user. */
export interface VerificationStatus {
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
}
