/**
 * Contract-bound types for the account-security hub.
 *
 * `AuthMethods`, `SocialProvider`, and `ErrorBody` are imported from the frozen
 * `@fuzefront/security-client` so drift is a compile error.
 *
 * ⚠️ CONTRACT-CLIENT GAP (for contract-designer / backend-engineer):
 * `openapi.yaml` defines `IdentityConnections` + `SocialConnection`
 * (GET /v1/security/identity/connections), but the PUBLISHED
 * `@fuzefront/security-client` (v0.2.0) exposes NEITHER — its `generated.ts`
 * and hand-authored `types.ts` predate those schemas. The client must be
 * REGENERATED from the frozen spec and re-published so these types come from
 * the client, not this package. Until then they are mirrored here EXACTLY from
 * the frozen openapi.yaml (`components.schemas.IdentityConnections` /
 * `SocialConnection`). This is the only hand-mirrored surface; remove it once
 * the client is regenerated.
 */
import type { AuthMethods as ClientAuthMethods, SocialProvider as ClientSocialProvider } from '@fuzefront/security-client'
import type { components } from '@fuzefront/security-client'

/** Neutral auth capability descriptor (drives which affordances render). */
export type AuthMethods = ClientAuthMethods
/** Supported social provider slug (extensible; `google` first). */
export type SocialProvider = ClientSocialProvider
/** Stable, provider-neutral error body. */
export type ErrorBody = components['schemas']['ErrorBody']

/**
 * A linked social sign-in connection. Mirrors `openapi.yaml`
 * `components.schemas.SocialConnection` (move to the client once regenerated).
 */
export interface SocialConnection {
  provider: SocialProvider
  /** Epoch millis when the provider was linked. */
  linkedAt?: number
}

/**
 * The account's sign-in connections: linked social providers + whether a
 * password sign-in method exists. Mirrors `openapi.yaml`
 * `components.schemas.IdentityConnections` (move to the client once regenerated).
 */
export interface IdentityConnections {
  providers: SocialConnection[]
  hasPassword: boolean
}

/** Which hub card a navigation targets. Mirrors the frame `data-route`s. */
export type SecurityCardKey =
  | 'password'
  | 'two-factor'
  | 'sessions'
  | 'tokens'
  | 'connected'

/** Overall posture derived from connections + methods. Never a vendor name. */
export type PostureLevel = 'good' | 'attention'

/**
 * The data the hub renders, assembled from GET /identity/connections + /methods.
 * Fields with no backing endpoint yet render an honest "unknown" state rather
 * than fabricated values.
 */
export interface SecurityOverview {
  connections: IdentityConnections
  methods: AuthMethods
  /**
   * Active-device count from GET /v1/security/sessions when available. `null`
   * means "not loaded here" — the hub renders an honest unknown, never a fake 0.
   */
  activeSessions: number | null
  /**
   * Active API-token count. No backing count endpoint exists on the Security
   * contract yet, so this is `null` (honest unknown) until one is added.
   */
  activeTokens: number | null
}

/** Client for the read + fail-closed-mutation surface the hub touches. */
export interface AccountSecurityClient {
  getConnections(): Promise<IdentityConnections>
  getMethods(): Promise<AuthMethods>
  /** Optional: active-session count for the devices card. */
  getActiveSessionCount?(): Promise<number>
  /**
   * Unlink a social provider. Fail-closed: unlinking the account's LAST
   * sign-in method rejects with an HttpError(409) rather than succeeding —
   * callers (SignInMethodsList) surface the last-sign-in-method guard.
   */
  unlinkProvider(provider: SocialConnection['provider']): Promise<void>
}
